const TWITTER_EPOCH_MS = 1288834974657n;

/** Decode the creation time embedded in an X snowflake tweet id. */
export function tweetIdToDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + TWITTER_EPOCH_MS));
}
