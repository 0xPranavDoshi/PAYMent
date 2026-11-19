import { IngestRequest, type PickMatch } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { createForwarder, noopForwarder, yesPriceAtTweet } from "./forward.js";
import type { GeminiClient } from "./gemini/client.js";
import type { GeminiEvent } from "./gemini/types.js";
import type { KalshiClient } from "./kalshi/client.js";
import { PIPELINE_VERSION, createMemoryStore, type ScoutPostRow } from "./store.js";

const GAME = "G-M";
const START = "2026-11-19T02:00:00.000Z";

const winEvent: GeminiEvent = {
  id: "100",
  ticker: GAME,
  title: "Lakers vs Hornets",
  status: "active",
  startTime: START,
  sportsMarket: { sport: "basketball" },
  contracts: [
    { instrumentSymbol: "S-LAL", label: "Lakers", marketState: "open", prices: { buy: { yes: "0.6" }, bestAsk: "0.61" } },
    { instrumentSymbol: "S-CHA", label: "Hornets", marketState: "open", prices: { buy: { yes: "1.4" } } },
  ],
};
const spread: GeminiEvent = {
  id: "200",
  ticker: "G-S",
  title: "Spread",
  status: "settled",
  startTime: START,
  subcategory: { name: "NBA" },
  contracts: [
    { instrumentSymbol: "S-1", label: "Lakers by 2", marketState: "closed", resolutionSide: "yes", resolvedAt: "2026-11-19T05:00:00.000Z", prices: {} },
    { instrumentSymbol: "S-2", label: "Lakers by 9", marketState: "closed", resolutionSide: "no", prices: {} },
    { instrumentSymbol: "S-3", label: "Lakers by 20", marketState: "closed", prices: {} },
  ],
};

const settledWin: GeminiEvent = {
  id: "300",
  ticker: "G2-M",
  title: "Celtics vs Knicks",
  status: "settled",
  startTime: START,
  subcategory: { name: "NBA" },
  contracts: [
    { instrumentSymbol: "S-BOS", label: "Celtics", marketState: "closed", resolutionSide: "yes", resolvedAt: "2026-11-19T05:00:00.000Z", prices: {} },
    { instrumentSymbol: "S-NYK", label: "Knicks", marketState: "closed", resolutionSide: "no", prices: {} },
  ],
};
const spreadPick = (o: Partial<PickMatch> = {}) =>
  match({ geminiEventTicker: "G-S", instrumentSymbol: "S-1", side: "yes", contractLabel: "Lakers by 2", ...o });

const gemini = (events: GeminiEvent[], prices: Record<string, number> = {}): GeminiClient =>
  ({
    searchGames: vi.fn(),
    getEvent: vi.fn(async (t: string) => {
      const e = events.find((x) => x.ticker === t);
      if (!e) throw new Error("nope");
      return e;
    }),
    getYesPriceAt: vi.fn(async (symbol: string) => prices[symbol] ?? null),
  }) as unknown as GeminiClient;

const match = (o: Partial<PickMatch>): PickMatch => ({
  predictionIndex: 0,
  status: "matched",
  reason: "matched",
  geminiEventTicker: GAME,
  gameTicker: GAME,
  instrumentSymbol: "S-LAL",
  contractLabel: "Lakers",
  side: "yes",
  gameStartTime: START,
  marketStatus: "open",
  resolutionSide: null,
  ...o,
});

const post = (id: string, matches: PickMatch[]): ScoutPostRow => ({
  tweetId: id,
  handle: "bob",
  xUserId: "u1",
  tweetedAt: new Date("2026-11-18T12:00:00.000Z"),
  text: "lakers lock",
  isReply: false,
  quotedText: null,
  sentiment: null,
  matches,
  pipelineVersion: PIPELINE_VERSION,
  forwardedAt: null,
});


type Reply = { status?: number; errorFor?: string[]; body?: unknown } | Error;

/**
 * Ingest stub: echoes a result per posted tweet (with `error` for ids in errorFor). POST /v1/worker/run
 * answers with `worker` statuses in turn (default one 200).
 */
