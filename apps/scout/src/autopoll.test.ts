import { describe, expect, it, vi } from "vitest";
import { AUTO_POLL_MAX_S, AUTO_POLL_MIN_S, autoPollSettings, pollCopiedTraders } from "./autopoll.js";
import { createApp } from "./app.js";
import { createMemoryStore } from "./store.js";

const NOW = new Date("2026-11-20T05:00:00.000Z");

/** A store where these handles were scanned before. */
async function scanned(...handles: string[]) {
  const store = createMemoryStore();
  for (const h of handles) {
    await store.tryLock(h, new Date(NOW.getTime() - 3_600_000));
    await store.finishScan(h, { newestTweetId: "100", xUserId: "u", now: new Date(NOW.getTime() - 3_600_000) });
  }
  return store;
}

describe("autoPollSettings", () => {
  it("is off unless SCOUT_AUTO_POLL is exactly true", () => {
    expect(autoPollSettings({}).enabled).toBe(false);
    expect(autoPollSettings({ SCOUT_AUTO_POLL: "false" }).enabled).toBe(false);
    expect(autoPollSettings({ SCOUT_AUTO_POLL: "1" }).enabled).toBe(false);
    expect(autoPollSettings({ SCOUT_AUTO_POLL: " true " }).enabled).toBe(true);
  });

  it("defaults to every 3 minutes and 10 traders", () => {
    expect(autoPollSettings({})).toEqual({ enabled: false, everyS: 180, maxHandles: 10 });
  });

  it("keeps the interval inside the copy window: at least 60 s (cost) and at most 300 s (a pick older than 10 minutes is not copied)", () => {
    expect(autoPollSettings({ SCOUT_AUTO_POLL_S: "5" }).everyS).toBe(AUTO_POLL_MIN_S);
    expect(autoPollSettings({ SCOUT_AUTO_POLL_S: "3600" }).everyS).toBe(AUTO_POLL_MAX_S);
    expect(autoPollSettings({ SCOUT_AUTO_POLL_S: "120" }).everyS).toBe(120);
    expect(autoPollSettings({ SCOUT_AUTO_POLL_S: "abc" }).everyS).toBe(180);
  });
});

describe("pollCopiedTraders", () => {
  it("scans each copied trader that was scanned before, fetching new posts from X", async () => {
    const store = await scanned("alice", "bob");
    const startScan = vi.fn();
    const r = await pollCopiedTraders({ store, copiedHandles: async () => ["alice", "bob"], startScan, maxHandles: 10, now: () => NOW });
    expect(r.started).toEqual(["alice", "bob"]);
    expect(startScan).toHaveBeenCalledWith("alice", { fetchNew: true });
    expect(startScan).toHaveBeenCalledWith("bob", { fetchNew: true });
  });

  it("does not start a first scan for a trader nobody has scanned yet (that costs ~100 posts and stays a person's choice)", async () => {
    const store = await scanned("alice");
    const startScan = vi.fn();
    const r = await pollCopiedTraders({ store, copiedHandles: async () => ["alice", "stranger"], startScan, maxHandles: 10, now: () => NOW });
    expect(r.started).toEqual(["alice"]);
    expect(r.skipped).toEqual([{ handle: "stranger", reason: "never scanned" }]);
    expect(startScan).toHaveBeenCalledTimes(1);
  });

  it("does not start a second scan while one is already running, including one a person started", async () => {
    const store = await scanned("alice");
    await store.tryLock("alice", NOW); // a person's scan holds the lock
    const startScan = vi.fn();
    const r = await pollCopiedTraders({ store, copiedHandles: async () => ["alice"], startScan, maxHandles: 10, now: () => NOW });
    expect(startScan).not.toHaveBeenCalled();
    expect(r.skipped).toEqual([{ handle: "alice", reason: "scan already running" }]);
  });

  it("asks the store for at most maxHandles traders", async () => {
    const store = await scanned("a");
    const copiedHandles = vi.fn(async () => ["a"]);
    await pollCopiedTraders({ store, copiedHandles, startScan: vi.fn(), maxHandles: 3, now: () => NOW });
    expect(copiedHandles).toHaveBeenCalledWith(3);
  });

  it("does nothing when nobody is copy trading", async () => {
    const startScan = vi.fn();
    const r = await pollCopiedTraders({ store: await scanned("alice"), copiedHandles: async () => [], startScan, maxHandles: 10, now: () => NOW });
    expect(r).toEqual({ started: [], skipped: [] });
    expect(startScan).not.toHaveBeenCalled();
  });
});

describe("the manual path is unchanged by auto-poll", () => {
  it("a profile scanned 5 minutes ago is still served from cache for a person, with no scan", async () => {
    const store = createMemoryStore();
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60_000);
    await store.tryLock("alice", fiveMinAgo);
    await store.finishScan("alice", { newestTweetId: "100", xUserId: "u", now: fiveMinAgo });
    const startScan = vi.fn();
    const app = createApp({ store, startScan, now: () => NOW });
    const res = await app.request("/v1/scout/alice?newest=200", { method: "POST" });
    expect(res.status).toBe(200); // cached: the 10-minute rule still applies to people
    expect(startScan).not.toHaveBeenCalled();
  });
});
