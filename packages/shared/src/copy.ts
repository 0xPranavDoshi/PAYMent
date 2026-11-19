/**
 * Copy trading and watching should follow a pick at about the price its author saw.
 * A pick tweeted longer ago than this is never copied automatically, however it
 * reached us (for example, a scan of an old tweet). Both the scoring API (which decides
 * whether to notify) and the trading service (which enforces it) use this one value.
 */
export const MAX_COPY_PICK_AGE_S = 600;

/** True when the pick was tweeted recently enough to copy automatically. A tweet time in the future counts as fresh. */
export function isFreshForCopy(tweetedAt: Date | string, now: Date = new Date()): boolean {
  const ageS = (now.getTime() - new Date(tweetedAt).getTime()) / 1000;
  return ageS <= MAX_COPY_PICK_AGE_S;
}
