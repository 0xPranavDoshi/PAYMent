import { describe, expect, it, vi } from "vitest";
import game from "../../test/fixtures/gemini-game.json" with { type: "json" };
import search from "../../test/fixtures/gemini-search.json" with { type: "json" };
import { createGeminiClient, GeminiError } from "./client.js";
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

  it("throws GeminiError on 404", async () => {
    const client = createGeminiClient({ fetch: asFetch(async () => json({}, 404)) });
    await expect(client.getEvent("nope")).rejects.toMatchObject({ name: "GeminiError", status: 404 });
  });
});