function setup(
  events: GeminiEvent[],
  reply: Reply = {},
  prices: Record<string, number> = {},
  worker: (number | Error)[] = [200],
) {
  const store = createMemoryStore();
  let workerCalls = 0;
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/v1/worker/run")) {
      const next = worker[Math.min(workerCalls++, worker.length - 1)]!;
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify({ settled: 3, voided: 0, unsettleable: 0, usersUpdated: 1, handles: ["bob"] }), {
        status: next,
      });
    }
    if (reply instanceof Error) throw reply;
    const posts = JSON.parse(init.body as string) as { tweetId: string }[];
    const body = reply.body ?? {
      results: posts.map((p) => ({
        tweetId: p.tweetId,
        postId: reply.errorFor?.includes(p.tweetId) ? null : "00000000-0000-4000-8000-000000000000",
        picks: [],
        ...(reply.errorFor?.includes(p.tweetId) ? { error: "db down" } : {}),
      })),
    };
    return new Response(JSON.stringify(body), { status: reply.status ?? 200 });
  });
  const logs: string[] = [];
  const forwarder = createForwarder({
    url: "http://ingest",
    serviceKey: "k",
    store,
    gemini: gemini(events, prices),
    fetch: fetchFn as unknown as typeof fetch,
    sleep: async () => {},
    log: (m) => logs.push(m),
  });
  const call = (i = 0) => fetchFn.mock.calls[i] as unknown as [string, RequestInit];
  const body = (i = 0) => JSON.parse(call(i)[1].body as string);
  const urls = () => fetchFn.mock.calls.map((c) => String(c[0]));
  return { store, fetchFn, forwarder, call, body, urls, logs };
}

