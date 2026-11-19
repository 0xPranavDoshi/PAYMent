import type { Prediction, Sentiment } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { Forwarder } from "./forward.js";
import { GeminiError, type GeminiClient } from "./gemini/client.js";
import type { GeminiEvent } from "./gemini/types.js";
import type { Grok } from "./grok/client.js";
import type { PostSource, RawPost } from "./posts/source.js";
import { runScan } from "./scan.js";
import { PIPELINE_VERSION, createMemoryStore } from "./store.js";

const NOW = new Date("2026-11-18T13:00:00.000Z");

const game: GeminiEvent = {
  id: "1",
  ticker: "G",
  title: "g",
  status: "active",
  template: "sports-game",
  startTime: "2026-11-19T02:00:00.000Z",
  participants: [
    { name: "Los Angeles Lakers", abbreviation: "LAL", side: "home" },
    { name: "Charlotte Hornets", abbreviation: "CHA", side: "away" },
  ],
  contracts: [
    { instrumentSymbol: "SYM-LAL", label: "Lakers", abbreviatedName: "LAL", marketState: "open" },
    { instrumentSymbol: "SYM-CHA", label: "Hornets", abbreviatedName: "CHA", marketState: "open" },
  ],
};

const pred: Prediction = {
  betType: "win",
  league: null,
  team: { name: "Los Angeles Lakers", aliases: ["Lakers", "LAL"] },
  opponent: null,
  player: null,
  metric: null,
  line: null,
  claim: "wins",
  conviction: "strong",
  quote: "q",
};

const prediction = (): Sentiment => ({ isPrediction: true, confidence: 0.9, predictions: [pred], model: "m" });
const nonPrediction = (): Sentiment => ({ isPrediction: false, confidence: 0.9, predictions: [], model: "m" });

const raw = (id: string, o: Partial<RawPost> = {}): RawPost => ({
  tweetId: id,
  xUserId: "u1",
  xHandle: "bob",
  text: `tweet ${id}`,
  createdAt: "2026-11-18T12:00:00.000Z",
  isRetweet: false,
  isReply: false,
  ...o,
});

function setup(opts: {
  posts?: RawPost[] | Error;
  sentiments?: Record<string, Sentiment>;
  searchError?: boolean;
  accepted?: (ids: string[]) => string[];
}) {
  const store = createMemoryStore();
  const fetchPosts = vi.fn(async () => {
    if (opts.posts instanceof Error) throw opts.posts;
    return opts.posts ?? [];
  });
  const source: PostSource = { fetchPosts };
  const seenByGrok: string[] = [];
  const grok = {
    json: vi.fn(async ({ user }: { user: string }) => {
      const posts = JSON.parse(user) as { tweetId: string }[];
      seenByGrok.push(...posts.map((p) => p.tweetId));
      return {
        results: posts.flatMap((p) => {
          const sentiment = opts.sentiments?.[p.tweetId];
          return sentiment ? [{ tweetId: p.tweetId, sentiment }] : [];
        }),
      };
    }),
  } as unknown as Grok;
  const searchGames = vi.fn(async () => {
    if (opts.searchError) throw new GeminiError("boom");
    return [game];
  });
  const gemini = { searchGames, getEvent: vi.fn(async () => game) } as unknown as GeminiClient;
  const forward = vi.fn(async (posts: { tweetId: string }[]) =>
    (opts.accepted ?? ((ids: string[]) => ids))(posts.map((p) => p.tweetId)),
  );
  const forwarder = { forward } as unknown as Forwarder;
  const run = async (handle = "bob") => {
    await store.tryLock(handle, NOW);
    await runScan(handle, { store, source, grok, gemini, forwarder, model: "m", now: () => NOW, log: () => {} });
  };
  return { store, fetchPosts, seenByGrok, searchGames, forward, run, source };
}

