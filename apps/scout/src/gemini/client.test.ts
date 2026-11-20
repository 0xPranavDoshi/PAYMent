import { describe, expect, it, vi } from "vitest";
import game from "../../test/fixtures/gemini-game.json" with { type: "json" };
import search from "../../test/fixtures/gemini-search.json" with { type: "json" };
import { createGeminiClient, GeminiError, PRICE_MAX_AGE_MS } from "./client.js";
import { GeminiEvent } from "./types.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const asFetch = (f: unknown) => f as typeof fetch;

describe("fixtures", () => {
  it("gemini-game.json parses with GeminiEvent", () => {
    const e = GeminiEvent.parse(game);
    expect(e.template).toBe("sports-game");
    expect(e.events?.length).toBeGreaterThan(0);
    expect(e.participants?.map((p) => p.abbreviation)).toContain("ARI");
  });
  it("gemini-search.json events parse", () => {
    for (const e of search.data) GeminiEvent.parse(e);
  });
});

/** A single page whose total equals its length. */
const onePage = () => json({ ...search, pagination: { ...search.pagination, total: search.data.length } });

const event = (i: number) => ({ ...search.data[0], id: `e${i}`, ticker: `T-${i}` });

describe("searchGames", () => {
  it("makes one request for full-game moneylines across every matchable status", async () => {
    const fetchMock = vi.fn(async (_url: string) => onePage());
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    const events = await client.searchGames("NCAAM-261119", { sport: "basketball" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(fetchMock.mock.calls[0]![0]);
    expect(url.pathname).toBe("/v1/prediction-markets/events");
    expect(url.searchParams.get("category")).toBe("Sports");
    expect(url.searchParams.get("search")).toBe("NCAAM-261119");
    expect(url.searchParams.getAll("status")).toEqual(["approved", "active", "under_review", "settled"]);
    expect(url.searchParams.get("sports_market_type")).toBe("moneyline");
    expect(url.searchParams.get("sports_market_scope")).toBe("full_contest");
    expect(url.searchParams.get("sport")).toBe("basketball");
    expect(url.searchParams.get("limit")).toBe("500");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(events).toHaveLength(search.data.length);
  });

  it("omits the sport filter when none is given", async () => {
    const fetchMock = vi.fn(async (_url: string) => onePage());
    await createGeminiClient({ fetch: asFetch(fetchMock) }).searchGames("-LAL-");
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.has("sport")).toBe(false);
  });

  it("allMarkets drops the moneyline/full-game filters (golf tournaments are tournament-scoped props)", async () => {
    const fetchMock = vi.fn(async (_url: string) => onePage());
    await createGeminiClient({ fetch: asFetch(fetchMock) }).searchGames("-WIN-", { sport: "golf", allMarkets: true });
    const params = new URL(fetchMock.mock.calls[0]![0]).searchParams;
    expect(params.has("sports_market_type")).toBe(false);
    expect(params.has("sports_market_scope")).toBe(false);
    expect(params.get("sport")).toBe("golf");
    expect(params.get("search")).toBe("-WIN-");
  });

  it("pages by 500 until pagination.total is reached", async () => {
    const all = Array.from({ length: 750 }, (_, i) => event(i));
    const fetchMock = vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json({ data: all.slice(offset, offset + 500), pagination: { limit: 500, offset, total: 750 } });
    });
    const events = await createGeminiClient({ fetch: asFetch(fetchMock) }).searchGames("Lakers");
    expect(events.map((e) => e.ticker)).toEqual(all.map((e) => e.ticker));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps paging at 4 pages", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () =>
      json({ data: Array.from({ length: 500 }, () => event(n++)), pagination: { total: 100_000 } }),
    );
    expect(await createGeminiClient({ fetch: asFetch(fetchMock) }).searchGames("Lakers")).toHaveLength(2000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("returns [] without fetching for terms shorter than 3 chars", async () => {
    const fetchMock = vi.fn();
    expect(await createGeminiClient({ fetch: asFetch(fetchMock) }).searchGames("LA")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares one request between identical searches in flight", async () => {
    const fetchMock = vi.fn(async () => onePage());
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    const [a, b] = await Promise.all([client.searchGames("NBA-261118"), client.searchGames("NBA-261118")]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("caches search results for 5 minutes", async () => {
    let t = 1_000_000;
    const fetchMock = vi.fn(async () => onePage());
    const client = createGeminiClient({ fetch: asFetch(fetchMock), now: () => t });
    await client.searchGames("Lakers");
    t += 4 * 60_000;
    await client.searchGames("Lakers");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 61_000;
    await client.searchGames("Lakers");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws GeminiError on non-2xx and on bad bodies, and doesn't cache failures", async () => {
    const bad = createGeminiClient({ fetch: asFetch(async () => json({ err: 1 }, 500)) });
    await expect(bad.searchGames("Lakers")).rejects.toBeInstanceOf(GeminiError);
    const junk = createGeminiClient({ fetch: asFetch(async () => new Response("<html>")) });
    await expect(junk.searchGames("Lakers")).rejects.toBeInstanceOf(GeminiError);
    const shape = createGeminiClient({ fetch: asFetch(async () => json({ nope: true })) });
    await expect(shape.searchGames("Lakers")).rejects.toBeInstanceOf(GeminiError);

    let fail = true;
    const flaky = vi.fn(async () => (fail ? json({ err: 1 }, 503) : onePage()));
    const client = createGeminiClient({ fetch: asFetch(flaky) });
    await expect(client.searchGames("Lakers")).rejects.toBeInstanceOf(GeminiError);
    fail = false;
    expect(await client.searchGames("Lakers")).toHaveLength(search.data.length);
  });
});

describe("getEvent", () => {
  it("fetches and caches by status", async () => {
    let t = 0;
    const fetchMock = vi.fn(async (_url: string) => json(game));
    const client = createGeminiClient({ fetch: asFetch(fetchMock), now: () => t });
    const e = await client.getEvent("NCAAM-2611190200-UCONN-ARI-M");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.gemini.com/v1/prediction-markets/events/NCAAM-2611190200-UCONN-ARI-M",
    );
    expect(e.id).toBe(game.id);
    await client.getEvent("NCAAM-2611190200-UCONN-ARI-M");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 6 * 60_000;
    await client.getEvent("NCAAM-2611190200-UCONN-ARI-M");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches settled events indefinitely", async () => {
    let t = 0;
    const fetchMock = vi.fn(async () => json({ ...game, status: "settled" }));
    const client = createGeminiClient({ fetch: asFetch(fetchMock), now: () => t });
    await client.getEvent("X-1");
    t += 1e12;
    await client.getEvent("X-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never caches a game that came back without its child markets", async () => {
    let calls = 0;
    // First response is missing `events` (Gemini does this occasionally); the second is complete.
    const fetchMock = vi.fn(async () => json(calls++ === 0 ? { ...game, status: "settled", events: [] } : { ...game, status: "settled" }));
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    expect((await client.getEvent("X-1")).events).toEqual([]);
    expect((await client.getEvent("X-1")).events?.length).toBeGreaterThan(0);
    await client.getEvent("X-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe("getYesPriceAt (candles)", () => {
    const T = Date.parse("2026-11-17T21:03:00Z");
    const MIN = 60_000;
    // [startMs, open, high, low, close, volume]
    const candle = (startMs: number, close: number) => [startMs, close, close, close, close, 10];
    const byInterval = (five: unknown, hour: unknown) =>
      vi.fn(async (url: string) => (url.endsWith("/5m") ? json(five) : json(hour)));

    it("returns the close of the last 5-minute candle starting at or before the tweet", async () => {
      const fetchMock = byInterval([candle(T - 10 * MIN, 0.35), candle(T - 3 * MIN, 0.39), candle(T + 2 * MIN, 0.5)], []);
      const client = createGeminiClient({ fetch: asFetch(fetchMock) });
      expect(await client.getYesPriceAt("GEMI-X-TOR", new Date(T))).toBe(0.39);
      expect(fetchMock.mock.calls[0]![0]).toBe("https://api.gemini.com/v2/candles/GEMI-X-TOR/5m");
    });

    it("falls back to hourly candles when there are no 5-minute ones", async () => {
      const fetchMock = byInterval({ result: "error", reason: "NoDataFound" }, [candle(T - 40 * MIN, 0.47)]);
      expect(await createGeminiClient({ fetch: asFetch(fetchMock) }).getYesPriceAt("S", new Date(T))).toBe(0.47);
    });

    it("returns null when the nearest candle is too old, or the tweet predates all candles", async () => {
      const stale = byInterval([candle(T - PRICE_MAX_AGE_MS - MIN, 0.4)], []);
      expect(await createGeminiClient({ fetch: asFetch(stale) }).getYesPriceAt("S", new Date(T))).toBeNull();
      const later = byInterval([candle(T + MIN, 0.4)], [candle(T + 60 * MIN, 0.4)]);
      expect(await createGeminiClient({ fetch: asFetch(later) }).getYesPriceAt("S", new Date(T))).toBeNull();
    });

    it("treats no data and network errors as no price, and caches candles per contract", async () => {
      const none = byInterval({ result: "error", reason: "NoDataFound" }, { result: "error", reason: "NoDataFound" });
      expect(await createGeminiClient({ fetch: asFetch(none) }).getYesPriceAt("S", new Date(T))).toBeNull();
      const down = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      expect(await createGeminiClient({ fetch: asFetch(down) }).getYesPriceAt("S", new Date(T))).toBeNull();
      const fetchMock = byInterval([candle(T - MIN, 0.4)], []);
      const client = createGeminiClient({ fetch: asFetch(fetchMock) });
      await client.getYesPriceAt("S", new Date(T));
      await client.getYesPriceAt("S", new Date(T - MIN));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("throws GeminiError on 404", async () => {
    const client = createGeminiClient({ fetch: asFetch(async () => json({}, 404)) });
    await expect(client.getEvent("nope")).rejects.toMatchObject({ name: "GeminiError", status: 404 });
  });
});

describe("request time limit", () => {
  it("fails a Gemini request that never answers instead of hanging the scan", async () => {
    // A server that never answers; it only gives up when the request is aborted.
    const silent = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const client = createGeminiClient({ fetch: silent as unknown as typeof fetch, timeoutMs: 30 });
    await expect(client.getEvent("NBA-2611190030-WAS-TOR-M")).rejects.toBeInstanceOf(GeminiError);
    expect(await client.getYesPriceAt("GEMI-X", new Date())).toBeNull();
  });
});
