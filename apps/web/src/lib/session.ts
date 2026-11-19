import { cookies } from "next/headers";

export const SESSION_COOKIE = "copayme_uid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Who is using the site. Until X login exists this is a user id kept in a cookie (see /signin);
 * Mugdha's login replaces how the cookie gets set, and nothing else here.
 */
export async function getFollowerId(): Promise<string | null> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return value && isUuid(value) ? value : null;
}