describe("runScan", () => {
  it("first scan fetches 100 with no sinceId; top-ups fetch 20 since newestTweetId", async () => {
    const t = setup({ posts: [raw("5"), raw("9")], sentiments: { "5": nonPrediction(), "9": nonPrediction() } });
    await t.run();
    expect(t.fetchPosts).toHaveBeenLastCalledWith("bob", { limit: 100 });
    expect((await t.store.getHandle("bob"))?.newestTweetId).toBe("9");
    await t.run();
    expect(t.fetchPosts).toHaveBeenLastCalledWith("bob", { limit: 20, sinceId: "9" });
  });

  it("compares tweet ids as BigInt", async () => {
    const t = setup({ posts: [raw("99"), raw("1000")], sentiments: {} });
    await t.run();
    expect((await t.store.getHandle("bob"))?.newestTweetId).toBe("1000");
  });

  it("drops retweets and does not send stored ids to Grok", async () => {
    const t = setup({
      posts: [raw("1"), raw("2", { isRetweet: true })],
      sentiments: { "1": nonPrediction() },
    });
    await t.run();
    expect((await t.store.listPosts("bob")).map((p) => p.tweetId)).toEqual(["1"]);
    t.seenByGrok.length = 0;
    await t.run();
    expect(t.seenByGrok).toEqual([]);
  });

  it("stores non-predictions with empty matches and the current pipelineVersion", async () => {
    const t = setup({ posts: [raw("1")], sentiments: { "1": nonPrediction() } });
    await t.run();
    const [row] = await t.store.listPosts("bob");
    expect(row).toMatchObject({ matches: [], pipelineVersion: PIPELINE_VERSION, tweetId: "1" });
    expect(PIPELINE_VERSION).toBe(2);
  });

  it("stores one PickMatch per prediction", async () => {
    const t = setup({ posts: [raw("1")], sentiments: { "1": prediction() } });
    await t.run();
    const [row] = await t.store.listPosts("bob");
    expect(row?.matches).toHaveLength(1);
    expect(row?.matches?.[0]).toMatchObject({ predictionIndex: 0, status: "matched", contractLabel: "Lakers" });
  });

  it("keeps matches null on a Gemini error and retries from pending without refetching", async () => {
    const t = setup({ posts: [raw("1")], sentiments: { "1": prediction() }, searchError: true });
    await t.run();
    expect((await t.store.listPosts("bob"))[0]?.matches).toBeNull();
    expect((await t.store.getHandle("bob"))?.status).toBe("idle");

    t.searchGames.mockImplementation(async () => [game]);
    t.fetchPosts.mockImplementation(async () => []);
    t.seenByGrok.length = 0;
    await t.run();
    expect(t.seenByGrok).toEqual([]);
    expect((await t.store.listPosts("bob"))[0]?.matches?.[0]?.status).toBe("matched");
  });

  it("stores matches null (retry next scan) when every prediction has no game yet and the tweet is < 8 days old", async () => {
    const t = setup({ posts: [raw("1")], sentiments: { "1": prediction() } });
    t.searchGames.mockImplementation(async () => []);
    await t.run();
    expect((await t.store.listPosts("bob"))[0]?.matches).toBeNull();
    expect((await t.store.pendingPosts("bob")).map((r) => r.tweetId)).toEqual(["1"]);

    // the game gets listed later: the retry matches it without re-reading
    t.searchGames.mockImplementation(async () => [game]);
    t.fetchPosts.mockImplementation(async () => []);
    t.seenByGrok.length = 0;
    await t.run();
    expect(t.seenByGrok).toEqual([]);
    expect((await t.store.listPosts("bob"))[0]?.matches?.[0]?.status).toBe("matched");
  });

  it("stores the no_market matches when the tweet is 8+ days old", async () => {
    const old = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    const t = setup({ posts: [raw("1", { createdAt: old })], sentiments: { "1": prediction() } });
    t.searchGames.mockImplementation(async () => []);
    await t.run();
    expect((await t.store.listPosts("bob"))[0]?.matches).toEqual([
      expect.objectContaining({ status: "no_market", reason: "no game within 7 days" }),
    ]);
  });

  it("stores other no_market reasons as final", async () => {
    const live = { ...game, startTime: "2026-11-18T11:00:00.000Z" };
    const t = setup({ posts: [raw("1")], sentiments: { "1": prediction() } });
    t.searchGames.mockImplementation(async () => [live]);
    await t.run();
    expect((await t.store.listPosts("bob"))[0]?.matches).toEqual([
      expect.objectContaining({ status: "no_market", reason: "tweet during game" }),
    ]);
  });

  it("re-reads and re-matches a row from an older pipeline version and writes the current version", async () => {
    const t = setup({ posts: [], sentiments: { "1": prediction() } });
    await t.store.upsertPosts([
      {
        tweetId: "1",
        handle: "bob",
        xUserId: "u1",
        tweetedAt: new Date("2026-11-18T12:00:00.000Z"),
        text: "tweet 1",
        isReply: false,
        quotedText: null,
        sentiment: nonPrediction(),
        matches: [],
        pipelineVersion: 0,
        forwardedAt: null,
      },
    ]);
    await t.run();
    expect(t.seenByGrok).toEqual(["1"]);
    const [row] = await t.store.listPosts("bob");
    expect(row?.pipelineVersion).toBe(PIPELINE_VERSION);
    expect(row?.sentiment?.isPrediction).toBe(true);
    expect(row?.matches?.[0]).toMatchObject({ status: "matched", contractLabel: "Lakers" });
    expect(await t.store.pendingPosts("bob")).toEqual([]);
  });

  it("retries a post whose read returned null", async () => {
    const t = setup({ posts: [raw("1")], sentiments: {} });
    await t.run();
    expect((await t.store.listPosts("bob"))[0]?.sentiment).toBeNull();
    t.fetchPosts.mockImplementation(async () => []);
    t.seenByGrok.length = 0;
    await t.run();
    expect(t.seenByGrok).toEqual(["1"]);
  });

  it("fails the scan with the message when fetchPosts throws", async () => {
    const t = setup({ posts: new Error("apify down") });
    await t.run();
    const h = await t.store.getHandle("bob");
    expect(h).toMatchObject({ status: "failed", lastError: "apify down" });
  });

  it("an empty first scan ends idle with scannedAt set", async () => {
    const t = setup({ posts: [] });
    await t.run();
    expect(await t.store.getHandle("bob")).toMatchObject({ status: "idle", scannedAt: NOW, lastError: null });
  });

  it("records xUserId from fetched posts", async () => {
    const t = setup({ posts: [raw("1")], sentiments: { "1": nonPrediction() } });
    await t.run();
    expect((await t.store.getHandle("bob"))?.xUserId).toBe("u1");
  });

  it("forwards only unforwarded posts with a matched pick and marks accepted ones", async () => {
    const t = setup({
      posts: [raw("1"), raw("2")],
      sentiments: { "1": prediction(), "2": nonPrediction() },
    });
    await t.run();
    expect(t.forward).toHaveBeenCalledTimes(1);
    expect((t.forward.mock.calls[0] as unknown as [{ tweetId: string }[]])[0].map((p) => p.tweetId)).toEqual(["1"]);
    const rows = await t.store.listPosts("bob");
    expect(rows.find((r) => r.tweetId === "1")?.forwardedAt).toEqual(NOW);
    expect(rows.find((r) => r.tweetId === "2")?.forwardedAt).toBeNull();
    await t.run();
    expect(t.forward).toHaveBeenCalledTimes(1);
  });

  it("does not mark posts forwarded when the forwarder accepts none", async () => {
    const t = setup({ posts: [raw("1")], sentiments: { "1": prediction() }, accepted: () => [] });
    await t.run();
    expect((await t.store.listPosts("bob"))[0]?.forwardedAt).toBeNull();
  });
});