describe("createForwarder", () => {
  it("posts an array of NewPosts to /v1/posts with the x-service-key header", async () => {
    const { forwarder, call, body } = setup([winEvent]);
    expect(await forwarder.forward([post("t1", [match({})])], "bob")).toEqual(["t1"]);
    const [url, init] = call();
    expect(url).toBe("http://ingest/v1/posts");
    expect(init.headers).toEqual({ "content-type": "application/json", "x-service-key": "k" });
    expect(IngestRequest.safeParse(body()).success).toBe(true);
    expect(body()).toEqual([
      {
        tweetId: "t1",
        xUserId: "u1",
        xHandle: "bob",
        tweetedAt: "2026-11-18T12:00:00.000Z",
        tweetText: "lakers lock",
        sentiment: null,
        picks: [
          {
            geminiEventTicker: GAME,
            instrumentSymbol: "S-LAL",
            side: "yes",
            gameStartTime: START,
            resolutionSide: null,
            resolvedAt: null,
            oddsAtTweet: null,
          },
        ],
      },
    ]);
  });

  it("sends every matched pick of a post, including NO sides and ladder markets", async () => {
    const { forwarder, body } = setup([winEvent, spread]);
    const picks = [
      match({ side: "no", instrumentSymbol: "S-CHA", contractLabel: "Hornets" }),
      spreadPick({ side: "no", instrumentSymbol: "S-2", contractLabel: "Lakers by 9" }),
      match({ status: "no_market", geminiEventTicker: null, instrumentSymbol: null }),
    ];
    await forwarder.forward([post("t1", picks)], "bob");
    expect(body()[0].picks).toEqual([
      expect.objectContaining({ geminiEventTicker: GAME, instrumentSymbol: "S-CHA", side: "no" }),
      expect.objectContaining({ geminiEventTicker: "G-S", instrumentSymbol: "S-2", side: "no", resolutionSide: "no" }),
    ]);
  });

  it("carries a settled contract's own resolution", async () => {
    const { forwarder, body } = setup([spread]);
    await forwarder.forward([post("t1", [spreadPick()])], "bob");
    expect(body()[0].picks[0]).toMatchObject({ resolutionSide: "yes", resolvedAt: "2026-11-19T05:00:00.000Z" });
  });

  it("prices each pick at the tweet's time (YES price, or 1 - YES for a NO pick) so ingest can score it", async () => {
    const { forwarder, body } = setup([winEvent], {}, { "S-LAL": 0.39, "S-CHA": 0.62 });
    const picks = [match({}), match({ instrumentSymbol: "S-CHA", contractLabel: "Hornets", side: "no" })];
    await forwarder.forward([post("t1", picks)], "bob");
    expect(body()[0].picks.map((p: { oddsAtTweet: number | null }) => p.oddsAtTweet)).toEqual([0.39, 0.38]);
  });

  it("sends a pick unpriced when Gemini has no price for it", async () => {
    const { forwarder, body } = setup([winEvent]);
    await forwarder.forward([post("t1", [match({})])], "bob");
    expect(body()[0].picks[0].oddsAtTweet).toBeNull();
  });

  it("upserts each market keyed by ticker, with per-contract resolution and the game start as lock time", async () => {
    const { forwarder, store } = setup([winEvent, spread]);
    await forwarder.forward([post("t1", [match({}), spreadPick()]), post("t2", [spreadPick()])], "bob");
    const markets = (store as unknown as { markets: Map<string, unknown> }).markets;
    expect([...markets.keys()].sort()).toEqual(["G-M", "G-S"]);
    expect(markets.get("G-M")).toMatchObject({
      geminiMarketId: "G-M",
      sport: "basketball",
      lockTime: new Date(START),
      status: "open",
      outcomes: [
        { label: "Lakers", instrumentSymbol: "S-LAL", currentOdds: 0.6, noOdds: null, resolutionSide: null },
        { label: "Hornets", instrumentSymbol: "S-CHA", currentOdds: 1, noOdds: null, resolutionSide: null },
      ],
    });
    expect(markets.get("G-S")).toMatchObject({
      status: "resolved",
      sport: "NBA",
      winningOutcome: "Lakers by 2",
      outcomes: expect.arrayContaining([expect.objectContaining({ instrumentSymbol: "S-2", resolutionSide: "no" })]),
    });
  });

  it("uses the market's expiryDate as lock_time when Gemini gives one (matches the trading sync)", async () => {
    const expiring = { ...winEvent, expiryDate: "2026-11-21T02:00:00.000Z" };
    const { forwarder, store } = setup([expiring]);
    await forwarder.forward([post("t1", [match({})])], "bob");
    expect(store.markets.get("G-M")?.lockTime).toEqual(new Date("2026-11-21T02:00:00.000Z"));
  });

  it("accepts only posts ingest stored (a result with `error` is retried later)", async () => {
    const { forwarder } = setup([winEvent], { errorFor: ["t2"] });
    expect(await forwarder.forward([post("t1", [match({})]), post("t2", [match({})])], "bob")).toEqual(["t1"]);
  });

  it("returns [] and never throws on HTTP errors, network errors and unexpected bodies", async () => {
    for (const reply of [{ status: 500 }, new Error("down"), { body: { nope: true } }] as Reply[]) {
      const { forwarder } = setup([winEvent], reply);
      expect(await forwarder.forward([post("t1", [match({})])], "bob")).toEqual([]);
    }
  });

  it("sends nothing for posts without a forwardable pick", async () => {
    const { forwarder, fetchFn } = setup([winEvent]);
    const none = post("t1", [match({ status: "no_market", geminiEventTicker: null })]);
    const noStart = post("t2", [match({ gameStartTime: null })]);
    const unknownContract = post("t3", [match({ instrumentSymbol: "S-XYZ" })]);
    expect(await forwarder.forward([none, noStart, unknownContract, post("t4", [])], "bob")).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("drops a pick whose event can't be loaded but still sends the post's other picks", async () => {
    const { forwarder, body } = setup([winEvent]);
    await forwarder.forward([post("t1", [spreadPick(), match({})])], "bob");
    expect(body()[0].picks.map((p: { geminiEventTicker: string }) => p.geminiEventTicker)).toEqual([GAME]);
  });

  it("holds back picks whose market upsert failed", async () => {
    const { forwarder, store, body } = setup([winEvent, settledWin]);
    const upsert = store.upsertMarket.bind(store);
    store.upsertMarket = vi.fn(async (row) => {
      if (row.geminiMarketId === "G2-M") throw new Error("db");
      return upsert(row);
    });
    const p2 = match({ geminiEventTicker: "G2-M", gameTicker: "G2-M", instrumentSymbol: "S-BOS", contractLabel: "Celtics" });
    expect(await forwarder.forward([post("t1", [match({}), p2]), post("t2", [p2])], "bob")).toEqual(["t1"]);
    expect(body()[0].picks).toHaveLength(1);
  });

  it("prices posts in parallel but keeps their order, with one market upsert shared by all of them", async () => {
    const { forwarder, store, body } = setup([winEvent]);
    const upsert = store.upsertMarket.bind(store);
    const upsertMarket = vi.fn(async (row: Parameters<typeof upsert>[0]) => {
      await new Promise((r) => setTimeout(r, 5));
      return upsert(row);
    });
    store.upsertMarket = upsertMarket;
    const ids = Array.from({ length: 9 }, (_, i) => `t${i}`);
    expect(await forwarder.forward(ids.map((id) => post(id, [match({})])), "bob")).toEqual(ids);
    expect(body().map((p: { tweetId: string }) => p.tweetId)).toEqual(ids);
    expect(upsertMarket).toHaveBeenCalledTimes(1);
  });

  it("batches requests at 50 posts", async () => {
    const { forwarder, body, urls } = setup([winEvent]);
    const posts = Array.from({ length: 120 }, (_, i) => post(`t${i}`, [match({})]));
    expect(await forwarder.forward(posts, "bob")).toHaveLength(120);
    expect(urls().filter((u) => u.endsWith("/v1/posts"))).toHaveLength(3);
    expect([body(0).length, body(1).length, body(2).length]).toEqual([50, 50, 20]);
  });

  describe("scoring right after forwarding", () => {
    it("asks the API to run its scoring worker once, after the picks are stored", async () => {
      const { forwarder, fetchFn, urls, logs } = setup([winEvent]);
      await forwarder.forward([post("t1", [match({})]), post("t2", [match({})])], "bob");
      expect(urls()).toEqual(["http://ingest/v1/posts", "http://ingest/v1/worker/run"]);
      const init = fetchFn.mock.calls[1]![1] as RequestInit;
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "x-service-key": "k" });
      expect(logs).toContain("[scout] scoring run: settled 3, users updated 1");
    });

    it("doesn't run scoring when ingest stored nothing", async () => {
      const { forwarder, urls } = setup([winEvent], { status: 500 });
      await forwarder.forward([post("t1", [match({})])], "bob");
      expect(urls().some((u) => u.endsWith("/v1/worker/run"))).toBe(false);
      const empty = setup([winEvent]);
      await empty.forwarder.forward([post("t1", [])], "bob");
      expect(empty.fetchFn).not.toHaveBeenCalled();
    });

    it("waits and asks again while a run is already in progress (409)", async () => {
      const { forwarder, urls } = setup([winEvent], {}, {}, [409, 409, 200]);
      await forwarder.forward([post("t1", [match({})])], "bob");
      expect(urls().filter((u) => u.endsWith("/v1/worker/run"))).toHaveLength(3);
    });

    it("never fails the forward when the scoring run errors", async () => {
      for (const worker of [[500], [new TypeError("fetch failed")], [409]]) {
        const { forwarder, logs } = setup([winEvent], {}, {}, worker);
        expect(await forwarder.forward([post("t1", [match({})])], "bob")).toEqual(["t1"]);
        expect(logs.some((l) => l.includes("worker's schedule") || l.includes("next run"))).toBe(true);
      }
    });
  });
});

