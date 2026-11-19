import { NewPost, type PickMatch } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import { createForwarder, noopForwarder } from "./forward.js";
import type { GeminiClient } from "./gemini/client.js";
import type { GeminiEvent } from "./gemini/types.js";
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

const gemini = (events: GeminiEvent[]): GeminiClient =>
  ({
    searchGames: vi.fn(),
    getEvent: vi.fn(async (t: string) => {
      const e = events.find((x) => x.ticker === t);
      if (!e) throw new Error("nope");
      return e;
    }),
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

function setup(events: GeminiEvent[], res: { ok: boolean } | Error = { ok: true }) {
  const store = createMemoryStore();
  const fetchFn = vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res as Response;
  });
  const forwarder = createForwarder({
    url: "http://ingest",
    serviceKey: "k",
    store,
    gemini: gemini(events),
    fetch: fetchFn as unknown as typeof fetch,
  });
  const body = () => JSON.parse((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  return { store, fetchFn, forwarder, body };
}

describe("createForwarder", () => {
  it("posts valid NewPosts with the bearer key and a YES pick", async () => {
    const { forwarder, fetchFn, body } = setup([winEvent]);
    const ids = await forwarder.forward([post("1", [match({})])], "bob");
    expect(ids).toEqual(["1"]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://ingest/v1/posts");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json", authorization: "Bearer k" });
    const posts = body().posts;
    expect(posts).toHaveLength(1);
    expect(NewPost.parse(posts[0])).toMatchObject({
      tweetId: "1",
      xHandle: "bob",
      geminiMarketId: "100",
      pickedOutcome: "Lakers",
    });
  });

  it("sends a win NO pick on a 2-contract event as the other label", async () => {
    const { forwarder, body } = setup([winEvent]);
    await forwarder.forward([post("1", [match({ side: "no" })])], "bob");
    expect(body().posts[0].pickedOutcome).toBe("Hornets");
  });

  it("does not forward a post whose only matched pick is a spread, and does not upsert its market", async () => {
    const { forwarder, fetchFn, store } = setup([winEvent, spread]);
    expect(await forwarder.forward([post("1", [spreadPick()])], "bob")).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.markets.size).toBe(0);
  });

  it("forwards the win pick when a spread pick comes first", async () => {
    const { forwarder, body, store } = setup([winEvent, spread]);
    const ids = await forwarder.forward(
      [post("1", [spreadPick(), match({ predictionIndex: 1 })]), post("2", [spreadPick({ side: "no" })])],
      "bob",
    );
    expect(ids).toEqual(["1"]);
    expect(body().posts).toHaveLength(1);
    expect(body().posts[0]).toMatchObject({ geminiMarketId: "100", pickedOutcome: "Lakers" });
    expect([...store.markets.keys()]).toEqual(["100"]);
  });

  it("upserts the market with the mapped fields", async () => {
    const { forwarder, store } = setup([winEvent]);
    await forwarder.forward([post("1", [match({})])], "bob");
    expect(store.markets.get("100")).toEqual({
      geminiMarketId: "100",
      sport: "basketball",
      eventName: "Lakers vs Hornets",
      outcomes: [
        { label: "Lakers", instrumentSymbol: "S-LAL", currentOdds: 0.6 },
        { label: "Hornets", instrumentSymbol: "S-CHA", currentOdds: 1 },
      ],
      lockTime: new Date(START),
      status: "open",
      winningOutcome: null,
      resolvedAt: null,
    });
  });

  it("maps a settled event to resolved with the winning label", async () => {
    const { forwarder, store } = setup([settledWin]);
    const pick = match({ geminiEventTicker: "G2-M", gameTicker: "G2-M", instrumentSymbol: "S-BOS", contractLabel: "Celtics" });
    await forwarder.forward([post("1", [pick])], "bob");
    expect(store.markets.get("300")).toMatchObject({
      sport: "NBA",
      status: "resolved",
      winningOutcome: "Celtics",
      resolvedAt: new Date("2026-11-19T05:00:00.000Z"),
      lockTime: new Date(START),
      outcomes: [
        { label: "Celtics", instrumentSymbol: "S-BOS", currentOdds: 0 },
        { label: "Knicks", instrumentSymbol: "S-NYK", currentOdds: 0 },
      ],
    });
  });

  it("isolates a failing event: the good post is forwarded, the bad one is not", async () => {
    const { forwarder, body } = setup([winEvent]);
    const bad = match({ geminiEventTicker: "GONE", gameTicker: "GONE-M" });
    const ids = await forwarder.forward([post("1", [bad]), post("2", [match({})])], "bob");
    expect(ids).toEqual(["2"]);
    expect(body().posts.map((p: { tweetId: string }) => p.tweetId)).toEqual(["2"]);
  });

  it("falls through to the next pick when an event can't be loaded", async () => {
    const { forwarder, body } = setup([winEvent]);
    const bad = match({ geminiEventTicker: "GONE" });
    await forwarder.forward([post("1", [bad, match({ predictionIndex: 1 })])], "bob");
    expect(body().posts[0].pickedOutcome).toBe("Lakers");
  });

  it("does not send a post whose market upsert fails", async () => {
    const { forwarder, store, body } = setup([winEvent, settledWin]);
    const real = store.upsertMarket.bind(store);
    store.upsertMarket = async (row) => {
      if (row.geminiMarketId === "300") throw new Error("db");
      return real(row);
    };
    const s = match({ geminiEventTicker: "G2-M", gameTicker: "G2-M", contractLabel: "Celtics" });
    const ids = await forwarder.forward([post("1", [s]), post("2", [match({})])], "bob");
    expect(ids).toEqual(["2"]);
    expect(body().posts).toHaveLength(1);
  });

  it("does not forward a pick with no start time", async () => {
    const noStart: GeminiEvent = { ...winEvent, startTime: undefined };
    const { forwarder, fetchFn } = setup([noStart]);
    expect(await forwarder.forward([post("1", [match({ gameStartTime: null })])], "bob")).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns [] on a non-2xx response without throwing", async () => {
    const { forwarder } = setup([winEvent], { ok: false });
    expect(await forwarder.forward([post("1", [match({})])], "bob")).toEqual([]);
  });

  it("returns [] on a network error", async () => {
    const { forwarder } = setup([winEvent], new Error("down"));
    expect(await forwarder.forward([post("1", [match({})])], "bob")).toEqual([]);
  });

  it("does not post when nothing is forwardable", async () => {
    const { forwarder, fetchFn } = setup([winEvent]);
    expect(await forwarder.forward([post("1", [])], "bob")).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("noopForwarder accepts nothing", async () => {
    expect(await noopForwarder.forward([post("1", [match({})])], "bob")).toEqual([]);
  });
});
