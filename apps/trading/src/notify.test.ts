import { MAX_COPY_PICK_AGE_S } from "@copayme/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import type { GeminiClient } from "./gemini.js";
import type { CallRow, MarketRow, TradingStore } from "./store.js";

const NOW = new Date("2026-11-19T12:00:00Z");
const KEY = "service-key";
const CALL_ID = "11111111-1111-4111-8111-111111111111";

const market: MarketRow = {
  id: "m1",
  geminiMarketId: "NCAAM-UCONN-ARI-M",
  sport: "basketball",
  eventName: "UConn vs Arizona",
  outcomes: [
    { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.62, noOdds: 0.4, resolutionSide: null },
  ],
  lockTime: new Date("2026-11-20T02:00:00Z"),
  status: "open",
  winningOutcome: null,
};

function setup(over: { call?: Partial<CallRow>; market?: Partial<MarketRow> } = {}) {
  const call: CallRow = {
    id: CALL_ID,
    userId: "u1",
    userXHandle: "tipster",
    marketId: "m1",
    pickedOutcome: "UConn",
    side: "yes",
    oddsAtCall: 0.6,
    status: "pending",
    tweetedAt: new Date(NOW.getTime() - 60_000),
    ...over.call,
  };
  const tails: unknown[] = [];
  const store = {
    getCall: vi.fn(async () => call),
    getMarketById: vi.fn(async () => ({ ...market, ...over.market })),
    getActiveWatchers: vi.fn(async () => ["watcher-1", "watcher-2"]),
    getActiveCopyTraders: vi.fn(async () => [{ followerId: "copier-1", amountUsdc: 10 }]),
    createTail: vi.fn(async (t: unknown) => {
      tails.push(t);
      return t;
    }),
  };
  const gemini = {
    placeOrder: vi.fn(async () => ({ orderId: 42, filledQuantity: "16" })),
  };
  const app = createApp({
    store: store as unknown as TradingStore,
    gemini: gemini as unknown as GeminiClient,
    serviceKey: KEY,
  });
  const notify = (key: string | null = KEY) =>
    app.request("/v1/calls/notify", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "x-service-key": key } : {}) },
      body: JSON.stringify({ callId: CALL_ID }),
    });
  return { notify, store, gemini, tails };
}

describe("POST /v1/calls/notify", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("opens a paper tail per watcher and a live order per copy trader for a fresh pick", async () => {
    const { notify, gemini, tails } = setup();
    const res = await notify();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ watchTails: 2, copyTails: 1, errors: [] });
    expect(gemini.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: "GEMI-UCONN", outcome: "yes", side: "buy" }),
    );
    expect(tails).toHaveLength(3);
  });

  it("refuses an old pick: no tails, no orders, nothing looked up", async () => {
    const { notify, gemini, tails, store } = setup({
      call: { tweetedAt: new Date(NOW.getTime() - 3 * 24 * 3600 * 1000) },
    });
    const res = await notify();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("too old to copy");
    expect(gemini.placeOrder).not.toHaveBeenCalled();
    expect(tails).toHaveLength(0);
    expect(store.getActiveCopyTraders).not.toHaveBeenCalled();
    expect(store.getActiveWatchers).not.toHaveBeenCalled();
  });

  it("allows a pick exactly at the limit and refuses one a second older", async () => {
    const at = (s: number) => ({ call: { tweetedAt: new Date(NOW.getTime() - s * 1000) } });
    expect((await setup(at(MAX_COPY_PICK_AGE_S)).notify()).status).toBe(200);
    const older = setup(at(MAX_COPY_PICK_AGE_S + 1));
    expect((await older.notify()).status).toBe(409);
    expect(older.gemini.placeOrder).not.toHaveBeenCalled();
  });

  it("needs the service key", async () => {
    for (const key of [null, "wrong"]) {
      const { notify, gemini, tails } = setup();
      expect((await notify(key)).status).toBe(401);
      expect(gemini.placeOrder).not.toHaveBeenCalled();
      expect(tails).toHaveLength(0);
    }
  });

  it("still refuses a closed market even when the pick is fresh", async () => {
    const closed = setup({ market: { lockTime: new Date(NOW.getTime() - 1000) } });
    expect((await closed.notify()).status).toBe(409);
    expect(closed.gemini.placeOrder).not.toHaveBeenCalled();
    const resolved = setup({ market: { status: "resolved" } });
    expect((await resolved.notify()).status).toBe(409);
  });
});
