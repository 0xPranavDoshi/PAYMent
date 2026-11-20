import { getFollowerId } from "./session";
import { ocGetUser } from "./onchain";

/**
 * The signed-in admin, or null. Admins are X handles listed in ADMIN_X_HANDLES (comma-separated,
 * in apps/web/.env.local). Only they can see and run the daily payout.
 */
export async function getAdmin(): Promise<{ userId: string; handle: string } | null> {
  const allowed = (process.env.ADMIN_X_HANDLES ?? "")
    .split(",")
    .map((h) => h.trim().replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return null;
  const userId = await getFollowerId();
  if (!userId) return null;
  const user = await ocGetUser(userId).catch(() => null);
  return user && allowed.includes(user.handle.toLowerCase()) ? { userId, handle: user.handle } : null;
}
