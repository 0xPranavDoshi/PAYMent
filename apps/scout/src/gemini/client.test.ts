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

/** The recorded first page; any later offset returns an empty page. */
const pagedSearch = vi.fn(async (url: string) =>
  new URL(url).searchParams.get("offset") === "0" ? json(search) : json({ ...search, data: [] }),
);
/** A single page whose total equals its length. */
const onePage = () => json({ ...search, pagination: { ...search.pagination, total: search.data.length } });

const event = (i: number) => ({ ...search.data[0], id: `e${i}`, ticker: `T-${i}` });

describe("searchEvents", () => {
  it("calls the search endpoint and stops on an empty page", async () => {
    pagedSearch.mockClear();
    const client = createGeminiClient({ fetch: asFetch(pagedSearch) });
    const events = await client.searchEvents("Lakers", "active");
    expect(pagedSearch.mock.calls[0]![0]).toBe(
      "https://api.gemini.com/v1/prediction-markets/events?category=Sports&status=active&search=Lakers&limit=50&offset=0",
    );
    // the recorded fixture says total 8 but holds 5 items, so a second page is requested and comes back empty
    expect(pagedSearch).toHaveBeenCalledTimes(2);
    expect(pagedSearch.mock.calls[1]![0]).toContain("&limit=50&offset=50");
    expect(events.length).toBe(search.data.length);
  });

  it("pages through results until pagination.total is reached", async () => {
    const all = Array.from({ length: 75 }, (_, i) => event(i));
    const fetchMock = vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json({ data: all.slice(offset, offset + 50), pagination: { limit: 50, offset, total: 75 } });
    });
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    const events = await client.searchEvents("Lakers", "settled");
    expect(events).toHaveLength(75);
    expect(events.map((e) => e.ticker)).toEqual(all.map((e) => e.ticker));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps paging at 10 pages", async () => {
    let n = 0;
    const fetchMock = vi.fn(async () =>
      json({ data: Array.from({ length: 50 }, () => event(n++)), pagination: { total: 100_000 } }),
    );
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    expect(await client.searchEvents("Lakers", "active")).toHaveLength(500);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it("searches under_review", async () => {
    const fetchMock = vi.fn(async (_url: string) => onePage());
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    await client.searchEvents("Lakers", "under_review");
    expect(fetchMock.mock.calls[0]![0]).toContain("status=under_review&");
  });

  it("returns [] without fetching for terms shorter than 3 chars", async () => {
    const fetchMock = vi.fn();
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    expect(await client.searchEvents("LA", "active")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches active searches for 5 minutes", async () => {
    let t = 1_000_000;
    const fetchMock = vi.fn(async () => onePage());
    const client = createGeminiClient({ fetch: asFetch(fetchMock), now: () => t });
    await client.searchEvents("Lakers", "active");
    t += 4 * 60_000;
    await client.searchEvents("Lakers", "active");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 61_000;
    await client.searchEvents("Lakers", "active");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["settled", "under_review"] as const)("caches %s searches for 10 minutes", async (status) => {
    let t = 0;
    const fetchMock = vi.fn(async () => onePage());
    const client = createGeminiClient({ fetch: asFetch(fetchMock), now: () => t });
    await client.searchEvents("Lakers", status);
    t += 9 * 60_000;
    await client.searchEvents("Lakers", status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 61_000;
    await client.searchEvents("Lakers", status);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws GeminiError on non-2xx and on bad bodies", async () => {
    const bad = createGeminiClient({ fetch: asFetch(async () => json({ err: 1 }, 500)) });
    await expect(bad.searchEvents("Lakers", "active")).rejects.toBeInstanceOf(GeminiError);
    const junk = createGeminiClient({ fetch: asFetch(async () => new Response("<html>")) });
    await expect(junk.searchEvents("Lakers", "active")).rejects.toBeInstanceOf(GeminiError);
    const shape = createGeminiClient({ fetch: asFetch(async () => json({ nope: true })) });
    await expect(shape.searchEvents("Lakers", "active")).rejects.toBeInstanceOf(GeminiError);
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

  it("throws GeminiError on 404", async () => {
    const client = createGeminiClient({ fetch: asFetch(async () => json({}, 404)) });
    await expect(client.getEvent("nope")).rejects.toMatchObject({ name: "GeminiError", status: 404 });
  });
});
