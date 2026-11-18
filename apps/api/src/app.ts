import {
  MAX_BADGE_HANDLES,
  XHandle,
  tierFor,
  type Badge,
  type BadgesResponse,
  type UserProfile,
} from "@copayme/shared";
import { Hono } from "hono";
import { TtlLru } from "./cache.js";
import type { ScoreRow, ScoreStore } from "./store.js";

export const BADGE_CACHE_MAX = 5_000;
export const BADGE_CACHE_TTL_MS = 60_000;

export interface AppDeps {
  store: ScoreStore;
  now?: () => number;
}

function toBadge(row: ScoreRow): Badge {
  return {
    score: row.score,
    change14d: row.scoreChange14d,
    tier: tierFor(row.nResolved),
    nResolved: row.nResolved,
    hitRate: row.hitRate,
  };
}

function toProfile(row: ScoreRow): UserProfile {
  return {
    ...toBadge(row),
    handle: row.handle,
    nWins: row.nWins,
    skill: row.skill,
    lastCallAt: row.lastCallAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    latestSnapshot: row.latestSnapshot
      ? {
          inputsHash: row.latestSnapshot.inputsHash,
          computedAt: row.latestSnapshot.computedAt.toISOString(),
        }
      : null,
  };
}

export function createApp({ store, now = Date.now }: AppDeps) {
  const app = new Hono();
  // Badge per lowercase handle. Unknown handles are cached as null so a busy
  // timeline does not hit the database for the same unknown handle every time.
  const badgeCache = new TtlLru<Badge | null>(BADGE_CACHE_MAX, BADGE_CACHE_TTL_MS, now);

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/v1/badges", async (c) => {
    const raw = (c.req.query("handles") ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (raw.length === 0) {
      return c.json({ error: "handles query parameter is required" }, 400);
    }
    if (raw.length > MAX_BADGE_HANDLES) {
      return c.json({ error: `at most ${MAX_BADGE_HANDLES} handles per request` }, 400);
    }

    const handles: string[] = [];
    const invalid: string[] = [];
    for (const h of raw) {
      const parsed = XHandle.safeParse(h);
      if (parsed.success) handles.push(parsed.data);
      else invalid.push(h);
    }
    if (invalid.length > 0) {
      return c.json({ error: `invalid handles: ${invalid.join(", ")}` }, 400);
    }

    const result: BadgesResponse = {};
    const missing: string[] = [];
    for (const handle of new Set(handles)) {
      const hit = badgeCache.get(handle);
      if (hit) result[handle] = hit.value;
      else missing.push(handle);
    }

    if (missing.length > 0) {
      const rows = await store.findByHandles(missing);
      const found = new Map(rows.map((r) => [r.handle, toBadge(r)]));
      for (const handle of missing) {
        const badge = found.get(handle) ?? null;
        badgeCache.set(handle, badge);
        result[handle] = badge;
      }
    }

    return c.json(result);
  });

  app.get("/v1/users/:handle", async (c) => {
    const parsed = XHandle.safeParse(c.req.param("handle"));
    if (!parsed.success) return c.json({ error: "invalid handle" }, 400);
    const [row] = await store.findByHandles([parsed.data]);
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json(toProfile(row));
  });

  return Object.assign(app, {
    /** Called by the worker after it recomputes scores, so the next lookup reads fresh data. */
    evictBadges(handles: readonly string[]) {
      for (const h of handles) badgeCache.delete(h.toLowerCase());
    },
  });
}
