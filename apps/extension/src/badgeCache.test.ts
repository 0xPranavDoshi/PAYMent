import type { Badge } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { BADGE_TTL_MS, NEGATIVE_TTL_MS, STALE_MAX_MS, createBadgeCache, type KeyValueStore } from "./badgeCache.js";
import { createBadgeService } from "./badgeService.js";

const badge: Badge = { score: 72, change14d: 8, tier: "scored", nResolved: 30, hitRate: 0.6 };

function memoryStore(initial: Record<string, unknown> = {}) {
  const data = new Map<string, unknown>(Object.entries(initial));
  const store: KeyValueStore = {
    get: async (keys) => Object.fromEntries(keys.filter((k) => data.has(k)).map((k) => [k, data.get(k)])),
    getAll: async () => Object.fromEntries(data),
    set: async (items) => void Object.entries(items).forEach(([k, v]) => data.set(k, v)),
    remove: async (keys) => void keys.forEach((k) => data.delete(k)),
  };
  return { store, data };
}

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createBadgeCache", () => {
  it("returns what was written while it is fresh, including 'no data' entries", async () => {
    const c = clock();
    const cache = createBadgeCache({ store: memoryStore().store, version: "1", now: c.now });
    await cache.write({ alice: badge, nobody: null });
    const { fresh, stale } = await cache.read(["alice", "nobody", "other"]);
    expect(fresh.get("alice")).toEqual(badge);
    expect(fresh.has("nobody")).toBe(true);
    expect(fresh.get("nobody")).toBeNull();
    expect(fresh.has("other")).toBe(false);
    expect(stale.size).toBe(0);
  });

  it("expires a badge after 10 minutes and a no-data entry after 30", async () => {
    const c = clock();
    const cache = createBadgeCache({ store: memoryStore().store, version: "1", now: c.now });
    await cache.write({ alice: badge, nobody: null });

    c.advance(BADGE_TTL_MS - 1);
    expect((await cache.read(["alice", "nobody"])).fresh.size).toBe(2);
    c.advance(1);
    let read = await cache.read(["alice", "nobody"]);
    expect([...read.fresh.keys()]).toEqual(["nobody"]); // badge expired, no-data still fresh
    expect([...read.stale.keys()]).toEqual(["alice"]);

    c.advance(NEGATIVE_TTL_MS - BADGE_TTL_MS);
    read = await cache.read(["alice", "nobody"]);
    expect(read.fresh.size).toBe(0);
    expect([...read.stale.keys()].sort()).toEqual(["alice", "nobody"]);

    c.advance(STALE_MAX_MS);
    read = await cache.read(["alice", "nobody"]);
    expect(read.fresh.size + read.stale.size).toBe(0);
  });

  it("starts empty after an extension update, because keys carry the version", async () => {
    const { store } = memoryStore();
    const c = clock();
    await createBadgeCache({ store, version: "1", now: c.now }).write({ alice: badge });
    const next = await createBadgeCache({ store, version: "2", now: c.now }).read(["alice"]);
    expect(next.fresh.size + next.stale.size).toBe(0);
  });

  it("treats corrupted entries as misses", async () => {
    const { store } = memoryStore({ "badge:1:alice": { b: { score: "high" }, t: 5 }, "badge:1:bob": "garbage" });
    const read = await createBadgeCache({ store, version: "1", now: () => 5 }).read(["alice", "bob"]);
    expect(read.fresh.size + read.stale.size).toBe(0);
  });

  it("prunes other versions, unreadable entries and entries too old to use, and nothing else", async () => {
    const { store, data } = memoryStore();
    const c = clock();
    await createBadgeCache({ store, version: "old", now: c.now }).write({ x: badge });
    const cache = createBadgeCache({ store, version: "1", now: c.now });
    await cache.write({ ancient: badge });
    c.advance(STALE_MAX_MS);
    await cache.write({ keep: badge });
    data.set("badge:1:broken", "garbage");
    data.set("unrelated", "settings");

    expect(await cache.prune()).toBe(3); // other version, ancient, broken
    expect([...data.keys()].sort()).toEqual(["badge:1:keep", "unrelated"]);
  });
});

