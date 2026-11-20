import type { CallEntry } from "./calls.js";

export const COPY_STEPS: readonly number[] = [1, 5, 10, 25, 50, 100];
export const DEFAULT_COPY_AMOUNT = 10;

const WEEK_MS = 7 * 86_400_000;

/** Nearest step; ties go to the larger step; clamped to the first/last step. */
export function snapToStep(amount: number): number {
  let best = COPY_STEPS[0]!;
  for (const s of COPY_STEPS) {
    if (Math.abs(s - amount) <= Math.abs(best - amount)) best = s;
  }
  return best;
}

/** Snap, then move one step, clamping at the ends. */
export function stepAmount(current: number, dir: 1 | -1): number {
  const i = COPY_STEPS.indexOf(snapToStep(current)) + dir;
  return COPY_STEPS[Math.min(COPY_STEPS.length - 1, Math.max(0, i))]!;
}

/** Dollars (rounded to cents) a copier staking amountUsdc per pick would have made over the past 7 days, or null if no picks qualify. */
export function pastWeekEarnings(calls: readonly CallEntry[], amountUsdc: number, now: Date): number | null {
  let total = 0;
  let count = 0;
  for (const c of calls) {
    if (c.result !== "won" && c.result !== "lost") continue;
    if (c.oddsAtCall === null || c.oddsAtCall <= 0 || c.oddsAtCall >= 1) continue;
    const age = now.getTime() - new Date(c.tweetedAt).getTime();
    if (!(age >= 0 && age < WEEK_MS)) continue;
    total += c.result === "won" ? amountUsdc * (1 / c.oddsAtCall - 1) : -amountUsdc;
    count++;
  }
  return count === 0 ? null : Math.round(total * 100) / 100;
}

/** Settled calls, newest first, at most n. */
export function recentSettled(calls: readonly CallEntry[], n = 3): CallEntry[] {
  return calls
    .filter((c) => c.result !== null)
    .sort((a, b) => b.tweetedAt.localeCompare(a.tweetedAt))
    .slice(0, n);
}
