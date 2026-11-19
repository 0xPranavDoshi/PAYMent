import type { Badge, BadgesResponse } from "@copayme/shared";
import type { BadgeCache } from "./badgeCache.js";

/**
 * Answers badge lookups for the background worker: from the cache when it can, from the API for
 * the rest, in one request however many tabs are asking. If the API fails, handles that have an
 * old cached badge still get it; if any handle has nothing at all, the lookup fails so the page
 * tries again later instead of recording "no data".
 */
export function createBadgeService(opts: {
  cache: BadgeCache;
  fetchBadges: (handles: string[]) => Promise<BadgesResponse>;
}) {
  const { cache, fetchBadges } = opts;
  /** Handles being fetched right now, shared by every caller that asks for them. */
  const inFlight = new Map<string, Promise<Badge | null>>();

  async function lookup(handles: readonly string[]): Promise<BadgesResponse> {
    const wanted = [...new Set(handles)];
    const { fresh, stale } = await cache.read(wanted);

    const result: BadgesResponse = {};
    const missing: string[] = [];
    for (const handle of wanted) {
      if (fresh.has(handle)) result[handle] = fresh.get(handle)!;
      else missing.push(handle);
    }
    if (missing.length === 0) return result;

    const joined: [string, Promise<Badge | null>][] = [];
    const mine: string[] = [];
    for (const handle of missing) {
      const pending = inFlight.get(handle);
      if (pending) joined.push([handle, pending]);
      else mine.push(handle);
    }

    const settle = (handle: string, value: Badge | null) => {
      result[handle] = value;
    };
    const fallback = (handle: string, err: unknown) => {
      if (!stale.has(handle)) throw err;
      settle(handle, stale.get(handle)!);
    };

    if (mine.length > 0) {
      const batch = fetchBadges(mine).then((badges) => {
        const entries: Record<string, Badge | null> = {};
        for (const handle of mine) entries[handle] = badges[handle] ?? null;
        return entries;
      });
      for (const handle of mine) {
        const one = batch.then((entries) => entries[handle]!);
        inFlight.set(handle, one);
        const done = () => void inFlight.delete(handle);
        one.then(done, done);
      }
      try {
        const entries = await batch;
        await cache.write(entries);
        for (const handle of mine) settle(handle, entries[handle]!);
      } catch (err) {
        for (const handle of mine) fallback(handle, err);
      }
    }

    for (const [handle, pending] of joined) {
      try {
        settle(handle, await pending);
      } catch (err) {
        fallback(handle, err);
      }
    }
    return result;
  }

  return { lookup };
}

export type BadgeService = ReturnType<typeof createBadgeService>;
