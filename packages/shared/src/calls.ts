import { z } from "zod";

export const DEFAULT_CALLS_LIMIT = 20;
export const MAX_CALLS_LIMIT = 50;

export const CallStatus = z.enum(["pending", "scored", "void", "rejected"]);
export type CallStatus = z.infer<typeof CallStatus>;

/** One pick in a user's call ledger (GET /v1/users/:handle/calls), newest first. */
export const CallEntry = z.object({
  callId: z.string().uuid(),
  /** The tweet the pick came from: https://x.com/i/status/<tweetId>. */
  tweetId: z.string(),
  tweetedAt: z.string().datetime(),
  /** The tweet's text as we stored it when the pick was ingested. */
  tweetText: z.string(),
  /** The game, e.g. "UConn vs Arizona". */
  eventName: z.string(),
  /** The contract picked, e.g. "UConn". */
  pickLabel: z.string(),
  side: z.enum(["yes", "no"]).nullable(),
  /** Price of the picked side when the tweet was sent; null when unpriced. */
  oddsAtCall: z.number().min(0).max(1).nullable(),
  oddsSource: z.enum(["history", "snapshot", "none"]),
  status: CallStatus,
  /** Whether the pick won, once the market has a result. Null while pending or void. */
  result: z.enum(["won", "lost"]).nullable(),
  /** Null for unpriced and unsettled calls. */
  points: z.number().nullable(),
});
export type CallEntry = z.infer<typeof CallEntry>;

export const CallsResponse = z.array(CallEntry);
export type CallsResponse = z.infer<typeof CallsResponse>;
