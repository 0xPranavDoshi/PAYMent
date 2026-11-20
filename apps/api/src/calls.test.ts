import { CallsResponse, MAX_CALLS_LIMIT, MAX_HISTORY_LIMIT, MAX_RECENT_LIMIT, RecentCall, ScorePoint, type CallStatus } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { resultOf, toCallEntry, type CallsStore, type LedgerRow } from "./calls.js";

const contracts = (result: "yes" | "no" | null | undefined) => [
  { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.6, noOdds: 0.4, resolutionSide: result },
];

const row = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  tweetId: "1001",
  tweetText: "UConn wins it",
  tweetedAt: new Date("2026-11-19T12:03:00Z"),
  eventName: "UConn vs Arizona",
  marketTicker: "NCAAM-2611200300-UCONN-ARI-M",
  pickedOutcome: "UConn",
  instrumentSymbol: "GEMI-UCONN",
  side: "yes",
  oddsAtCall: 0.6,
  oddsSource: "snapshot",
  status: "scored",
  points: 0.4,
  outcomes: contracts("yes"),
  ...over,
});

describe("resultOf", () => {
  it("says whether a scored pick won, from the stored result and the side picked", () => {
    expect(resultOf(row({ outcomes: contracts("yes"), side: "yes" }))).toBe("won");
    expect(resultOf(row({ outcomes: contracts("no"), side: "yes" }))).toBe("lost");
    expect(resultOf(row({ outcomes: contracts("no"), side: "no" }))).toBe("won");
    expect(resultOf(row({ outcomes: contracts("yes"), side: "no" }))).toBe("lost");
  });

  it("is null when there is nothing to say yet", () => {
    expect(resultOf(row({ status: "pending" }))).toBeNull();
    expect(resultOf(row({ status: "void" }))).toBeNull();
    expect(resultOf(row({ outcomes: contracts(null) }))).toBeNull();
    expect(resultOf(row({ outcomes: contracts(undefined) }))).toBeNull();
    expect(resultOf(row({ side: null }))).toBeNull();
    expect(resultOf(row({ instrumentSymbol: "OTHER" }))).toBeNull();
    expect(resultOf(row({ outcomes: "garbage" }))).toBeNull();
  });

  it("works for unpriced calls too, which have a result but no points", () => {
    expect(resultOf(row({ oddsAtCall: null, oddsSource: "none", points: null }))).toBe("won");
  });
});

describe("toCallEntry", () => {
  it("maps a row to the public shape", () => {
    expect(toCallEntry(row())).toEqual({
      callId: "11111111-1111-4111-8111-111111111111",
      tweetId: "1001",
      tweetText: "UConn wins it",
      tweetedAt: "2026-11-19T12:03:00.000Z",
      eventName: "UConn vs Arizona",
      marketTicker: "NCAAM-2611200300-UCONN-ARI-M",
      pickLabel: "UConn",
      side: "yes",
      oddsAtCall: 0.6,
      oddsSource: "snapshot",
      status: "scored",
      result: "won",
      points: 0.4,
    });
  });
});

describe("GET /v1/users/:handle/calls", () => {
  function setup(rows: LedgerRow[] | null) {
    const listCalls = vi.fn(async (_handle: string, _opts: { limit: number; statuses: readonly CallStatus[] | null }) => rows);
    const calls: CallsStore = { listCalls, listRecent: async () => [], scoreHistory: async () => null };
    const app = createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] }, calls });
    return { app, listCalls };
  }

  it("returns the user's calls in the public shape", async () => {
    const { app, listCalls } = setup([row(), row({ id: "22222222-2222-4222-8222-222222222222", status: "pending", points: null })]);
    const res = await app.request("/v1/users/Tipster/calls");
    expect(res.status).toBe(200);
    const body = CallsResponse.parse(await res.json());
    expect(body.map((c) => c.status)).toEqual(["scored", "pending"]);
    expect(body[1]!.result).toBeNull();
    expect(listCalls).toHaveBeenCalledWith("tipster", { limit: 20, statuses: null });
  });

  it("clamps the limit to 1 through 50 and rejects anything that is not a whole number", async () => {
    const { app, listCalls } = setup([]);
    await app.request("/v1/users/a/calls?limit=5");
    await app.request("/v1/users/a/calls?limit=0");
    await app.request("/v1/users/a/calls?limit=9999");
    expect(listCalls.mock.calls.map((c) => (c[1] as { limit: number }).limit)).toEqual([5, 1, MAX_CALLS_LIMIT]);
    for (const bad of ["abc", "-1", "1.5", ""]) {
      expect((await app.request(`/v1/users/a/calls?limit=${bad}`)).status).toBe(400);
    }
  });

  it("filters by status and rejects unknown statuses", async () => {
    const { app, listCalls } = setup([]);
    await app.request("/v1/users/a/calls?status=pending,scored");
    expect(listCalls).toHaveBeenCalledWith("a", { limit: 20, statuses: ["pending", "scored"] });
    for (const bad of ["won", "pending,nope", ""]) {
      expect((await app.request(`/v1/users/a/calls?status=${bad}`)).status).toBe(400);
    }
  });

  it("is 404 for an unknown user, 400 for an invalid handle, 503 when not configured", async () => {
    expect((await setup(null).app.request("/v1/users/nobody/calls")).status).toBe(404);
    expect((await setup([]).app.request("/v1/users/not%20valid/calls")).status).toBe(400);
    const off = createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] } });
    expect((await off.request("/v1/users/a/calls")).status).toBe(503);
  });

  it("returns an empty list for a known user with no calls", async () => {
    const res = await setup([]).app.request("/v1/users/a/calls");
    expect(await res.json()).toEqual([]);
  });
});

