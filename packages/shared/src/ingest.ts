import { z } from "zod";

/** Limits on one POST /v1/posts request. */
export const MAX_POSTS_PER_REQUEST = 50;
export const MAX_PICKS_PER_POST = 20;

const isoTime = z.string().datetime({ offset: true });

/**
 * One prediction found in a post, matched to a contract on Gemini.
 * Contract shape agreed in docs/design/grok-pipeline.md and scoring-and-extension.md.
 */
export const Pick = z.object({
  /** The market: a Gemini event ticker, the key in markets.gemini_market_id. */
  geminiEventTicker: z.string().min(1),
  instrumentSymbol: z.string().min(1),
  side: z.enum(["yes", "no"]),
  gameStartTime: isoTime,
  /** Set when the market had already settled when the scout looked. Ingest settles from the markets table instead. */
  resolutionSide: z.enum(["yes", "no"]).nullable(),
  resolvedAt: isoTime.nullable(),
  /** Price of the picked side when the tweet was sent, if Gemini had candles for it. Usually null. */
  oddsAtTweet: z.number().min(0).max(1).nullable(),
});
export type Pick = z.infer<typeof Pick>;

/** A post with the picks found in it. Posts with no pick are not sent; they stay in the scout's own table. */
export const NewPost = z.object({
  tweetId: z.string().min(1).max(64),
  xUserId: z.string().min(1).max(64),
  xHandle: z.string().regex(/^@?[A-Za-z0-9_]{1,15}$/),
  tweetedAt: isoTime,
  tweetText: z.string().max(10_000),
  /** Stored as sent. Its shape is defined in docs/design/grok-pipeline.md (Sentiment). */
  sentiment: z.unknown(),
  picks: z.array(Pick).max(MAX_PICKS_PER_POST),
});
export type NewPost = z.infer<typeof NewPost>;

/** POST /v1/posts body: one post or a batch. */
export const IngestRequest = z.union([
  NewPost,
  z.array(NewPost).min(1).max(MAX_POSTS_PER_REQUEST),
]);
export type IngestRequest = z.infer<typeof IngestRequest>;

export const SkipReason = z.enum([
  "no_market", // the market is not in our markets table (yet)
  "unknown_contract", // the market exists but has no such contract
  "market_void", // the market was cancelled
  "after_lock", // tweeted at or after the market's lock time
  "duplicate_pick", // the user already has a pick on this market that stays
]);
export type SkipReason = z.infer<typeof SkipReason>;

export const PickOutcome = z.object({
  /** Position in the post's picks array. */
  index: z.number().int().nonnegative(),
  status: z.enum(["created", "updated", "skipped"]),
  reason: SkipReason.optional(),
  callId: z.string().uuid().optional(),
  oddsSource: z.enum(["history", "snapshot", "none"]).optional(),
});
export type PickOutcome = z.infer<typeof PickOutcome>;

export const PostResult = z.object({
  tweetId: z.string(),
  postId: z.string().uuid().nullable(),
  picks: z.array(PickOutcome),
  /** Set when the whole post could not be stored; the scout should retry it. */
  error: z.string().optional(),
});
export type PostResult = z.infer<typeof PostResult>;

export const IngestResponse = z.object({ results: z.array(PostResult) });
export type IngestResponse = z.infer<typeof IngestResponse>;
