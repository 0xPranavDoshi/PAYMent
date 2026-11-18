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

describe("searchEvents", () => {
  it("calls the search endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string) => json(search));
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    const events = await client.searchEvents("Lakers", "active");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.gemini.com/v1/prediction-markets/events?category=Sports&status=active&search=Lakers&limit=50",
    );
    expect(events.length).toBe(search.data.length);
  });

  it("returns [] without fetching for terms shorter than 3 chars", async () => {
    const fetchMock = vi.fn();
    const client = createGeminiClient({ fetch: asFetch(fetchMock) });
    expect(await client.searchEvents("LA", "active")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("caches active searches for 5 minutes", async () => {
    let t = 1_000_000;
    const fetchMock = vi.fn(async () => json(search));
    const client = createGeminiClient({ fetch: asFetch(fetchMock), now: () => t });
    await client.searchEvents("Lakers", "active");
    t += 4 * 60_000;
    await client.searchEvents("Lakers", "active");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    t += 61_000;
    await client.searchEvents("Lakers", "active");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never refetches a settled search", async () => {
    let t = 0;
    const fetchMock = vi.fn(async () => json(search));
    const client = createGeminiClient({ fetch: asFetch(fetchMock), now: () => t });
    await client.searchEvents("Lakers", "settled");
    t += 365 * 86_400_000;
    await client.searchEvents("Lakers", "settled");
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
