import { createHash } from "node:crypto";
import { computeUserScore, scoreChange14d, type ScoreSnapshotPoint } from "@copayme/shared";
import { z } from "zod";

/** Calls settled per run. Anything beyond this waits for the next run. */
export const MAX_CALLS_PER_RUN = 500;

/** A pending call whose market has resolved or been voided. */
export interface DueCall {
  id: string;
  userId: string;
  side: "yes" | "no" | null;
  instrumentSymbol: string | null;
  /** Price of the picked side at tweet time; null when the call is unpriced. */
  oddsAtCall: number | null;
  marketStatus: "resolved" | "void";
  /** markets.outcomes as stored (jsonb). */
  outcomes: unknown;
}

export type Settlement =
  | { kind: "scored"; won: boolean; points: number | null }
  | { kind: "void" }
  | { kind: "unsettleable"; reason: string };

const StoredContract = z.object({
  instrumentSymbol: z.string(),
  resolutionSide: z.enum(["yes", "no"]).nullish(),
});

/**
 * What happens to a call now that its market has finished.
 * - void market: the call is void.
 * - otherwise the pick wins when its contract's result equals the side picked.
 *   A priced call earns (1 if it won, else 0) minus the price it was made at; an unpriced one earns nothing.
 * - a call that cannot be judged (no side recorded, contract missing, no result stored yet) is left pending.
 */
export function settleCall(call: DueCall): Settlement {
  if (call.marketStatus === "void") return { kind: "void" };
  if (call.side === null || call.instrumentSymbol === null) {
    return { kind: "unsettleable", reason: "no side or contract recorded on the call" };
  }
  const contracts = z.array(StoredContract).safeParse(call.outcomes);
  const contract = contracts.success
    ? contracts.data.find((c) => c.instrumentSymbol === call.instrumentSymbol)
    : undefined;
  if (!contract) return { kind: "unsettleable", reason: "contract not found in the market" };
  if (!contract.resolutionSide) return { kind: "unsettleable", reason: "no result stored for the contract yet" };

  const won = contract.resolutionSide === call.side;
  return {
    kind: "scored",
    won,
    points: call.oddsAtCall === null ? null : (won ? 1 : 0) - call.oddsAtCall,
  };
}

/** Whether a scored call won, recovered from its stored points: a win earns exactly 1 minus its price. */
export function wonFrom(points: number, oddsAtCall: number): boolean {
  return Math.abs(points - (1 - oddsAtCall)) < 1e-9;
}

