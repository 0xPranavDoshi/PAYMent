import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { GeminiClient, GeminiEvent } from "./gemini.js";
import type { CallRow, MarketRow, TailRow, TradingStore } from "./store.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TAIL_ID = "22222222-2222-4222-8222-222222222222";

/** A live event whose contract `GEMI-UCONN` buys YES at 0.70, NO at 0.25. */
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

const market: MarketRow = {
  id: "m1",
  geminiMarketId: "NCAAM-UCONN",
  sport: "basketball",
  eventName: "UConn vs Arizona",
  outcomes: [
    { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.62, noOdds: 0.4, resolutionSide: null },
  ],
  lockTime: new Date("2026-11-20T02:00:00Z"),
  status: "open",
  winningOutcome: null,
};

const call: CallRow = {
  id: "c1",
  userId: "u1",
  userXHandle: "tipster",
  marketId: "m1",
  pickedOutcome: "UConn",
  side: "yes",
  oddsAtCall: 0.5,
  status: "pending",
  tweetedAt: new Date("2026-11-19T00:00:00Z"),
};

const openPaperTail: TailRow = {
  id: TAIL_ID,
  followerId: "f1",
  callId: "c1",
  mode: "paper",
  amountUsdc: 10,
  entryOdds: 0.5,
  geminiOrderId: null,
  status: "open",
  pnlUsdc: null,
  exitOdds: null,
  settledAt: null,
  source: "copy",
  createdAt: new Date("2026-11-19T00:00:00Z"),
};

describe("GET /v1/tails/:id — live mark-to-market", () => {
  it("marks against the live price, not the stored one", async () => {
    const gemini = { getEvent: vi.fn(async () => liveEvent()) };
    const store = {
      getTail: vi.fn(async () => openPaperTail),
      getCall: vi.fn(async () => call),
      getMarketById: vi.fn(async () => market),
    };
    const app = createApp({
      store: store as unknown as TradingStore,
      gemini: gemini as unknown as GeminiClient,
      serviceKey: "k",
    });
    const body = await (await app.request(`/v1/tails/${TAIL_ID}`)).json();
    // live 0.70 beats stored 0.62: pnl = 10 * (0.70 - 0.5) / 0.5 = 4.0
    expect(body).toMatchObject({ realized: false, markPrice: 0.7, unrealizedPnlUsdc: 4 });
    expect(gemini.getEvent).toHaveBeenCalledWith("NCAAM-UCONN");
  });

  it("falls back to the stored price when the live fetch fails", async () => {
    const gemini = { getEvent: vi.fn(async () => { throw new Error("gemini down"); }) };
    const store = {
      getTail: vi.fn(async () => openPaperTail),
      getCall: vi.fn(async () => call),
      getMarketById: vi.fn(async () => market),
    };
    const app = createApp({
      store: store as unknown as TradingStore,
      gemini: gemini as unknown as GeminiClient,
      serviceKey: "k",
    });
    const body = await (await app.request(`/v1/tails/${TAIL_ID}`)).json();
    // stored 0.62: pnl = 10 * (0.62 - 0.5) / 0.5 = 2.4
    expect(body).toMatchObject({ realized: false, markPrice: 0.62, unrealizedPnlUsdc: 2.4 });
  });
});

