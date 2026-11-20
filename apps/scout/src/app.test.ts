import { ScoutResponse, type Sentiment } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { PIPELINE_VERSION, createMemoryStore, type ScoutPostRow } from "./store.js";

const NOW = new Date("2026-11-18T13:00:00.000Z");
const MIN = 60_000;

const sentiment: Sentiment = { isPrediction: false, confidence: 0.9, predictions: [], model: "m" };

const post = (id: string, tweetedAt: string, o: Partial<ScoutPostRow> = {}): ScoutPostRow => ({
  tweetId: id,
  handle: "lebron",
  xUserId: "u1",
  tweetedAt: new Date(tweetedAt),
  text: `tweet ${id}`,
  isReply: false,
  quotedText: null,
  sentiment,
  matches: null,
  pipelineVersion: PIPELINE_VERSION,
  forwardedAt: null,
  ...o,
});

function setup(opts: { dailyNewHandles?: number; allowedOrigin?: string; forwards?: boolean } = {}) {
  const store = createMemoryStore();
  const startScan = vi.fn();
  const cancelScan = vi.fn();
  const app = createApp({ store, startScan, cancelScan, now: () => NOW, ...opts });
  const postHandle = (h: string, newest?: string) =>
    app.request(`/v1/scout/${encodeURIComponent(h)}${newest === undefined ? "" : `?newest=${newest}`}`, { method: "POST" });
  return { store, startScan, cancelScan, app, postHandle };
}

