import { REWARD_MIN_USDC, REWARD_RATE } from "./config.js";

/**
 * The USDC reward a creator earns when a follower tails their pick with `tailAmountUsdc`.
 * A fraction of the stake, floored, rounded to 6 dp (USDC's micropayment precision).
 */
export function rewardAmount(tailAmountUsdc: number): number {
  const raw = Math.max(tailAmountUsdc * REWARD_RATE, REWARD_MIN_USDC);
  return Math.round(raw * 1e6) / 1e6;
}
