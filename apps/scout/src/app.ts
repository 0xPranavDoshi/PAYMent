import { XHandle, type ScoutResponse } from "@copayme/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ScoutHandleRow, ScoutStore } from "./store.js";

export interface AppDeps {
  store: ScoutStore;
  /** Called after the lock is taken. Fire and forget. */
  startScan: (handle: string) => void;
  now?: () => Date;
  dailyNewHandles?: number;
  allowedOrigin?: string;
}

const FRESH_MS = 10 * 60_000;

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

    const row = await store.getHandle(handle);
    if (row && row.status !== "running" && row.scannedAt && t.getTime() - row.scannedAt.getTime() < FRESH_MS) {
      return c.json(await buildResponse(handle, row), 200);
    }

    if (!row) {
      const startOfDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
      if ((await store.countNewHandlesSince(startOfDay)) >= dailyNewHandles) {
        return c.json({ error: "daily_new_handle_cap" }, 429);
      }
    }

    if (await store.tryLock(handle, t)) {
      startScan(handle);
      return c.json(await buildResponse(handle, { status: "running", scannedAt: row?.scannedAt ?? null }), 202);
    }
    return c.json(await buildResponse(handle, await store.getHandle(handle)), 202);
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
