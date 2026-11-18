import { describe, expect, it, vi } from "vitest";
import fixture from "../../test/fixtures/apify-kaito.json" with { type: "json" };
import { createApifySource, normalizeApifyItem } from "./apify.js";
import { PostSourceError } from "./source.js";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("normalizeApifyItem", () => {
  it("normalizes every fixture item with a lowercase handle", () => {
    for (const item of fixture) {
      const post = normalizeApifyItem(item);
      expect(post).not.toBeNull();
      expect(post!.xHandle).toBe("espn");
      expect(post!.tweetId).toBe(item.id);
      expect(post!.xUserId).toBe("2557521");
      expect(post!.createdAt).toBe(new Date(Date.parse(item.createdAt)).toISOString());
    }
  });

  it("flags retweets, replies and quoted text", () => {
    const posts = fixture.map((i) => normalizeApifyItem(i)!);
    expect(posts[2]!.isRetweet).toBe(true);
    expect(posts[1]!.isReply).toBe(true);
    expect(posts[0]!.isRetweet).toBe(false);
    expect(posts[0]!.isReply).toBe(false);
    expect(posts[3]!.quotedText).toBe("Knicks to win by 10 tonight");
    expect(posts[0]!.quotedText).toBeUndefined();
  });

  it("returns null for junk, non-tweets and mock items", () => {
    expect(normalizeApifyItem({})).toBeNull();
    expect(normalizeApifyItem(null)).toBeNull();
    expect(normalizeApifyItem({ ...fixture[0], type: "mock_tweet" })).toBeNull();
    expect(normalizeApifyItem({ ...fixture[0], author: undefined })).toBeNull();
    expect(normalizeApifyItem({ ...fixture[0], text: undefined })).toBeNull();
  });
});

describe("createApifySource", () => {
  it("posts the search input and normalizes the result", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(fixture));
    const source = createApifySource({ token: "tok", fetch: fetchMock as unknown as typeof fetch });
    const posts = await source.fetchPosts("ESPN", { limit: 100 });
    expect(posts).toHaveLength(fixture.length);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest");
    expect(url).toContain("run-sync-get-dataset-items");
    expect(url).toContain("token=tok");
    expect(JSON.parse(init.body as string)).toEqual({
      searchTerms: ["from:espn"],
      queryType: "Latest",
      maxItems: 100,
    });
  });

  it("uses the actor minimum of 20 for maxItems", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    const source = createApifySource({ token: "t", fetch: fetchMock as unknown as typeof fetch });
    await source.fetchPosts("espn", { limit: 5 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).maxItems).toBe(20);
  });

  it("puts since_id in the search term and still filters out posts at or below sinceId", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(fixture));
    const source = createApifySource({ token: "t", fetch: fetchMock as unknown as typeof fetch });
    const sinceId = fixture[1]!.id;
    const posts = await source.fetchPosts("espn", { limit: 20, sinceId });
    expect(posts.map((p) => p.tweetId)).toEqual([fixture[0]!.id]);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).searchTerms).toEqual([
      `from:espn since_id:${sinceId}`,
    ]);
  });

  it("drops invalid items instead of throwing", async () => {
    const source = createApifySource({
      token: "t",
      fetch: (async () => jsonResponse([{ noResults: true }, fixture[0]])) as unknown as typeof fetch,
    });
    expect(await source.fetchPosts("espn", { limit: 20 })).toHaveLength(1);
  });

  it("rejects with PostSourceError on non-2xx", async () => {
    const source = createApifySource({
      token: "t",
      fetch: (async () => jsonResponse({ error: "nope" }, 402)) as unknown as typeof fetch,
    });
    await expect(source.fetchPosts("espn", { limit: 20 })).rejects.toBeInstanceOf(PostSourceError);
  });

  it("rejects with PostSourceError on network failure or non-array body", async () => {
    const boom = createApifySource({
      token: "t",
      fetch: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    await expect(boom.fetchPosts("espn", { limit: 20 })).rejects.toBeInstanceOf(PostSourceError);
    const bad = createApifySource({
      token: "t",
      fetch: (async () => jsonResponse({ x: 1 })) as unknown as typeof fetch,
    });
    await expect(bad.fetchPosts("espn", { limit: 20 })).rejects.toBeInstanceOf(PostSourceError);
  });
});