describe("POST /v1/scout/:handle", () => {
  it("treats @LeBron, lebron and LEBRON as one handle with one scan", async () => {
    const { startScan, postHandle, store } = setup();
    const a = await postHandle("@LeBron");
    const b = await postHandle("lebron");
    const c = await postHandle("LEBRON");
    expect([a.status, b.status, c.status]).toEqual([202, 202, 202]);
    expect(startScan).toHaveBeenCalledTimes(1);
    expect(startScan).toHaveBeenCalledWith("lebron", { fetchNew: true });
    expect(await store.countNewHandlesSince(new Date(0))).toBe(1);
    const body = ScoutResponse.parse(await a.json());
    expect(body).toMatchObject({ handle: "lebron", status: "running", scannedAt: null, results: [] });
  });

  it("with a newer tweet seen: serves a scan from 9 minutes ago from cache, rescans at 10", async () => {
    const { store, startScan, postHandle } = setup();
    await store.tryLock("lebron", new Date(NOW.getTime() - 20 * MIN));
    await store.finishScan("lebron", { newestTweetId: "100", xUserId: null, now: new Date(NOW.getTime() - 9 * MIN) });
    const fresh = await postHandle("lebron", "101");
    expect(fresh.status).toBe(200);
    expect(ScoutResponse.parse(await fresh.json()).status).toBe("idle");
    expect(startScan).not.toHaveBeenCalled();

    await store.finishScan("lebron", { newestTweetId: "100", xUserId: null, now: new Date(NOW.getTime() - 10 * MIN) });
    const stale = await postHandle("lebron", "101");
    expect(stale.status).toBe(202);
    expect(startScan).toHaveBeenCalledWith("lebron", { fetchNew: true });
  });

  it("without a newest tweet: serves from cache for an hour, rescans after", async () => {
    const { store, startScan, postHandle } = setup();
    await store.tryLock("lebron", new Date(NOW.getTime() - 120 * MIN));
    await store.finishScan("lebron", { newestTweetId: "100", xUserId: null, now: new Date(NOW.getTime() - 59 * MIN) });
    expect((await postHandle("lebron")).status).toBe(200);
    expect((await postHandle("lebron", "not-an-id")).status).toBe(200);
    expect(startScan).not.toHaveBeenCalled();

    await store.finishScan("lebron", { newestTweetId: "100", xUserId: null, now: new Date(NOW.getTime() - 60 * MIN) });
    expect((await postHandle("lebron")).status).toBe(202);
    expect(startScan).toHaveBeenCalledWith("lebron", { fetchNew: true });
  });

  describe("when the account has posted nothing new", () => {
    async function scannedLongAgo(store: ReturnType<typeof createMemoryStore>) {
      await store.tryLock("lebron", new Date(NOW.getTime() - 3 * 24 * 60 * MIN));
      await store.finishScan("lebron", {
        newestTweetId: "1990000000000000000",
        xUserId: null,
        now: new Date(NOW.getTime() - 2 * 24 * 60 * MIN),
      });
    }

    it("doesn't ask X, however long ago the last scan was", async () => {
      const { store, startScan, postHandle } = setup();
      await scannedLongAgo(store);
      for (const seen of ["1990000000000000000", "1980000000000000000"]) {
        const res = await postHandle("lebron", seen);
        expect(res.status).toBe(200);
        expect(ScoutResponse.parse(await res.json()).status).toBe("idle");
      }
      expect(startScan).not.toHaveBeenCalled();
    });

    it("still finishes posts that are pending, without fetching", async () => {
      const { store, startScan, postHandle } = setup();
      await scannedLongAgo(store);
      await store.upsertPosts([post("1", "2026-11-18T10:00:00.000Z", { sentiment: null })]);
      const res = await postHandle("lebron", "1990000000000000000");
      expect(res.status).toBe(202);
      expect(startScan).toHaveBeenCalledWith("lebron", { fetchNew: false });
    });

    it("retries forwarding matched picks that never reached the scoring API, without fetching (when forwarding)", async () => {
      const matched = {
        predictionIndex: 0, status: "matched" as const, reason: "golf WIN Michael Thorbjornsen", geminiEventTicker: "GOLF-RSM-WIN-20261122",
        gameTicker: "GOLF-RSM-WIN-20261122", instrumentSymbol: "GEMI-GOLF-RSM-WIN-20261122-THORBJORNSEN", contractLabel: "Michael Thorbjornsen",
        side: "yes" as const, gameStartTime: "2026-11-19T12:00:00.000Z", marketStatus: "open" as const, resolutionSide: null,
      };
      const unforwarded = post("1", "2026-11-18T10:00:00.000Z", { matches: [matched] });

      const on = setup({ forwards: true });
      await scannedLongAgo(on.store);
      await on.store.upsertPosts([unforwarded, post("2", "2026-11-18T09:00:00.000Z", { matches: [] })]);
      expect((await on.postHandle("lebron", "1990000000000000000")).status).toBe(202);
      expect(on.startScan).toHaveBeenCalledWith("lebron", { fetchNew: false });

      // Already forwarded, or forwarding off: nothing to do, served from cache.
      const done = setup({ forwards: true });
      await scannedLongAgo(done.store);
      await done.store.upsertPosts([{ ...unforwarded, forwardedAt: NOW }]);
      expect((await done.postHandle("lebron", "1990000000000000000")).status).toBe(200);
      const off = setup();
      await scannedLongAgo(off.store);
      await off.store.upsertPosts([unforwarded]);
      expect((await off.postHandle("lebron", "1990000000000000000")).status).toBe(200);
      expect(done.startScan).not.toHaveBeenCalled();
      expect(off.startScan).not.toHaveBeenCalled();
    });

    it("fetches when a newer tweet was seen (ids compared as numbers, not text)", async () => {
      const { store, startScan, postHandle } = setup();
      await scannedLongAgo(store);
      expect((await postHandle("lebron", "1990000000000000001")).status).toBe(202);
      expect(startScan).toHaveBeenCalledWith("lebron", { fetchNew: true });
    });
  });

  it("starts exactly one scan for two parallel POSTs", async () => {
    const { startScan, postHandle } = setup();
    const [a, b] = await Promise.all([postHandle("newbie"), postHandle("newbie")]);
    expect([a.status, b.status]).toEqual([202, 202]);
    expect(startScan).toHaveBeenCalledTimes(1);
  });

  it("caps new handles per day but still tops up known ones", async () => {
    const { startScan, postHandle, store } = setup({ dailyNewHandles: 2 });
    expect((await postHandle("one")).status).toBe(202);
    expect((await postHandle("two")).status).toBe(202);
    const capped = await postHandle("three");
    expect(capped.status).toBe(429);
    expect(await capped.json()).toEqual({ error: "daily_new_handle_cap" });
    expect(startScan).toHaveBeenCalledTimes(2);

    await store.finishScan("one", { newestTweetId: "5", xUserId: null, now: new Date(NOW.getTime() - 30 * MIN) });
    expect((await postHandle("one", "6")).status).toBe(202);
    expect(startScan).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid handle", async () => {
    const { startScan, postHandle } = setup();
    const res = await postHandle("bad handle!");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_handle" });
    expect(startScan).not.toHaveBeenCalled();
  });
});

