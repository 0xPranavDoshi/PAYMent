import { BadgesResponse, CallsResponse, MAX_BADGE_HANDLES, MAX_LEADERBOARD_LIMIT, UserProfile } from "@copayme/shared";
import { z } from "zod";
import { API_URL, MOCK } from "./config.js";
import type { ProfileData } from "./messages.js";
import { mockBadges, mockLeaderboard, mockProfileData } from "./mock.js";

/** Runs in the background worker. Splits into requests of at most 50 handles, the API's limit. */
export async function fetchBadges(
  handles: readonly string[],
  fetcher: typeof fetch = fetch,
): Promise<BadgesResponse> {
  if (MOCK) return mockBadges(handles);

  const result: BadgesResponse = {};
  for (let i = 0; i < handles.length; i += MAX_BADGE_HANDLES) {
    const chunk = handles.slice(i, i + MAX_BADGE_HANDLES);
    const url = new URL("/v1/badges", API_URL);
    url.searchParams.set("handles", chunk.join(","));
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`badges request failed: ${res.status}`);
    Object.assign(result, BadgesResponse.parse(await res.json()));
  }
  return result;
}

/** A user's profile, or null when we have no record of them. Runs in the background worker. */
export async function fetchProfile(handle: string, fetcher: typeof fetch = fetch): Promise<UserProfile | null> {
  const res = await fetcher(new URL(`/v1/users/${encodeURIComponent(handle)}`, API_URL));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`profile request failed: ${res.status}`);
  return UserProfile.parse(await res.json());
}

/** A user's latest picks, newest first. */
export async function fetchCalls(handle: string, limit: number, fetcher: typeof fetch = fetch): Promise<CallsResponse> {
  const url = new URL(`/v1/users/${encodeURIComponent(handle)}/calls`, API_URL);
  url.searchParams.set("limit", String(limit));
  const res = await fetcher(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`calls request failed: ${res.status}`);
  return CallsResponse.parse(await res.json());
}

/**
 * Everything the popover shows, fetched together. 50 picks (the API's most) so the copy slip's
 * "Past week" can count a whole week of them; the card itself lists only the latest two.
 */
export async function fetchProfileData(handle: string, limit = 50, fetcher: typeof fetch = fetch): Promise<ProfileData> {
  if (MOCK) return mockProfileData(handle);
  const [profile, calls] = await Promise.all([fetchProfile(handle, fetcher), fetchCalls(handle, limit, fetcher)]);
  return { profile, calls };
}

/** The leaderboard's handles, best first (at most 100, the API's limit). Runs in the background worker. */
export async function fetchLeaderboardHandles(fetcher: typeof fetch = fetch): Promise<string[]> {
  if (MOCK) return mockLeaderboard();
  const url = new URL("/v1/leaderboard", API_URL);
  url.searchParams.set("limit", String(MAX_LEADERBOARD_LIMIT));
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`leaderboard request failed: ${res.status}`);
  return z.array(z.object({ handle: z.string() })).parse(await res.json()).map((row) => row.handle);
}
