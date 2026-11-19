import { createHash } from "node:crypto";
import { computeUserScore, scoreChange14d } from "@copayme/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import {
  MAX_CALLS_PER_RUN,
  buildScore,
  createWorker,
  inputsHash,
  runWorker,
  settleCall,
  wonFrom,
  type DueCall,
  type ScoredCall,
  type WorkerDb,
  type WorkerStore,
  type WorkerSummary,
} from "./worker.js";

const NOW = new Date("2026-11-21T00:00:00Z");

const outcomes = (result: "yes" | "no" | null = "yes") => [
  { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.6, noOdds: 0.4, resolutionSide: result },
];

const due = (over: Partial<DueCall> = {}): DueCall => ({
  id: "c1",
  userId: "u1",
  side: "yes",
  instrumentSymbol: "GEMI-UCONN",
  oddsAtCall: 0.6,
  marketStatus: "resolved",
  outcomes: outcomes("yes"),
  ...over,
});

describe("settleCall", () => {
  it("scores a YES pick: a win earns 1 minus the price, a loss loses the price", () => {
    expect(settleCall(due({ outcomes: outcomes("yes") }))).toEqual({ kind: "scored", won: true, points: 0.4 });
    const lost = settleCall(due({ outcomes: outcomes("no") }));
    expect(lost).toMatchObject({ kind: "scored", won: false });
    expect((lost as { points: number }).points).toBeCloseTo(-0.6);
  });

  it("scores a NO pick the same way, against the contract's NO result", () => {
    const won = settleCall(due({ side: "no", oddsAtCall: 0.4, outcomes: outcomes("no") }));
    expect(won).toMatchObject({ won: true });
    expect((won as { points: number }).points).toBeCloseTo(0.6);
    const lost = settleCall(due({ side: "no", oddsAtCall: 0.4, outcomes: outcomes("yes") }));
    expect(lost).toMatchObject({ won: false, points: -0.4 });
  });

  it("scores an unpriced call without points", () => {
    expect(settleCall(due({ oddsAtCall: null }))).toEqual({ kind: "scored", won: true, points: null });
    expect(settleCall(due({ oddsAtCall: null, outcomes: outcomes("no") }))).toEqual({ kind: "scored", won: false, points: null });
  });

  it("voids calls on a void market, whatever else is true", () => {
    expect(settleCall(due({ marketStatus: "void", side: null }))).toEqual({ kind: "void" });
  });

  it("leaves a call it cannot judge, with the reason", () => {
    const reason = (over: Partial<DueCall>) => (settleCall(due(over)) as { reason: string }).reason;
    expect(reason({ side: null })).toContain("no side");
    expect(reason({ instrumentSymbol: null })).toContain("no side or contract");
    expect(reason({ instrumentSymbol: "GEMI-OTHER" })).toContain("not found");
    expect(reason({ outcomes: outcomes(null) })).toContain("no result");
    expect(reason({ outcomes: [{ label: "x", instrumentSymbol: "GEMI-UCONN" }] })).toContain("no result");
    expect(reason({ outcomes: "garbage" })).toContain("not found");
  });
});

describe("wonFrom", () => {
  it("recovers win or loss from points, including at prices of 0 and 1", () => {
    expect(wonFrom(0.65, 0.35)).toBe(true);
    expect(wonFrom(-0.35, 0.35)).toBe(false);
    expect(wonFrom(1, 0)).toBe(true);
    expect(wonFrom(0, 0)).toBe(false);
    expect(wonFrom(0, 1)).toBe(true);
    expect(wonFrom(-1, 1)).toBe(false);
  });
});