describe("GET /v1/calls/recent", () => {
  function setup(rows: Array<LedgerRow & { handle: string }>) {
    const listRecent = vi.fn(async (_limit: number) => rows);
    const calls: CallsStore = { listCalls: async () => null, listRecent, scoreHistory: async () => null };
    return { app: createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] }, calls }), listRecent };
  }

  it("returns the latest picks with who made each, in the public shape", async () => {
    const { app, listRecent } = setup([{ ...row(), handle: "tipster" }, { ...row({ id: "22222222-2222-4222-8222-222222222222", status: "pending", points: null }), handle: "sharp" }]);
    const res = await app.request("/v1/calls/recent");
    expect(res.status).toBe(200);
    const body = (await res.json()).map((c: unknown) => RecentCall.parse(c));
    expect(body.map((c: RecentCall) => c.handle)).toEqual(["tipster", "sharp"]);
    expect(body[0]!.result).toBe("won");
    expect(listRecent).toHaveBeenCalledWith(10);
  });

  it("clamps the limit and rejects anything that is not a whole number", async () => {
    const { app, listRecent } = setup([]);
    await app.request("/v1/calls/recent?limit=3");
    await app.request("/v1/calls/recent?limit=0");
    await app.request("/v1/calls/recent?limit=9999");
    expect(listRecent.mock.calls.map((c) => c[0])).toEqual([3, 1, MAX_RECENT_LIMIT]);
    for (const bad of ["abc", "-1", "1.5", ""]) expect((await app.request(`/v1/calls/recent?limit=${bad}`)).status).toBe(400);
  });

  it("is 503 when the ledger is not configured", async () => {
    const off = createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] } });
    expect((await off.request("/v1/calls/recent")).status).toBe(503);
  });
});

describe("GET /v1/users/:handle/score-history", () => {
  function setup(points: Array<{ score: number; computedAt: Date }> | null) {
    const scoreHistory = vi.fn(async (_handle: string, _limit: number) => points);
    const calls: CallsStore = { listCalls: async () => null, listRecent: async () => [], scoreHistory };
    return { app: createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] }, calls }), scoreHistory };
  }

  it("returns the score snapshots oldest first", async () => {
    const { app, scoreHistory } = setup([
      { score: 50, computedAt: new Date("2026-11-10T00:00:00Z") },
      { score: 61, computedAt: new Date("2026-11-18T00:00:00Z") },
    ]);
    const res = await app.request("/v1/users/Tipster/score-history");
    expect(res.status).toBe(200);
    const body = (await res.json()).map((p: unknown) => ScorePoint.parse(p));
    expect(body.map((p: ScorePoint) => p.score)).toEqual([50, 61]);
    expect(scoreHistory).toHaveBeenCalledWith("tipster", 60);
  });

  it("clamps the limit, 404s an unknown user, 400s a bad handle or limit, 503s when not configured", async () => {
    const { app, scoreHistory } = setup([]);
    await app.request("/v1/users/a/score-history?limit=9999");
    expect(scoreHistory).toHaveBeenCalledWith("a", MAX_HISTORY_LIMIT);
    expect((await setup(null).app.request("/v1/users/nobody/score-history")).status).toBe(404);
    expect((await app.request("/v1/users/not%20valid/score-history")).status).toBe(400);
    expect((await app.request("/v1/users/a/score-history?limit=abc")).status).toBe(400);
    const off = createApp({ store: { findByHandles: async () => [], leaderboard: async () => [] } });
    expect((await off.request("/v1/users/a/score-history")).status).toBe(503);
  });
});
