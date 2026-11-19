import { z } from "zod";
import { Badge } from "./badge.js";

/** GET /v1/users/:handle: the badge fields plus the score breakdown for the popover. */
export const UserProfile = Badge.extend({
  /** Lowercase, without the @. */
  handle: z.string(),
  nWins: z.number().int().nonnegative(),
  /** Shrunk skill the score is computed from. */
  skill: z.number(),
  /** ISO timestamps. */
  lastCallAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  /** Latest snapshot: inputsHash is the sha256 of the calls behind the score. */
  latestSnapshot: z
    .object({ inputsHash: z.string(), computedAt: z.string().datetime() })
    .nullable(),
});
export type UserProfile = z.infer<typeof UserProfile>;

/** GET /v1/users/:handle/score-at: the user's score as of a past moment, from their score snapshots. */
export const ScoreAt = z.object({
  /** Null when we had no score for them yet at that moment (no snapshot that old). */
  score: z.number().int().min(0).max(100).nullable(),
  /** When that score was computed. */
  computedAt: z.string().datetime().nullable(),
});
export type ScoreAt = z.infer<typeof ScoreAt>;
