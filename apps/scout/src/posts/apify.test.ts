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
      // createdAt comes from the snowflake (ms precision); the provider's is to the second
      const diff = Date.parse(post!.createdAt) - Date.parse(item.createdAt);
      expect(diff).toBeGreaterThanOrEqual(0);
      expect(diff).toBeLessThan(1000);
    }
  });

  it("flags retweets and replies in the recorded sample", () => {
    const posts = fixture.map((i) => normalizeApifyItem(i)!);
    expect(posts[0]!.isRetweet).toBe(true);
    expect(posts[3]!.isReply).toBe(true);
    expect(posts[1]!.isRetweet).toBe(false);
    expect(posts[1]!.isReply).toBe(false);
    expect(posts.filter((p) => p.isRetweet)).toHaveLength(1);
    expect(posts.filter((p) => p.isReply)).toHaveLength(1);
    expect(posts.every((p) => p.quotedText === undefined)).toBe(true);
  });

  it("treats a non-null retweeted_tweet object as a retweet even without isRetweet", () => {
    const { isRetweet: _drop, ...rt } = fixture[0]!;
    expect(normalizeApifyItem(rt)?.isRetweet).toBe(true);
    expect(normalizeApifyItem({ ...fixture[1], retweeted_tweet: null })?.isRetweet).toBe(false);
  });

  it("reads quoted text from quoted_tweet", () => {
    const quote = { ...fixture[1], quoted_tweet: { id: "1", text: "Knicks to win by 10 tonight" } };
    expect(normalizeApifyItem(quote)?.quotedText).toBe("Knicks to win by 10 tonight");
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
    expect(url).not.toContain("tok");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
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

  it("returns at most `limit` posts, newest first, with duplicates removed", async () => {
    // The actor treats maxItems as a target and can return extras: 4 unique posts + 1 duplicate.
    const items = [fixture[3], fixture[1], fixture[0], fixture[1], fixture[2]];
    const source = createApifySource({
      token: "t",
      fetch: (async () => jsonResponse(items)) as unknown as typeof fetch,
    });
    const posts = await source.fetchPosts("espn", { limit: 2 });
    const newestTwo = [...new Set(items.map((i) => i!.id))]
      .sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1))
      .slice(0, 2);
    expect(posts.map((p) => p.tweetId)).toEqual(newestTwo);
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

  it("never puts the URL or token in error messages", async () => {
    const leaky = createApifySource({
      token: "secret-tok",
      fetch: (async (url: string) => {
        throw new TypeError(`fetch failed for ${url} with secret-tok`);
      }) as unknown as typeof fetch,
    });
    const err = await leaky.fetchPosts("espn", { limit: 20 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(PostSourceError);
    expect((err as Error).message).not.toContain("secret-tok");
    expect((err as Error).message).not.toContain("api.apify.com");
    for (const res of [jsonResponse({}, 500), new Response("<html>"), jsonResponse({ x: 1 })]) {
      const s = createApifySource({ token: "secret-tok", fetch: (async () => res) as unknown as typeof fetch });
      const e = await s.fetchPosts("espn", { limit: 20 }).catch((x: Error) => x);
      expect((e as Error).message).not.toContain("secret-tok");
      expect((e as Error).message).not.toContain("api.apify.com");
    }
  });
});
