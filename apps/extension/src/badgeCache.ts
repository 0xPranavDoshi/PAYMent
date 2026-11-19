import { Badge } from "@copayme/shared";
import { z } from "zod";

/** A known handle's badge is reused for this long. */
export const BADGE_TTL_MS = 10 * 60_000;
/** A handle we have no data on is reused longer: it is the common case and changes rarely. */
export const NEGATIVE_TTL_MS = 30 * 60_000;
/** Expired entries are kept this long, to show something if the API is down. */
export const STALE_MAX_MS = 24 * 60 * 60_000;

/** The slice of chrome.storage.local the cache needs. */
export interface KeyValueStore {
  get(keys: string[]): Promise<Record<string, unknown>>;
  getAll(): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/** b = the badge (null: we have no data on this handle), t = when it was fetched. */
const Entry = z.object({ b: Badge.nullable(), t: z.number() });

export interface CacheRead {
  /** Still within its lifetime. */
  fresh: Map<string, Badge | null>;
  /** Past its lifetime but not yet discarded. */
  stale: Map<string, Badge | null>;
}

/**
 * Badges in chrome.storage.local, so they survive page loads and tabs. Keys carry a version
 * (the extension version), so an update starts from an empty cache instead of reading old shapes.
 */
export function createBadgeCache(opts: {
  store: KeyValueStore;
  version: string;
  now?: () => number;
}) {
  const { store, version, now = Date.now } = opts;
  const prefix = `badge:${version}:`;
  const key = (handle: string) => prefix + handle;

  return {
    async read(handles: readonly string[]): Promise<CacheRead> {
      const raw = await store.get(handles.map(key));
      const fresh = new Map<string, Badge | null>();
      const stale = new Map<string, Badge | null>();
      const t = now();
      for (const handle of handles) {
        const parsed = Entry.safeParse(raw[key(handle)]);
        if (!parsed.success) continue; // missing or corrupted: treat as a miss
        const { b, t: fetchedAt } = parsed.data;
        const age = t - fetchedAt;
        if (age < (b === null ? NEGATIVE_TTL_MS : BADGE_TTL_MS)) fresh.set(handle, b);
        else if (age < STALE_MAX_MS) stale.set(handle, b);
      }
      return { fresh, stale };
    },

    async write(entries: Readonly<Record<string, Badge | null>>): Promise<void> {
      const t = now();
      const items: Record<string, unknown> = {};
      for (const [handle, b] of Object.entries(entries)) items[key(handle)] = { b, t };
      if (Object.keys(items).length > 0) await store.set(items);
    },

    /** Removes entries from other versions, unreadable entries, and entries too old to be useful. */
    async prune(): Promise<number> {
      const all = await store.getAll();
      const t = now();
      const doomed = Object.entries(all)
        .filter(([k, v]) => {
          if (!k.startsWith("badge:")) return false;
          if (!k.startsWith(prefix)) return true;
          const parsed = Entry.safeParse(v);
          return !parsed.success || t - parsed.data.t >= STALE_MAX_MS;
        })
        .map(([k]) => k);
      if (doomed.length > 0) await store.remove(doomed);
      return doomed.length;
    },
  };
}

export type BadgeCache = ReturnType<typeof createBadgeCache>;