describe("buildScore", () => {
  const calls: ScoredCall[] = [
    { id: "a", oddsAtCall: 0.6, points: 0.4 },
    { id: "b", oddsAtCall: 0.6, points: -0.6 },
    { id: "c", oddsAtCall: 0.4, points: 0.6 },
    { id: "d", oddsAtCall: 0.4, points: -0.4 },
    { id: "e", oddsAtCall: 0.6, points: 0.4 },
    { id: "f", oddsAtCall: 0.6, points: -0.6 },
  ];

  it("gives the same score as the shared scoring library", () => {
    const expected = computeUserScore([
      { oddsAtCall: 0.6, won: true },
      { oddsAtCall: 0.6, won: false },
      { oddsAtCall: 0.4, won: true },
      { oddsAtCall: 0.4, won: false },
      { oddsAtCall: 0.6, won: true },
      { oddsAtCall: 0.6, won: false },
    ]);
    expect(buildScore(calls, [], NOW)).toMatchObject({
      score: expected.score,
      skill: expected.skill,
      nResolved: 6,
      nWins: 3,
      hitRate: 0.5,
      change14d: null,
    });
  });

  it("measures the change against the latest snapshot at least 14 days old", () => {
    const snapshots = [
      { score: 40, computedAt: new Date("2026-11-01T00:00:00Z") },
      { score: 47, computedAt: new Date("2026-11-10T00:00:00Z") }, // 11 days old, too recent
    ];
    const built = buildScore(calls, snapshots, NOW);
    expect(built.change14d).toBe(built.score - 40);
    expect(built.change14d).toBe(scoreChange14d(built.score, snapshots, NOW));
  });

  it("hashes the sorted call_id:points lines, whatever order the calls come in", () => {
    const expected = createHash("sha256")
      .update(calls.map((c) => `${c.id}:${c.points}`).sort().join("\n"))
      .digest("hex");
    expect(buildScore(calls, [], NOW).inputsHash).toBe(expected);
    expect(buildScore([...calls].reverse(), [], NOW).inputsHash).toBe(expected);
    expect(inputsHash([])).toBe(createHash("sha256").update("").digest("hex"));
    expect(buildScore(calls, [], NOW).callIds).toEqual(calls.map((c) => c.id));
  });

  it("scores an empty record as 50 with no hit rate", () => {
    expect(buildScore([], [], NOW)).toMatchObject({ score: 50, nResolved: 0, nWins: 0, hitRate: null });
  });
});

type FakeCall = DueCall & { status: "pending" | "scored" | "void"; points: number | null; tweetedAt: Date };

function fakeWorkerStore(opts: { calls: FakeCall[]; locked?: boolean; handles?: Record<string, string> }) {
  const calls = opts.calls;
  const snapshots: { id: string; userId: string; score: number; callIds: string[]; inputsHash: string; computedAt: Date }[] = [];
  const userScores = new Map<string, Record<string, unknown>>();
  const seenLimits: number[] = [];
  const db: WorkerDb = {
    tryLock: async () => !opts.locked,
    dueCalls: async (limit) => {
      seenLimits.push(limit);
      return calls.filter((c) => c.status === "pending" && (c.marketStatus === "resolved" || c.marketStatus === "void")).slice(0, limit);
    },
    markCall: async (id, status, points) => {
      const c = calls.find((x) => x.id === id)!;
      c.status = status;
      c.points = points;
    },
    pricedScoredCalls: async (userId) =>
      calls
        .filter((c) => c.userId === userId && c.status === "scored" && c.points !== null && c.oddsAtCall !== null)
        .map((c) => ({ id: c.id, oddsAtCall: c.oddsAtCall!, points: c.points! })),
    lastCallAt: async (userId) => {
      const times = calls.filter((c) => c.userId === userId).map((c) => c.tweetedAt.getTime());
      return times.length ? new Date(Math.max(...times)) : null;
    },
    snapshots: async (userId) => snapshots.filter((s) => s.userId === userId).map((s) => ({ score: s.score, computedAt: s.computedAt })),
    insertSnapshot: async (s) => {
      const id = `snap-${snapshots.length + 1}`;
      snapshots.push({ id, ...s });
      return id;
    },
    upsertUserScore: async (r) => {
      userScores.set(r.userId, r);
    },
    handles: async (ids) => ids.map((id) => opts.handles?.[id] ?? id),
  };
  const store: WorkerStore = { transaction: (fn) => fn(db) };
  return { store, calls, snapshots, userScores, seenLimits };
}