describe("noopForwarder", () => {
  it("accepts nothing", async () => {
    expect(await noopForwarder.forward([post("t1", [match({})])], "bob")).toEqual([]);
  });
});

describe("yesPriceAtTweet (Gemini first, then the Kalshi mirror)", () => {
  const tweetedAt = new Date("2026-11-18T12:00:00.000Z");
  const contract = winEvent.contracts[0]!;
  const kalshiStub = (price: number | null, found = true) =>
    ({
      findMarket: vi.fn(async () =>
        found
          ? { series: "KXNBAGAME" as string, market: { ticker: "KXNBAGAME-26NOV18CHALAL-LAL" } }
          : { series: null, reason: "0 candidate markets" },
      ),
      getYesPriceAt: vi.fn(async () => price),
    }) as unknown as KalshiClient & { findMarket: ReturnType<typeof vi.fn>; getYesPriceAt: ReturnType<typeof vi.fn> };

  it("uses Gemini's own price when it has one, without asking Kalshi", async () => {
    const kalshi = kalshiStub(0.9);
    const r = await yesPriceAtTweet(match({}), winEvent, contract, tweetedAt, {
      gemini: gemini([winEvent], { "S-LAL": 0.6 }),
      kalshi,
      log: () => {},
    });
    expect(r).toEqual({ yes: 0.6, source: "gemini", ref: "S-LAL" });
    expect(kalshi.findMarket).not.toHaveBeenCalled();
  });

  it("falls back to the Kalshi mirror when Gemini has no price", async () => {
    const kalshi = kalshiStub(0.515);
    const r = await yesPriceAtTweet(match({}), winEvent, contract, tweetedAt, { gemini: gemini([winEvent]), kalshi, log: () => {} });
    expect(r).toEqual({ yes: 0.515, source: "kalshi", ref: "KXNBAGAME-26NOV18CHALAL-LAL" });
    expect(kalshi.findMarket).toHaveBeenCalledWith(winEvent, winEvent, contract);
    expect(kalshi.getYesPriceAt).toHaveBeenCalledWith("KXNBAGAME", { ticker: "KXNBAGAME-26NOV18CHALAL-LAL" }, tweetedAt);
  });

  it("returns null and logs why when Kalshi has no match or no quote", async () => {
    const logs: string[] = [];
    const deps = (k: KalshiClient) => ({ gemini: gemini([winEvent]), kalshi: k, log: (m: string) => logs.push(m) });
    expect(await yesPriceAtTweet(match({}), winEvent, contract, tweetedAt, deps(kalshiStub(null, false)))).toBeNull();
    expect(await yesPriceAtTweet(match({}), winEvent, contract, tweetedAt, deps(kalshiStub(null)))).toBeNull();
    expect(logs).toEqual([
      "[scout] no Kalshi price for S-LAL: 0 candidate markets",
      "[scout] no Kalshi price for S-LAL: KXNBAGAME-26NOV18CHALAL-LAL had no quote at the tweet",
    ]);
  });

  it("loads the parent game for a sub-market pick before asking Kalshi", async () => {
    const kalshi = kalshiStub(0.48);
    const r = await yesPriceAtTweet(spreadPick(), spread, spread.contracts[0]!, tweetedAt, {
      gemini: gemini([winEvent, spread]),
      kalshi,
      log: () => {},
    });
    expect(r?.source).toBe("kalshi");
    expect(kalshi.findMarket).toHaveBeenCalledWith(winEvent, spread, spread.contracts[0]);
  });

  it("forwards the Kalshi-priced odds (1 - YES for a NO pick)", async () => {
    const store = createMemoryStore();
    const fetchFn = vi.fn(async (_u: string, init: RequestInit) => {
      const posts = JSON.parse(init.body as string) as { tweetId: string }[];
      return new Response(JSON.stringify({ results: posts.map((p) => ({ tweetId: p.tweetId, postId: null, picks: [] })) }));
    });
    const forwarder = createForwarder({
      url: "http://ingest",
      serviceKey: "k",
      store,
      gemini: gemini([winEvent]),
      kalshi: kalshiStub(0.62),
      fetch: fetchFn as unknown as typeof fetch,
    });
    await forwarder.forward([post("t1", [match({ instrumentSymbol: "S-CHA", contractLabel: "Hornets", side: "no" })])], "bob");
    const sent = JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent[0].picks[0].oddsAtTweet).toBe(0.38);
  });
});
