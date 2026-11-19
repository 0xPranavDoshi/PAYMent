import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { settlePaperTailsForMarket } from "./settle.js";
import type { GeminiClient } from "./gemini.js";
import type { CallRow, MarketRow, TailRow, TradingStore } from "./store.js";

type OpenPaperTail = {
  tailId: string;
  amountUsdc: number;
  entryOdds: number;
  side: "yes" | "no" | null;
  pickedOutcome: string;
};

function baseMarket(over: Partial<MarketRow> = {}): MarketRow {
  return {
    id: "m1",
    geminiMarketId: "NCAAM-UCONN-ARI-M",
    sport: "basketball",
    eventName: "UConn vs Arizona",
    outcomes: [
      { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.62, noOdds: 0.4, resolutionSide: "yes", priceIncrement: 0.01, quantityIncrement: 0.01, quantityMinimum: 0.01 },
    ],
    lockTime: new Date("2026-11-20T02:00:00Z"),
    status: "resolved",
    winningOutcome: "UConn",
    ...over,
  };
}

/** Fake store that keeps the open paper tails in memory and records settlement patches. */
function fakeStore(openTails: OpenPaperTail[]) {
  const settled: Record<string, Record<string, unknown>> = {};
  const remaining = () => openTails.filter((t) => !settled[t.tailId]);
  const store = {
    listOpenPaperTailsByMarket: vi.fn(async () => remaining()),
    updateTail: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      settled[id] = patch;
    }),
  };
  return { store: store as unknown as TradingStore, settled, raw: store };
}

describe("settlePaperTailsForMarket", () => {
  it("settles a winning tail with positive pnl, exitOdds 1 and settledAt", async () => {
    const { store, settled } = fakeStore([
      { tailId: "t1", amountUsdc: 10, entryOdds: 0.5, side: "yes", pickedOutcome: "UConn" },
    ]);
    const n = await settlePaperTailsForMarket(store, baseMarket());
    expect(n).toBe(1);
    expect(settled.t1).toMatchObject({ status: "settled", pnlUsdc: 10, exitOdds: 1 });
    expect(settled.t1!.settledAt).toBeInstanceOf(Date);
  });

  it("settles a losing tail with pnl = -amount and exitOdds 0", async () => {
    const { store, settled } = fakeStore([
      { tailId: "t1", amountUsdc: 10, entryOdds: 0.5, side: "no", pickedOutcome: "UConn" },
    ]);
    // contract resolved to 'yes', so the 'no' buyer lost
    const n = await settlePaperTailsForMarket(store, baseMarket());
    expect(n).toBe(1);
    expect(settled.t1).toMatchObject({ status: "settled", pnlUsdc: -10, exitOdds: 0 });
  });

  it("a NO pick that resolves to 'no' wins", async () => {
    const { store, settled } = fakeStore([
      { tailId: "t1", amountUsdc: 10, entryOdds: 0.5, side: "no", pickedOutcome: "UConn" },
    ]);
    const market = baseMarket();
    market.outcomes[0]!.resolutionSide = "no";
    const n = await settlePaperTailsForMarket(store, market);
    expect(n).toBe(1);
    expect(settled.t1).toMatchObject({ status: "settled", pnlUsdc: 10, exitOdds: 1 });
  });

  it("returns the stake (pnl 0, exitOdds null) on a void market", async () => {
    const { store, settled } = fakeStore([
      { tailId: "t1", amountUsdc: 10, entryOdds: 0.5, side: "yes", pickedOutcome: "UConn" },
    ]);
    const n = await settlePaperTailsForMarket(store, baseMarket({ status: "void", winningOutcome: null }));
    expect(n).toBe(1);
    expect(settled.t1).toMatchObject({ status: "settled", pnlUsdc: 0, exitOdds: null });
  });

  it("skips a tail whose contract has no resolutionSide (market mislabeled resolved)", async () => {
    const { store, settled, raw } = fakeStore([
      { tailId: "t1", amountUsdc: 10, entryOdds: 0.5, side: "yes", pickedOutcome: "UConn" },
    ]);
    const market = baseMarket();
    market.outcomes[0]!.resolutionSide = null;
    const n = await settlePaperTailsForMarket(store, market);
    expect(n).toBe(0);
    expect(settled.t1).toBeUndefined();
    expect(raw.updateTail).not.toHaveBeenCalled();
  });

  it("does nothing for a market that is not resolved or void", async () => {
    const { store, raw } = fakeStore([
      { tailId: "t1", amountUsdc: 10, entryOdds: 0.5, side: "yes", pickedOutcome: "UConn" },
    ]);
    expect(await settlePaperTailsForMarket(store, baseMarket({ status: "open" }))).toBe(0);
    expect(raw.listOpenPaperTailsByMarket).not.toHaveBeenCalled();
  });

  it("is idempotent: the second run finds no open tails and settles none", async () => {
    const { store } = fakeStore([
      { tailId: "t1", amountUsdc: 10, entryOdds: 0.5, side: "yes", pickedOutcome: "UConn" },
    ]);
    expect(await settlePaperTailsForMarket(store, baseMarket())).toBe(1);
    expect(await settlePaperTailsForMarket(store, baseMarket())).toBe(0);
  });
});

// ── GET /v1/tails/:id ──────────────────────────────────────────────────────────

const TAIL_ID = "22222222-2222-4222-8222-222222222222";

function readStore(tail: Partial<TailRow>, over: { call?: Partial<CallRow>; market?: Partial<MarketRow> } = {}) {
  const fullTail: TailRow = {
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
    source: "manual",
    createdAt: new Date("2026-11-19T00:00:00Z"),
    ...tail,
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
    ...over.call,
  };
  const store = {
    getTail: vi.fn(async () => fullTail),
    getCall: vi.fn(async () => call),
    getMarketById: vi.fn(async () => baseMarket({ status: "open", winningOutcome: null, ...over.market })),
  };
  const app = createApp({
    store: store as unknown as TradingStore,
    gemini: {} as unknown as GeminiClient,
    serviceKey: "k",
  });
  return (id = TAIL_ID) => app.request(`/v1/tails/${id}`);
}

describe("GET /v1/tails/:id", () => {
  it("returns realized pnl for a settled paper tail", async () => {
    const get = readStore({
      status: "settled",
      pnlUsdc: 10,
      exitOdds: 1,
      settledAt: new Date("2026-11-20T03:00:00Z"),
    });
    const body = await (await get()).json();
    expect(body).toMatchObject({ realized: true, pnlUsdc: 10, exitOdds: 1 });
    expect(body.settledAt).toBe("2026-11-20T03:00:00.000Z");
  });

  it("returns unrealized mark-to-market for an open paper tail on an open market", async () => {
    // entry 0.5, markPrice currentOdds 0.62 -> pnl = 10 * (0.62-0.5)/0.5 = 2.4
    const get = readStore({ status: "open", pnlUsdc: null });
    const body = await (await get()).json();
    expect(body).toMatchObject({ realized: false, markPrice: 0.62, unrealizedPnlUsdc: 2.4 });
  });
});