describe("createBadgeService", () => {
  function setup(fetchBadges: (h: string[]) => Promise<Record<string, Badge | null>>) {
    const c = clock();
    const cache = createBadgeCache({ store: memoryStore().store, version: "1", now: c.now });
    return { service: createBadgeService({ cache, fetchBadges }), cache, c };
  }

  it("fetches what is missing, then answers from the cache without another request", async () => {
    const fetchBadges = vi.fn(async (hs: string[]) => Object.fromEntries(hs.map((h) => [h, h === "nobody" ? null : badge])));
    const { service } = setup(fetchBadges);
    expect(await service.lookup(["alice", "nobody"])).toEqual({ alice: badge, nobody: null });
    expect(await service.lookup(["alice", "nobody"])).toEqual({ alice: badge, nobody: null });
    expect(fetchBadges).toHaveBeenCalledTimes(1);
  });

  it("asks the API only for handles it does not have", async () => {
    const fetchBadges = vi.fn(async (hs: string[]) => Object.fromEntries(hs.map((h) => [h, badge])));
    const { service } = setup(fetchBadges);
    await service.lookup(["alice"]);
    await service.lookup(["alice", "bob", "alice"]);
    expect(fetchBadges).toHaveBeenLastCalledWith(["bob"]);
  });

  it("refetches once an entry has expired", async () => {
    const fetchBadges = vi.fn(async (hs: string[]) => Object.fromEntries(hs.map((h) => [h, badge])));
    const { service, c } = setup(fetchBadges);
    await service.lookup(["alice"]);
    c.advance(BADGE_TTL_MS);
    await service.lookup(["alice"]);
    expect(fetchBadges).toHaveBeenCalledTimes(2);
  });

  it("makes one request when two tabs ask for the same handle at once", async () => {
    const releases: ((v: Record<string, Badge | null>) => void)[] = [];
    const fetchBadges = vi.fn(() => new Promise<Record<string, Badge | null>>((resolve) => releases.push(resolve)));
    const { service } = setup(fetchBadges);

    const first = service.lookup(["alice"]);
    await vi.waitFor(() => expect(fetchBadges).toHaveBeenCalledTimes(1));
    const second = service.lookup(["alice", "bob"]); // alice is already on its way; only bob is new
    await vi.waitFor(() => expect(fetchBadges).toHaveBeenCalledTimes(2));
    expect(fetchBadges).toHaveBeenLastCalledWith(["bob"]);

    releases[0]!({ alice: badge });
    releases[1]!({ bob: { ...badge, score: 40 } });
    expect(await first).toEqual({ alice: badge });
    expect(await second).toEqual({ alice: badge, bob: { ...badge, score: 40 } });
  });

  it("shows an expired badge when the API is down, but fails if a handle has nothing cached", async () => {
    const ok = vi.fn(async () => ({ alice: badge }));
    const { service, c } = setup(ok);
    await service.lookup(["alice"]);
    c.advance(BADGE_TTL_MS + 1);

    ok.mockRejectedValue(new Error("API down"));
    expect(await service.lookup(["alice"])).toEqual({ alice: badge }); // stale beats nothing
    await expect(service.lookup(["alice", "bob"])).rejects.toThrow("API down"); // bob has nothing
  });

  it("does not cache a failed lookup", async () => {
    const fetchBadges = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue({ alice: badge });
    const { service } = setup(fetchBadges);
    await expect(service.lookup(["alice"])).rejects.toThrow("boom");
    expect(await service.lookup(["alice"])).toEqual({ alice: badge });
    expect(fetchBadges).toHaveBeenCalledTimes(2);
  });

  it("records a handle the API did not mention as 'no data'", async () => {
    const fetchBadges = vi.fn(async () => ({}));
    const { service } = setup(fetchBadges);
    expect(await service.lookup(["ghost"])).toEqual({ ghost: null });
    await service.lookup(["ghost"]);
    expect(fetchBadges).toHaveBeenCalledTimes(1);
  });
});

describe("badge lifetimes", () => {
  it("are short enough that a score the worker just changed shows within about a minute", () => {
    expect(BADGE_TTL_MS).toBeLessThanOrEqual(60_000);
    expect(NEGATIVE_TTL_MS).toBeGreaterThan(BADGE_TTL_MS);
    expect(NEGATIVE_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
  });
});