describe("GET /v1/scout/:handle", () => {
  it("404s for an unknown handle", async () => {
    const { app } = setup();
    expect((await app.request("/v1/scout/nobody")).status).toBe(404);
  });

  it("returns results newest first, only read posts, matches null as []", async () => {
    const { app, store } = setup();
    await store.tryLock("lebron", NOW);
    await store.upsertPosts([
      post("1", "2026-11-17T10:00:00.000Z"),
      post("3", "2026-11-18T10:00:00.000Z"),
      post("2", "2026-11-17T20:00:00.000Z"),
      post("4", "2026-11-18T11:00:00.000Z", { sentiment: null }),
    ]);
    await store.finishScan("lebron", { newestTweetId: "4", xUserId: "u1", now: NOW });
    const res = await app.request("/v1/scout/LeBron");
    expect(res.status).toBe(200);
    const body = ScoutResponse.parse(await res.json());
    expect(body.status).toBe("idle");
    expect(body.scannedAt).toBe(NOW.toISOString());
    expect(body.results.map((r) => r.tweetId)).toEqual(["3", "2", "1"]);
    expect(body.results[0]?.matches).toEqual([]);
  });
});

describe("misc routes", () => {
  it("serves /health and 404s unknown routes", async () => {
    const { app } = setup();
    const health = await app.request("/health");
    expect(await health.json()).toEqual({ ok: true });
    expect((await app.request("/nope")).status).toBe(404);
  });

  it("sends CORS headers only for the allowed origin", async () => {
    const { app } = setup({ allowedOrigin: "https://copayme.test" });
    const ok = await app.request("/health", { headers: { Origin: "https://copayme.test" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://copayme.test");
    const other = await app.request("/health", { headers: { Origin: "https://evil.test" } });
    expect(other.headers.get("access-control-allow-origin")).not.toBe("https://evil.test");
  });

  it("adds no CORS headers when no origin is configured", async () => {
    const { app } = setup();
    const res = await app.request("/health", { headers: { Origin: "https://copayme.test" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("DELETE /v1/scout/:handle (stop a scan)", () => {
  const del = (app: ReturnType<typeof setup>["app"], h: string) => app.request(`/v1/scout/${encodeURIComponent(h)}`, { method: "DELETE" });

  it("asks a running scan to stop and answers 202 with its current state", async () => {
    const { app, cancelScan, postHandle } = setup();
    await postHandle("lebron"); // starts a scan: the handle is now running
    const res = await del(app, "@LeBron");
    expect(res.status).toBe(202);
    expect((await res.json()).status).toBe("running");
    expect(cancelScan).toHaveBeenCalledWith("lebron");
  });

  it("does nothing for a scan that is not running, and is safe to repeat", async () => {
    const { app, cancelScan, store } = setup();
    await store.tryLock("lebron", NOW);
    await store.finishScan("lebron", { newestTweetId: null, xUserId: null, now: NOW, fetched: true });
    const res = await del(app, "lebron");
    expect(res.status).toBe(200);
    await del(app, "lebron");
    expect(cancelScan).not.toHaveBeenCalled();
  });

  it("is 404 for a handle never scanned and 400 for an invalid one", async () => {
    const { app } = setup();
    expect((await del(app, "nobody")).status).toBe(404);
    expect((await del(app, "not valid!")).status).toBe(400);
  });
});
