import { XHandle, type ScoutResponse } from "@copayme/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ScoutHandleRow, ScoutStore } from "./store.js";

export interface AppDeps {
  store: ScoutStore;
  /**
   * Called after the lock is taken. Fire and forget. `fetchNew: false`: nothing new was posted, so
   * skip X and only finish pending posts.
   */
  startScan: (handle: string, opts: { fetchNew: boolean }) => void;
  /** Asks a running scan to stop at its next checkpoint. Without it, DELETE /v1/scout/:handle does nothing. */
  cancelScan?: (handle: string) => void;
  now?: () => Date;
  dailyNewHandles?: number;
  allowedOrigin?: string;
}

/** A scan this recent is served from cache when the caller says there are newer tweets... */
const FRESH_MS = 10 * 60_000;
/** ...and this recent when the caller can't say (no `newest`), since every fetch from X costs. */
const FRESH_UNHINTED_MS = 60 * 60_000;
const TWEET_ID = /^\d{1,25}$/;

/** True when `newest` (the newest tweet the caller saw) is not newer than the newest one we have. */
export function nothingNewSince(newest: string | undefined, stored: string | null): boolean {
  if (!newest || !TWEET_ID.test(newest) || !stored || !TWEET_ID.test(stored)) return false;
  return BigInt(newest) <= BigInt(stored);
}

export function createApp(deps: AppDeps): Hono {
  const { store, startScan } = deps;
  const now = deps.now ?? (() => new Date());
  const dailyNewHandles = deps.dailyNewHandles ?? 30;
  const app = new Hono();

  if (deps.allowedOrigin) app.use("*", cors({ origin: deps.allowedOrigin }));

  async function buildResponse(
    handle: string,
    row: Pick<ScoutHandleRow, "status" | "scannedAt"> | null,
  ): Promise<ScoutResponse> {
    const posts = await store.listPosts(handle);
    return {
      handle,
      status: row?.status ?? "running",
      scannedAt: row?.scannedAt?.toISOString() ?? null,
      results: posts.flatMap((p) =>
        p.sentiment === null
          ? []
          : [
              {
                tweetId: p.tweetId,
                tweetedAt: p.tweetedAt.toISOString(),
                tweetText: p.text,
                sentiment: p.sentiment,
                matches: p.matches ?? [],
              },
            ],
      ),
    };
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/v1/scout/:handle", async (c) => {
    const parsed = XHandle.safeParse(c.req.param("handle"));
    if (!parsed.success) return c.json({ error: "invalid_handle" }, 400);
    const handle = parsed.data;
    const t = now();

    // ?newest=<tweet id>: the newest tweet by this account the extension saw on its profile.
    const newest = c.req.query("newest")?.trim();
    const hinted = newest !== undefined && TWEET_ID.test(newest);

    const row = await store.getHandle(handle);
    if (row && row.status !== "running") {
      // Nothing posted since our last fetch: X (Apify) isn't asked. Only posts still pending (game not
      // listed yet, a failed read) are worked on, which costs nothing from X.
      if (hinted && nothingNewSince(newest, row.newestTweetId)) {
        if ((await store.pendingPosts(handle)).length > 0 && (await store.tryLock(handle, t))) {
          startScan(handle, { fetchNew: false });
          return c.json(await buildResponse(handle, { status: "running", scannedAt: row.scannedAt }), 202);
        }
        return c.json(await buildResponse(handle, row), 200);
      }
      const freshFor = hinted ? FRESH_MS : FRESH_UNHINTED_MS;
      if (row.scannedAt && t.getTime() - row.scannedAt.getTime() < freshFor) {
        return c.json(await buildResponse(handle, row), 200);
      }
    }

    if (!row) {
      const startOfDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
      if ((await store.countNewHandlesSince(startOfDay)) >= dailyNewHandles) {
        return c.json({ error: "daily_new_handle_cap" }, 429);
      }
    }

    if (await store.tryLock(handle, t)) {
      startScan(handle, { fetchNew: true });
      return c.json(await buildResponse(handle, { status: "running", scannedAt: row?.scannedAt ?? null }), 202);
    }
    return c.json(await buildResponse(handle, await store.getHandle(handle)), 202);
  });

  // Stop a scan that is running (the user pressed Stop). It halts at the next checkpoint, so the paid
  // stages that have not started yet are skipped; one already in flight finishes. Idempotent.
  app.delete("/v1/scout/:handle", async (c) => {
    const parsed = XHandle.safeParse(c.req.param("handle"));
    if (!parsed.success) return c.json({ error: "invalid_handle" }, 400);
    const row = await store.getHandle(parsed.data);
    if (!row) return c.json({ error: "not_found" }, 404);
    if (row.status === "running") deps.cancelScan?.(parsed.data);
    return c.json(await buildResponse(parsed.data, row), row.status === "running" ? 202 : 200);
  });

  app.get("/v1/scout/:handle", async (c) => {
    const parsed = XHandle.safeParse(c.req.param("handle"));
    if (!parsed.success) return c.json({ error: "invalid_handle" }, 400);
    const row = await store.getHandle(parsed.data);
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json(await buildResponse(parsed.data, row));
  });

  return app;
}
