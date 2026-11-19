import { BadgesResponse, MAX_BADGE_HANDLES } from "@copayme/shared";
import { API_URL, MOCK } from "./config.js";
import { mockBadges } from "./mock.js";

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
