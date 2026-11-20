import type { Rank } from "./messages.js";

/** How long the leaderboard is reused: ranks move slowly, and every popover asks. */
export const RANK_TTL_MS = 5 * 60_000;

/**
 * Leaderboard ranks for the background worker. The leaderboard (best first) is fetched once and
 * kept in memory for five minutes, and simultaneous asks share one request. A handle that is not
 * on it, or a leaderboard that could not be read, has no rank (null); a failure is not cached.
 */
export function createRankService(opts: {
  fetchLeaderboardHandles: () => Promise<string[]>;
  now?: () => number;
  ttlMs?: number;
}) {
  const { fetchLeaderboardHandles, now = Date.now, ttlMs = RANK_TTL_MS } = opts;
  let cached: { handles: string[]; at: number } | null = null;
  let inFlight: Promise<string[]> | null = null;

  function leaderboard(): Promise<string[]> {
    if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.handles);
    if (inFlight) return inFlight;
    const request = fetchLeaderboardHandles().then((list) => {
      const handles = list.map((h) => h.toLowerCase());
      cached = { handles, at: now() };
      return handles;
    });
    inFlight = request;
    const done = () => void (inFlight = null);
    request.then(done, done);
    return request;
  }

  return {
    async get(handle: string): Promise<Rank | null> {
      try {
        const handles = await leaderboard();
        const index = handles.indexOf(handle.toLowerCase());
        return index === -1 ? null : { rank: index + 1, total: handles.length };
      } catch {
        return null;
      }
    },
  };
}
