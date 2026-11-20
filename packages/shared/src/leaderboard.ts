import { z } from "zod";
import { Badge } from "./badge.js";

export const DEFAULT_LEADERBOARD_LIMIT = 50;
export const MAX_LEADERBOARD_LIMIT = 100;

/** One row of GET /v1/leaderboard: the badge fields plus the handle (lowercase, no @) and skill (average points per pick, in dollars, as on UserProfile). */
export const LeaderboardEntry = Badge.extend({ handle: z.string(), skill: z.number() });
export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;
