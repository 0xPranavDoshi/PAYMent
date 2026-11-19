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

  return {
    async get(handle: string): Promise<ProfileData> {
      const hit = cache.get(handle);
      if (hit && now() - hit.at < ttlMs) return hit.data;

      const pending = inFlight.get(handle);
      if (pending) return pending;

      const request = fetchProfileData(handle).then((data) => {
        cache.set(handle, { data, at: now() });
        return data;
      });
      inFlight.set(handle, request);
      const done = () => void inFlight.delete(handle);
      request.then(done, done);
      return request;
    },
  };
}
