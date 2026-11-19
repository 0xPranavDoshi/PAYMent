import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { GeminiClient, GeminiEvent } from "./gemini.js";
import type { TradingStore, WatchBase, WatchOpenMark } from "./store.js";

const FOLLOWER = "11111111-1111-4111-8111-111111111111";

/** Live event whose GEMI-UCONN contract buys YES at 0.70. */
function liveEvent(ticker = "NCAAM-UCONN"): GeminiEvent {
  return {
    id: "e1",
    title: "UConn vs Arizona",
    ticker,
    status: "active",
    effectiveDate: null,
    expiryDate: null,
    resolvedAt: null,
    contracts: [
      {
        id: "k1",
        label: "UConn",
        instrumentSymbol: "GEMI-UCONN",
        status: "active",
        marketState: "open",
        prices: {
          buy: { yes: "0.70", no: "0.25" },
          sell: { yes: "0.68", no: "0.23" },
          bestBid: "0.68",
          bestAsk: "0.70",
          lastTradePrice: "0.69",
        },
        expiryDate: null,
        resolutionSide: null,
        resolvedAt: null,
      },
    ],
  };
}

function mark(over: Partial<WatchOpenMark> = {}): WatchOpenMark {
  return {
    traderHandle: "alice",
    amountUsdc: 1,
    entryOdds: 0.5,
    side: "yes",
    instrumentSymbol: "GEMI-UCONN",
    pickedOutcome: "UConn",
    ticker: "NCAAM-UCONN",
    storedMarkPrice: 0.6,
    ...over,
  };
}

function app(bases: WatchBase[], marks: WatchOpenMark[], getEvent = vi.fn(async () => liveEvent())) {
  const store = {
    listWatches: vi.fn(async () => bases),
    listOpenWatchMarks: vi.fn(async () => marks),
  };
  const gemini = { getEvent };
  const a = createApp({
    store: store as unknown as TradingStore,
    gemini: gemini as unknown as GeminiClient,
    serviceKey: "k",
  });
  const get = () => a.request("/v1/watches", { headers: { "x-follower-id": FOLLOWER } });
  return { get, getEvent };
}

const alice: WatchBase = {
  traderHandle: "alice",
  watchedAt: new Date("2026-11-18T00:00:00Z"),
  nPicks: 3,
  activePicks: 1,
  stakedUsdc: 3,
  realizedPnlUsdc: 0.5,
  scoreNow: 72,
  scoreAtWatch: 60,
};

describe("GET /v1/watches", () => {
  it("reports score trend and projected PnL (realized + live unrealized) with a %", async () => {
    const body = await (await app([alice], [mark()]).get()).json();
    // unrealized on the open $1 pick: 1 * (0.70 - 0.5) / 0.5 = 0.40; + realized 0.5 = 0.90
    // pnl% = 0.90 / 3 staked * 100 = 30
    expect(body[0]).toMatchObject({
      traderHandle: "alice",
      scoreNow: 72,
      scoreAtWatch: 60,
      scoreDelta: 12,
      stakedUsdc: 3,
      paperPnlUsdc: 0.5,
      projectedPnlUsdc: 0.9,
      pnlPct: 30,
    });
  });

  it("marks each market once even across several open picks", async () => {
    const { get, getEvent } = app([alice], [mark(), mark({ amountUsdc: 1 })]);
    const body = await (await get()).json();
    expect(getEvent).toHaveBeenCalledTimes(1); // one distinct ticker
    // two open picks: 0.40 each -> 0.80 unrealized + 0.5 realized = 1.30
    expect(body[0].projectedPnlUsdc).toBe(1.3);
  });

  it("falls back to the stored price when the live fetch fails", async () => {
    const getEvent = vi.fn(async () => { throw new Error("gemini down"); });
    const body = await (await app([alice], [mark()], getEvent).get()).json();
    // stored 0.6: 1 * (0.6 - 0.5) / 0.5 = 0.20; + 0.5 = 0.70
    expect(body[0].projectedPnlUsdc).toBe(0.7);
  });

  it("handles a watched trader with no picks yet", async () => {
    const bob: WatchBase = {
      traderHandle: "bob",
      watchedAt: new Date("2026-11-18T00:00:00Z"),
      nPicks: 0,
      activePicks: 0,
      stakedUsdc: 0,
      realizedPnlUsdc: null,
      scoreNow: 80,
      scoreAtWatch: 75,
    };
    const body = await (await app([bob], []).get()).json();
    expect(body[0]).toMatchObject({
      traderHandle: "bob",
      nPicks: 0,
      stakedUsdc: 0,
      projectedPnlUsdc: null,
      pnlPct: null,
      scoreDelta: 5,
    });
  });

  it("leaves scoreDelta null when there is no snapshot from when watching began", async () => {
    const body = await (await app([{ ...alice, scoreAtWatch: null }], [mark()]).get()).json();
    expect(body[0].scoreAtWatch).toBeNull();
    expect(body[0].scoreDelta).toBeNull();
    expect(body[0].scoreNow).toBe(72);
  });

  it("requires a valid follower id", async () => {
    const a = createApp({
      store: {} as unknown as TradingStore,
      gemini: {} as unknown as GeminiClient,
      serviceKey: "k",
    });
    expect((await a.request("/v1/watches", { headers: { "x-follower-id": "nope" } })).status).toBe(400);
  });
});
