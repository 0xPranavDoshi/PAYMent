import { BadgesResponse, MAX_BADGE_HANDLES, UserProfile } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { ScoreRow, ScoreStore } from "./store.js";

const UPDATED = new Date("2026-11-17T12:00:00Z");

function row(handle: string, overrides: Partial<ScoreRow> = {}): ScoreRow {
  return {
    handle,
    score: 72,
    scoreChange14d: 8,
    skill: 0.08,
    nResolved: 30,
    nWins: 19,
    hitRate: 19 / 30,
    lastCallAt: new Date("2026-11-17T09:00:00Z"),
    updatedAt: UPDATED,
    latestSnapshot: { inputsHash: "a".repeat(64), computedAt: UPDATED },
    ...overrides,
  };
}

function setup(rows: ScoreRow[]) {
  const findByHandles = vi.fn(async (handles: readonly string[]) =>
    rows.filter((r) => handles.includes(r.handle)),
  );
  const leaderboard = vi.fn(async (limit: number, minResolved: number) =>
    rows.filter((r) => r.nResolved >= minResolved).slice(0, limit),
  );
  const store: ScoreStore = { findByHandles, leaderboard };
  let t = 0;
  const app = createApp({ store, now: () => t });
  return { app, findByHandles, leaderboard, advance: (ms: number) => (t += ms) };
}

describe("GET /v1/badges", () => {
  it("returns a badge per handle and null for unknown handles", async () => {
    const { app } = setup([row("alice")]);
    const res = await app.request("/v1/badges?handles=alice,nobody");
    expect(res.status).toBe(200);
    const body = BadgesResponse.parse(await res.json());
    expect(body.alice).toEqual({
      score: 72,
      change14d: 8,
      tier: "scored",
      nResolved: 30,
      hitRate: 19 / 30,
    });
    expect(body.nobody).toBeNull();
  });

  it("derives the New tier from the resolved count", async () => {
    const { app } = setup([row("rookie", { nResolved: 3, nWins: 2, hitRate: 2 / 3 })]);
    const body = await (await app.request("/v1/badges?handles=rookie")).json();
    expect(body.rookie.tier).toBe("new");
  });

  it("passes through a null change when there is no baseline snapshot", async () => {
    const { app } = setup([row("fresh", { scoreChange14d: null })]);
    const body = await (await app.request("/v1/badges?handles=fresh")).json();
    expect(body.fresh.change14d).toBeNull();
  });

  it("is case-insensitive, ignores @, and dedupes", async () => {
    const { app, findByHandles } = setup([row("alice")]);
    const body = await (await app.request("/v1/badges?handles=Alice,@ALICE,alice")).json();
    expect(Object.keys(body)).toEqual(["alice"]);
    expect(findByHandles).toHaveBeenCalledWith(["alice"]);
  });

  it("rejects a missing, oversized or malformed handle list", async () => {
    const { app } = setup([]);
    expect((await app.request("/v1/badges")).status).toBe(400);
    expect((await app.request("/v1/badges?handles=,,")).status).toBe(400);
    const many = Array.from({ length: MAX_BADGE_HANDLES + 1 }, (_, i) => `u${i}`).join(",");
    expect((await app.request(`/v1/badges?handles=${many}`)).status).toBe(400);
    const bad = await app.request("/v1/badges?handles=alice,not%20valid,waytoolonghandle12345");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("not valid");
  });

  it("accepts exactly the maximum number of handles", async () => {
    const { app } = setup([]);
    const max = Array.from({ length: MAX_BADGE_HANDLES }, (_, i) => `u${i}`).join(",");
    expect((await app.request(`/v1/badges?handles=${max}`)).status).toBe(200);
  });

  it("serves repeat lookups from cache, including unknown handles, until the ttl passes", async () => {
    const { app, findByHandles, advance } = setup([row("alice")]);
    await app.request("/v1/badges?handles=alice,nobody");
    await app.request("/v1/badges?handles=alice,nobody");
    expect(findByHandles).toHaveBeenCalledTimes(1);

    advance(60_001);
    await app.request("/v1/badges?handles=alice,nobody");
    expect(findByHandles).toHaveBeenCalledTimes(2);
  });

  it("only queries the handles that are not cached", async () => {
    const { app, findByHandles } = setup([row("alice"), row("bob")]);
    await app.request("/v1/badges?handles=alice");
    await app.request("/v1/badges?handles=alice,bob");
    expect(findByHandles).toHaveBeenLastCalledWith(["bob"]);
  });

  it("evictBadges makes the next lookup read fresh data", async () => {
    const { app, findByHandles } = setup([row("alice")]);
    await app.request("/v1/badges?handles=alice");
    app.evictBadges(["Alice"]);
    await app.request("/v1/badges?handles=alice");
    expect(findByHandles).toHaveBeenCalledTimes(2);
  });
});

describe("GET /v1/users/:handle", () => {
  it("returns the profile with the score breakdown and latest snapshot", async () => {
    const { app } = setup([row("alice")]);
    const res = await app.request("/v1/users/Alice");
    expect(res.status).toBe(200);
    const profile = UserProfile.parse(await res.json());
    expect(profile).toMatchObject({
      handle: "alice",
      score: 72,
      nWins: 19,
      skill: 0.08,
      lastCallAt: "2026-11-17T09:00:00.000Z",
      latestSnapshot: { inputsHash: "a".repeat(64), computedAt: "2026-11-17T12:00:00.000Z" },
    });
  });

  it("returns a null snapshot when none exists", async () => {
    const { app } = setup([row("alice", { latestSnapshot: null })]);
    const profile = await (await app.request("/v1/users/alice")).json();
    expect(profile.latestSnapshot).toBeNull();
  });

  it("returns 404 for unknown users and 400 for invalid handles", async () => {
    const { app } = setup([]);
    expect((await app.request("/v1/users/nobody")).status).toBe(404);
    expect((await app.request("/v1/users/not%20valid")).status).toBe(400);
  });
});

describe("GET /v1/leaderboard", () => {
  it("returns badge fields plus the handle, and only users the badge would show a score for", async () => {
    const { app, leaderboard } = setup([row("alice"), row("bob", { score: 40, scoreChange14d: null })]);
    const res = await app.request("/v1/leaderboard");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { handle: "alice", score: 72, change14d: 8, tier: "scored", nResolved: 30, hitRate: 19 / 30 },
      { handle: "bob", score: 40, change14d: null, tier: "scored", nResolved: 30, hitRate: 19 / 30 },
    ]);
    expect(leaderboard).toHaveBeenCalledWith(50, 5); // default limit; New threshold
  });

  it("clamps the limit to 1 through 100 and rejects anything that is not a whole number", async () => {
    const { app, leaderboard } = setup([row("alice")]);
    await app.request("/v1/leaderboard?limit=10");
    await app.request("/v1/leaderboard?limit=0");
    await app.request("/v1/leaderboard?limit=5000");
    expect(leaderboard.mock.calls.map((c) => c[0])).toEqual([10, 1, 100]);
    for (const bad of ["abc", "-3", "2.5", ""]) {
      expect((await app.request(`/v1/leaderboard?limit=${bad}`)).status).toBe(400);
    }
  });

  it("returns an empty list when nobody qualifies", async () => {
    const { app } = setup([row("rookie", { nResolved: 3 })]);
    expect(await (await app.request("/v1/leaderboard")).json()).toEqual([]);
  });
});