const fakeCall = (over: Partial<FakeCall> & { id: string }): FakeCall => ({
  ...due(),
  status: "pending",
  points: null,
  tweetedAt: new Date("2026-11-19T12:03:00Z"),
  ...over,
});

describe("runWorker", () => {
  it("settles finished calls, rescores each user once, and writes a snapshot", async () => {
    const { store, calls, snapshots, userScores } = fakeWorkerStore({
      calls: [
        fakeCall({ id: "a", userId: "u1", outcomes: outcomes("yes") }), // win, +0.4
        fakeCall({ id: "b", userId: "u1", outcomes: outcomes("no") }), // loss, -0.6
        fakeCall({ id: "c", userId: "u2", marketStatus: "void" }),
        fakeCall({ id: "d", userId: "u3", marketStatus: "resolved", outcomes: outcomes(null) }), // no result yet
      ],
      handles: { u1: "Tipster" },
    });
    const summary = await runWorker(store, NOW);

    expect(summary).toEqual({ settled: 2, voided: 1, unsettleable: 1, usersUpdated: 1, handles: ["tipster"] });
    expect(calls.map((c) => [c.id, c.status, c.points])).toEqual([
      ["a", "scored", 0.4],
      ["b", "scored", -0.6],
      ["c", "void", null],
      ["d", "pending", null],
    ]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ userId: "u1", callIds: ["a", "b"], computedAt: NOW });
    expect(userScores.get("u1")).toMatchObject({ nResolved: 2, nWins: 1, hitRate: 0.5, snapshotId: "snap-1", updatedAt: NOW });
    expect(userScores.has("u2")).toBe(false); // a void call changes nobody's score
  });

  it("counts only priced calls toward the score, but still gives an all-unpriced user a row", async () => {
    const { store, userScores } = fakeWorkerStore({
      calls: [
        fakeCall({ id: "a", userId: "u1", oddsAtCall: 0.6 }),
        fakeCall({ id: "b", userId: "u1", oddsAtCall: null }),
        fakeCall({ id: "c", userId: "u2", oddsAtCall: null }),
      ],
    });
    await runWorker(store, NOW);
    expect(userScores.get("u1")).toMatchObject({ nResolved: 1, nWins: 1 });
    expect(userScores.get("u2")).toMatchObject({ score: 50, nResolved: 0, hitRate: null });
  });

  it("includes calls settled in earlier runs when it rescores a user", async () => {
    const { store, calls, userScores } = fakeWorkerStore({
      calls: [fakeCall({ id: "old", status: "scored", points: 0.4 }), fakeCall({ id: "new", marketStatus: "resolved" })],
    });
    await runWorker(store, NOW);
    expect(calls.find((c) => c.id === "new")!.status).toBe("scored");
    expect(userScores.get("u1")).toMatchObject({ nResolved: 2 });
  });

  it("does nothing and returns null while another run holds the lock", async () => {
    const { store, calls, snapshots } = fakeWorkerStore({ calls: [fakeCall({ id: "a" })], locked: true });
    expect(await runWorker(store, NOW)).toBeNull();
    expect(calls[0]!.status).toBe("pending");
    expect(snapshots).toHaveLength(0);
  });

  it("is a no-op when nothing is due, so it writes no extra snapshots", async () => {
    const { store, snapshots } = fakeWorkerStore({ calls: [fakeCall({ id: "a" })] });
    await runWorker(store, NOW);
    const again = await runWorker(store, NOW);
    expect(again).toEqual({ settled: 0, voided: 0, unsettleable: 0, usersUpdated: 0, handles: [] });
    expect(snapshots).toHaveLength(1);
  });

  it("asks for at most MAX_CALLS_PER_RUN calls, or the limit it is given", async () => {
    const { store, seenLimits } = fakeWorkerStore({ calls: [] });
    await runWorker(store, NOW);
    await runWorker(store, NOW, 7);
    expect(seenLimits).toEqual([MAX_CALLS_PER_RUN, 7]);
  });

  it("logs why a call was left pending", async () => {
    const log = vi.fn();
    const { store } = fakeWorkerStore({ calls: [fakeCall({ id: "x", outcomes: outcomes(null) })] });
    await runWorker(store, NOW, 10, log);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("call x left pending: no result"));
  });
});

