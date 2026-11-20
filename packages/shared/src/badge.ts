import { z } from "zod";

/** Max handles per GET /v1/badges request. */
export const MAX_BADGE_HANDLES = 50;

export const Badge = z.object({
  score: z.number().int().min(0).max(100),
  /** null when there is no snapshot at least 14 days old. */
  change14d: z.number().int().nullable(),
  tier: z.enum(["new", "scored"]),
  nResolved: z.number().int().nonnegative(),
  /** null when there are no resolved calls. */
  hitRate: z.number().min(0).max(1).nullable(),
});
export type Badge = z.infer<typeof Badge>;

/** GET /v1/badges response: one entry per requested handle, null for handles we have no data on. */
export const BadgesResponse = z.record(z.string(), Badge.nullable());
export type BadgesResponse = z.infer<typeof BadgesResponse>;

/** X handles: 1 to 15 letters, digits or underscores. Lookups are case-insensitive. */
export const XHandle = z
  .string()
  .regex(/^@?[A-Za-z0-9_]{1,15}$/)
  .transform((h) => h.replace(/^@/, "").toLowerCase());

/** The badge for a profile: the profile carries the same fields, so a fresher profile can refresh the badge. */
export function badgeFromProfile(profile: Badge): Badge {
  return { score: profile.score, change14d: profile.change14d, tier: profile.tier, nResolved: profile.nResolved, hitRate: profile.hitRate };
}