/** sha256 of the sorted `call_id:points` lines, so anyone can verify a snapshot from its calls. */
export function inputsHash(entries: readonly { id: string; points: number }[]): string {
  const lines = entries.map((e) => `${e.id}:${e.points}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export interface ScoredCall {
  id: string;
  oddsAtCall: number;
  points: number;
}

export interface ComputedScore {
  score: number;
  skill: number;
  nResolved: number;
  nWins: number;
  hitRate: number | null;
  change14d: number | null;
  callIds: string[];
  inputsHash: string;
}

/** A user's score from their priced, scored calls, using the same functions the unit tests cover. */
export function buildScore(calls: readonly ScoredCall[], snapshots: readonly ScoreSnapshotPoint[], now: Date): ComputedScore {
  const result = computeUserScore(calls.map((c) => ({ oddsAtCall: c.oddsAtCall, won: wonFrom(c.points, c.oddsAtCall) })));
  return {
    score: result.score,
    skill: result.skill,
    nResolved: result.nResolved,
    nWins: result.nWins,
    hitRate: result.hitRate,
    change14d: scoreChange14d(result.score, snapshots, now),
    callIds: calls.map((c) => c.id),
    inputsHash: inputsHash(calls),
  };
}

/** Everything the worker needs from the database. One instance lives for one transaction. */
export interface WorkerDb {
  /** Takes the worker lock for this transaction; false means another run holds it. */
  tryLock(): Promise<boolean>;
  dueCalls(limit: number): Promise<DueCall[]>;
  markCall(id: string, status: "scored" | "void", points: number | null): Promise<void>;
  /** The user's scored calls that have a price, which are the ones that count toward the score. */
  pricedScoredCalls(userId: string): Promise<ScoredCall[]>;
  lastCallAt(userId: string): Promise<Date | null>;
  snapshots(userId: string): Promise<ScoreSnapshotPoint[]>;
  insertSnapshot(s: { userId: string; score: number; callIds: string[]; inputsHash: string; computedAt: Date }): Promise<string>;
  upsertUserScore(r: {
    userId: string;
    score: number;
    change14d: number | null;
    skill: number;
    nResolved: number;
    nWins: number;
    hitRate: number | null;
    lastCallAt: Date | null;
    snapshotId: string;
    updatedAt: Date;
  }): Promise<void>;
  /** Handles for these users, for cache eviction. */
  handles(userIds: string[]): Promise<string[]>;
}

export interface WorkerStore {
  transaction<T>(fn: (db: WorkerDb) => Promise<T>): Promise<T>;
}

export interface WorkerSummary {
  /** Calls marked scored (priced or not). */
  settled: number;
  voided: number;
  /** Due calls that could not be judged and stay pending. */
  unsettleable: number;
  usersUpdated: number;
  /** Lowercase handles of the users whose score was recomputed. */
  handles: string[];
}

/**
 * One worker run, all in one transaction, so a failure leaves nothing half-done:
 * settle every pending call whose market has finished, then recompute the score and write a
 * snapshot for each user who had a call settled. Returns null when another run holds the lock.
 */
export async function runWorker(
  store: WorkerStore,
  now: Date = new Date(),
  limit: number = MAX_CALLS_PER_RUN,
  log: (message: string) => void = () => {},
): Promise<WorkerSummary | null> {
  return store.transaction(async (db) => {
    if (!(await db.tryLock())) return null;

    const due = await db.dueCalls(limit);
    let settled = 0;
    let voided = 0;
    let unsettleable = 0;
    const affected = new Set<string>();

    for (const call of due) {
      const result = settleCall(call);
      if (result.kind === "unsettleable") {
        unsettleable += 1;
        log(`call ${call.id} left pending: ${result.reason}`);
      } else if (result.kind === "void") {
        await db.markCall(call.id, "void", null);
        voided += 1;
      } else {
        await db.markCall(call.id, "scored", result.points);
        settled += 1;
        affected.add(call.userId);
      }
    }

    const userIds = [...affected];
    for (const userId of userIds) {
      const [calls, snapshots, lastCallAt] = await Promise.all([
        db.pricedScoredCalls(userId),
        db.snapshots(userId),
        db.lastCallAt(userId),
      ]);
      const score = buildScore(calls, snapshots, now);
      const snapshotId = await db.insertSnapshot({
        userId,
        score: score.score,
        callIds: score.callIds,
        inputsHash: score.inputsHash,
        computedAt: now,
      });
      await db.upsertUserScore({
        userId,
        score: score.score,
        change14d: score.change14d,
        skill: score.skill,
        nResolved: score.nResolved,
        nWins: score.nWins,
        hitRate: score.hitRate,
        lastCallAt,
        snapshotId,
        updatedAt: now,
      });
    }

    const handles = userIds.length ? await db.handles(userIds) : [];
    return { settled, voided, unsettleable, usersUpdated: userIds.length, handles: handles.map((h) => h.toLowerCase()) };
  });
}

export interface Worker {
  /** Runs once now. Returns null if a run is already in progress here or in another process. */
  runNow(): Promise<WorkerSummary | null>;
  start(): void;
  stop(): void;
}

/**
 * Runs the worker on an interval inside the API process. Runs never overlap in this process
 * (and the database lock stops overlap across processes). A failed run is logged and the
 * next one tries again. After a run, the badge cache is evicted for the users whose score changed.
 */
export function createWorker(opts: {
  store: WorkerStore;
  /** Drops cached badges for these lowercase handles. */
  evict: (handles: string[]) => void;
  intervalMs?: number;
  /** Wait before the first run after start. */
  initialDelayMs?: number;
  now?: () => number;
  log?: (message: string) => void;
}): Worker {
  const { store, evict, intervalMs = 5 * 60_000, initialDelayMs = 10_000, now = Date.now, log = console.log } = opts;
  let running = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let first: ReturnType<typeof setTimeout> | undefined;

  async function runNow(): Promise<WorkerSummary | null> {
    if (running) return null;
    running = true;
    try {
      const summary = await runWorker(store, new Date(now()), MAX_CALLS_PER_RUN, log);
      if (summary && summary.handles.length > 0) evict(summary.handles);
      return summary;
    } finally {
      running = false;
    }
  }

  async function tick() {
    try {
      const summary = await runNow();
      if (summary && (summary.settled || summary.voided || summary.unsettleable)) {
        log(
          `[worker] settled ${summary.settled}, voided ${summary.voided}, left pending ${summary.unsettleable}, rescored ${summary.usersUpdated} users`,
        );
      }
    } catch (err) {
      console.error("[worker] run failed", err);
    }
  }

  return {
    runNow,
    start() {
      first = setTimeout(() => {
        void tick();
        interval = setInterval(() => void tick(), intervalMs);
        interval.unref?.();
      }, initialDelayMs);
      first.unref?.();
    },
    stop() {
      clearTimeout(first);
      clearInterval(interval);
    },
  };
}
