import type { ProfileData } from "./messages.js";

/** How long a profile is reused, so reopening a popover right away costs nothing. */
export const PROFILE_TTL_MS = 60_000;

/** Popover data for the background worker: cached briefly, and shared between simultaneous requests. */
export function createProfileService(opts: {
  fetchProfileData: (handle: string) => Promise<ProfileData>;
  now?: () => number;
  ttlMs?: number;
}) {
  const { fetchProfileData, now = Date.now, ttlMs = PROFILE_TTL_MS } = opts;
  const cache = new Map<string, { data: ProfileData; at: number }>();
  const inFlight = new Map<string, Promise<ProfileData>>();
  /** Bumped by evict(), so an answer to a request that started before it is not cached. */
  const generation = new Map<string, number>();

  return {
    /**
     * Forgets a handle's popover data, e.g. when a scan has just added picks, so the next open reads the
     * new ones instead of the copy from up to a minute ago. A request still in flight is not reused.
     */
    evict(handle: string): void {
      cache.delete(handle);
      inFlight.delete(handle);
      generation.set(handle, (generation.get(handle) ?? 0) + 1);
    },

    async get(handle: string): Promise<ProfileData> {
      const hit = cache.get(handle);
      if (hit && now() - hit.at < ttlMs) return hit.data;

      const pending = inFlight.get(handle);
      if (pending) return pending;

      const started = generation.get(handle) ?? 0;
      const request = fetchProfileData(handle).then((data) => {
        if ((generation.get(handle) ?? 0) === started) cache.set(handle, { data, at: now() });
        return data;
      });
      inFlight.set(handle, request);
      const done = () => void inFlight.delete(handle);
      request.then(done, done);
      return request;
    },
  };
}
