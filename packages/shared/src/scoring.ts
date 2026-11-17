/**
 * "Beat the market, shrunk for small samples" scoring.
 * Spec: docs/design/scoring-and-extension.md, "Scoring" and "Score change arrow".
 */

/** Phantom zero-point calls added to every record. Open decision: 10 vs 20 (issue #5). */
export const SHRINKAGE_K = 10;

/** Skill at which tanh reaches ~0.76, i.e. a score of ~88. */
export const SKILL_SCALE = 0.15;

/** Users with fewer resolved calls than this show a "New" badge instead of a number. */
export const NEW_BADGE_MIN_RESOLVED = 5;

/** The change arrow compares against the latest snapshot at least this old. */
export const CHANGE_WINDOW_DAYS = 14;

/** Changes smaller than this many points show no arrow. */
export const MIN_ARROW_CHANGE = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

export type Tier = "new" | "scored";

/** A call whose market has resolved (void calls are excluded before scoring). */
export interface ResolvedCall {
  /** Market-implied probability of the picked outcome when the user tweeted, 0 to 1. */
  oddsAtCall: number;
  /** Whether the picked outcome won. */
  won: boolean;
}

export interface UserScore {
  score: number;
  skill: number;
  nResolved: number;
  nWins: number;
  /** null when there are no resolved calls. */
  hitRate: number | null;
  tier: Tier;
}

/** Points for one call: what a $1 contract bought at the call-time price would have made. */
export function callPoints(call: ResolvedCall): number {
  const p = call.oddsAtCall;
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new RangeError(`oddsAtCall must be between 0 and 1, got ${p}`);
  }
  return (call.won ? 1 : 0) - p;
}

/** Total points shrunk toward zero by k phantom zero-point calls. */
export function skillFromPoints(points: readonly number[], k: number = SHRINKAGE_K): number {
  const total = points.reduce((sum, x) => sum + x, 0);
  return total / (points.length + k);
}

/** Maps skill onto 0 to 100, with 50 meaning no edge over the market. */
export function scoreFromSkill(skill: number): number {
  return Math.round(50 + 50 * Math.tanh(skill / SKILL_SCALE));
}

export function tierFor(nResolved: number): Tier {
  return nResolved < NEW_BADGE_MIN_RESOLVED ? "new" : "scored";
}

export function computeUserScore(
  calls: readonly ResolvedCall[],
  k: number = SHRINKAGE_K,
): UserScore {
  const points = calls.map(callPoints);
  const skill = skillFromPoints(points, k);
  const nResolved = calls.length;
  const nWins = calls.filter((c) => c.won).length;
  return {
    score: scoreFromSkill(skill),
    skill,
    nResolved,
    nWins,
    hitRate: nResolved > 0 ? nWins / nResolved : null,
    tier: tierFor(nResolved),
  };
}

export interface ScoreSnapshotPoint {
  score: number;
  computedAt: Date;
}

/**
 * Current score minus the score in the latest snapshot at least 14 days old.
 * null when no snapshot is that old yet.
 */
export function scoreChange14d(
  currentScore: number,
  snapshots: readonly ScoreSnapshotPoint[],
  now: Date = new Date(),
): number | null {
  const cutoff = now.getTime() - CHANGE_WINDOW_DAYS * DAY_MS;
  let baseline: ScoreSnapshotPoint | null = null;
  for (const s of snapshots) {
    const t = s.computedAt.getTime();
    if (t <= cutoff && (baseline === null || t > baseline.computedAt.getTime())) {
      baseline = s;
    }
  }
  return baseline === null ? null : currentScore - baseline.score;
}

export interface ChangeArrow {
  direction: "up" | "down";
  amount: number;
}

/** What the badge shows next to the score, e.g. "72 ▲8". null means no arrow. */
export function changeArrow(change14d: number | null): ChangeArrow | null {
  if (change14d === null || Math.abs(change14d) < MIN_ARROW_CHANGE) return null;
  return { direction: change14d > 0 ? "up" : "down", amount: Math.abs(change14d) };
}