describe("createWorker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const summary = (over: Partial<WorkerSummary> = {}): WorkerSummary => ({
    settled: 1, voided: 0, unsettleable: 0, usersUpdated: 1, handles: ["tipster"], ...over,
  });

  /** A store whose runs we control: every transaction call is one run. */
  function controlled() {
    const calls: { resolve: (s: WorkerSummary | null) => void }[] = [];
    const store: WorkerStore = {
      transaction: () =>
        new Promise((resolve) => {
          calls.push({ resolve: resolve as (s: WorkerSummary | null) => void });
        }),
    };
    return { store, calls };
  }

  it("runs after the initial delay and then on every interval, evicting the rescored handles", async () => {
    const evict = vi.fn();
    const store: WorkerStore = { transaction: vi.fn(async () => summary()) as never };
    const worker = createWorker({ store, evict, intervalMs: 1000, initialDelayMs: 200, log: () => {} });
    worker.start();

    await vi.advanceTimersByTimeAsync(199);
    expect(store.transaction).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(store.transaction).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.transaction).toHaveBeenCalledTimes(3);
    expect(evict).toHaveBeenCalledWith(["tipster"]);
    worker.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.transaction).toHaveBeenCalledTimes(3);
  });

  it("never starts a run while one is still going", async () => {
    const { store, calls } = controlled();
    const worker = createWorker({ store, evict: () => {}, log: () => {} });
    const first = worker.runNow();
    expect(await worker.runNow()).toBeNull(); // refused: already running
    expect(calls).toHaveLength(1);
    calls[0]!.resolve(summary());
    await first;
    const next = worker.runNow();
    expect(calls).toHaveLength(2); // free again after the first finished
    calls[1]!.resolve(null);
    await next;
  });

  it("logs a failed run and still runs again next time", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const transaction = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(summary({ handles: [] }));
    const worker = createWorker({ store: { transaction } as never, evict: () => {}, intervalMs: 1000, initialDelayMs: 0, log: () => {} });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(errors).toHaveBeenCalledWith("[worker] run failed", expect.any(Error));
    await vi.advanceTimersByTimeAsync(1000);
    expect(transaction).toHaveBeenCalledTimes(2);
    worker.stop();
    errors.mockRestore();
  });

  it("does not evict anything when no score changed", async () => {
    const evict = vi.fn();
    const store: WorkerStore = { transaction: (async () => summary({ handles: [], settled: 0, usersUpdated: 0 })) as never };
    await createWorker({ store, evict, log: () => {} }).runNow();
    expect(evict).not.toHaveBeenCalled();
  });
});

describe("POST /v1/worker/run", () => {
  const KEY = "k";
  const build = (runNow: (() => Promise<WorkerSummary | null>) | null, serviceKey: string | null = KEY) =>
    createApp({
      store: { findByHandles: async () => [], leaderboard: async () => [] },
      serviceKey: serviceKey ?? undefined,
      worker: runNow ? { runNow } : undefined,
    });
  const post = (app: ReturnType<typeof build>, key: string | null = KEY) =>
    app.request("/v1/worker/run", { method: "POST", headers: key ? { "x-service-key": key } : {} });

  it("runs the worker and returns what it did", async () => {
    const result: WorkerSummary = { settled: 3, voided: 1, unsettleable: 0, usersUpdated: 2, handles: ["a", "b"] };
    const res = await post(build(async () => result));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(result);
  });

  it("needs the service key, and is off without a worker or key", async () => {
    const run = vi.fn(async () => null);
    expect((await post(build(run), null)).status).toBe(401);
    expect((await post(build(run), "wrong")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
    expect((await post(build(null))).status).toBe(503);
    expect((await post(build(run, null))).status).toBe(503);
  });

  it("answers 409 when a run is already in progress", async () => {
    expect((await post(build(async () => null))).status).toBe(409);
  });
});
