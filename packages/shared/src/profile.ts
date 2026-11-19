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