describe("GET /v1/users/:id/tails — portfolio with live PnL", () => {
  function ctxRow(over: Partial<TailRow>, extra: Partial<{ storedMarkPrice: number | null }> = {}) {
    return {
      tail: { ...openPaperTail, ...over },
      side: "yes" as const,
      instrumentSymbol: "GEMI-UCONN",
      pickedOutcome: "UConn",
      ticker: "NCAAM-UCONN",
      storedMarkPrice: extra.storedMarkPrice ?? 0.6,
      eventName: "UConn vs Arizona",
      traderHandle: "sharp",
    };
  }

  it("marks every open paper tail live, dedupes the market fetch, and keeps settled pnl", async () => {
    const settled: TailRow = {
      ...openPaperTail,
      id: "33333333-3333-4333-8333-333333333333",
      status: "settled",
      pnlUsdc: 5,
      exitOdds: 1,
      settledAt: new Date("2026-11-20T03:00:00Z"),
    };
    const rows = [
      ctxRow({ id: TAIL_ID, entryOdds: 0.5, amountUsdc: 10 }),
      ctxRow({ id: "44444444-4444-4444-8444-444444444444", entryOdds: 0.4, amountUsdc: 10 }),
      { tail: settled, side: "yes" as const, instrumentSymbol: "GEMI-UCONN", pickedOutcome: "UConn", ticker: "NCAAM-UCONN", storedMarkPrice: 0.6, eventName: "UConn vs Arizona", traderHandle: "sharp" },
    ];
    const gemini = { getEvent: vi.fn(async () => liveEvent()) };
    const store = { listUserTailsForPnl: vi.fn(async () => rows) };
    const app = createApp({
      store: store as unknown as TradingStore,
      gemini: gemini as unknown as GeminiClient,
      serviceKey: "k",
    });

    const body = await (await app.request(`/v1/users/${USER_ID}/tails?source=copy`)).json();

    // one fetch for the single distinct ticker, even across two open tails + one settled
    expect(gemini.getEvent).toHaveBeenCalledTimes(1);
    expect(store.listUserTailsForPnl).toHaveBeenCalledWith(USER_ID, "copy");
    // tail A: 10 * (0.70 - 0.5) / 0.5 = 4.0
    expect(body[0]).toMatchObject({ realized: false, markPrice: 0.7, unrealizedPnlUsdc: 4 });
    // tail B: 10 * (0.70 - 0.4) / 0.4 = 7.5
    expect(body[1]).toMatchObject({ realized: false, markPrice: 0.7, unrealizedPnlUsdc: 7.5 });
    // each trade says what it was on and whose pick it copied
    expect(body[0]).toMatchObject({ eventName: "UConn vs Arizona", pickLabel: "UConn", side: "yes", traderHandle: "sharp" });
    expect(body[2]).toMatchObject({ eventName: "UConn vs Arizona", traderHandle: "sharp" });
    // settled tail keeps its persisted pnl
    expect(body[2]).toMatchObject({ realized: true, pnlUsdc: 5, exitOdds: 1 });
  });

  it("ignores an invalid ?source and marks against the stored price when live fails", async () => {
    const rows = [ctxRow({ id: TAIL_ID, entryOdds: 0.5, amountUsdc: 10 }, { storedMarkPrice: 0.6 })];
    const gemini = { getEvent: vi.fn(async () => { throw new Error("down"); }) };
    const store = { listUserTailsForPnl: vi.fn(async () => rows) };
    const app = createApp({
      store: store as unknown as TradingStore,
      gemini: gemini as unknown as GeminiClient,
      serviceKey: "k",
    });
    const body = await (await app.request(`/v1/users/${USER_ID}/tails?source=bogus`)).json();
    expect(store.listUserTailsForPnl).toHaveBeenCalledWith(USER_ID, undefined);
    // stored 0.6: pnl = 10 * (0.6 - 0.5) / 0.5 = 2.0
    expect(body[0]).toMatchObject({ realized: false, markPrice: 0.6, unrealizedPnlUsdc: 2 });
  });
  it("passes ?source=copy to the store, which is how the portfolio leaves out watch trades", async () => {
    const store = { listUserTailsForPnl: vi.fn(async () => []) };
    const app = createApp({
      store: store as unknown as TradingStore,
      gemini: { getEvent: vi.fn() } as unknown as GeminiClient,
      serviceKey: "k",
    });
    await app.request(`/v1/users/${USER_ID}/tails?source=copy`);
    expect(store.listUserTailsForPnl).toHaveBeenCalledWith(USER_ID, "copy");
  });

  it("a 0 quote is no price: it is not used as the mark, so no -100% appears", async () => {
    const rows = [ctxRow({ id: TAIL_ID, entryOdds: 0.675, amountUsdc: 10 }, { storedMarkPrice: 0 })];
    const gemini = { getEvent: vi.fn(async () => { throw new Error("down"); }) };
    const store = { listUserTailsForPnl: vi.fn(async () => rows) };
    const app = createApp({ store: store as unknown as TradingStore, gemini: gemini as unknown as GeminiClient, serviceKey: "k" });
    const res = await app.request(`/v1/users/${USER_ID}/tails`);
    expect(res.status).toBe(200);
    expect((await res.json())[0]).toMatchObject({ markPrice: null, unrealizedPnlUsdc: null });
  });

  it("a trade stored with an entry price of 0 does not fail the whole list", async () => {
    const rows = [
      ctxRow({ id: TAIL_ID, entryOdds: 0, amountUsdc: 10 }, { storedMarkPrice: 0.6 }),
      ctxRow({ id: "33333333-3333-4333-8333-333333333333", entryOdds: 0.5, amountUsdc: 10 }, { storedMarkPrice: 0.6 }),
    ];
    const gemini = { getEvent: vi.fn(async () => { throw new Error("down"); }) };
    const store = { listUserTailsForPnl: vi.fn(async () => rows) };
    const app = createApp({ store: store as unknown as TradingStore, gemini: gemini as unknown as GeminiClient, serviceKey: "k" });
    const res = await app.request(`/v1/users/${USER_ID}/tails`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ unrealizedPnlUsdc: null });
    expect(body[1]).toMatchObject({ unrealizedPnlUsdc: 2 });
  });
});
