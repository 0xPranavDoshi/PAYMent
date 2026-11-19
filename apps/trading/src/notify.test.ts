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

function setup(over: { call?: Partial<CallRow>; market?: Partial<MarketRow>; orderFails?: boolean; updateFails?: boolean } = {}) {
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
  // The tails table, with the same rule as the unique index: one automatic tail per follower, call and source.
  const tails: Record<string, unknown>[] = [];
  const events: string[] = [];
  const store = {
    getCall: vi.fn(async () => call),
    getMarketById: vi.fn(async () => ({ ...market, ...over.market })),
    getActiveWatchers: vi.fn(async () => ["watcher-1", "watcher-2"]),
    getActiveCopyTraders: vi.fn(async () => [{ followerId: "copier-1", amountUsdc: 10 }]),
    claimAutoTail: vi.fn(async (t: { followerId: string; callId: string; source: string }) => {
      if (tails.some((x) => x.followerId === t.followerId && x.callId === t.callId && x.source === t.source)) {
        return null;
      }
      const row = { ...t, id: `tail-${tails.length + 1}` };
      tails.push(row);
      events.push(`claim:${t.source}:${t.followerId}`);
      return row;
    }),
    updateTail: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      if (over.updateFails) throw new Error("db down");
      Object.assign(tails.find((x) => x.id === id)!, patch);
    }),
  };
  const gemini = {
    placeOrder: vi.fn(async () => {
      events.push("order");
      if (over.orderFails) throw new Error("Gemini 503");
      return { orderId: 42, filledQuantity: "16" };
    }),
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
  return { notify, store, gemini, tails, events };
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

  describe("running it more than once for the same call", () => {
    it("does nothing the second time: no new tails and no second live order", async () => {
      const { notify, gemini, tails } = setup();
      expect(await (await notify()).json()).toMatchObject({ watchTails: 2, copyTails: 1, alreadyNotified: 0 });
      const second = await (await notify()).json();
      expect(second).toMatchObject({ watchTails: 0, copyTails: 0, alreadyNotified: 3, errors: [] });
      expect(gemini.placeOrder).toHaveBeenCalledTimes(1);
      expect(tails).toHaveLength(3);
    });

    it("places only one order when two notifications arrive at the same time", async () => {
      const { notify, gemini, tails } = setup();
      const results = await Promise.all([notify(), notify(), notify()]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(gemini.placeOrder).toHaveBeenCalledTimes(1);
      expect(tails).toHaveLength(3);
    });

    it("saves the follower's tail before placing their order", async () => {
      const { notify, events } = setup();
      await notify();
      expect(events.indexOf("claim:copy:copier-1")).toBeGreaterThanOrEqual(0);
      expect(events.indexOf("claim:copy:copier-1")).toBeLessThan(events.indexOf("order"));
    });
  });

  describe("when a live order fails", () => {
    it("marks the tail cancelled, reports the error, and never retries the order automatically", async () => {
      const { notify, gemini, tails } = setup({ orderFails: true });
      const first = await (await notify()).json();
      expect(first).toMatchObject({ watchTails: 2, copyTails: 0 });
      expect(first.errors).toEqual([expect.stringContaining("Gemini 503")]);
      expect(tails.find((t) => t.source === "copy")).toMatchObject({ status: "cancelled", geminiOrderId: null });

      const retry = await (await notify()).json();
      expect(retry).toMatchObject({ copyTails: 0, alreadyNotified: 3 });
      expect(gemini.placeOrder).toHaveBeenCalledTimes(1); // the failed attempt only
    });

    it("cancels without ordering when the amount is too small for one contract", async () => {
      const { notify, gemini, tails, store } = setup();
      store.getActiveCopyTraders.mockResolvedValue([{ followerId: "copier-1", amountUsdc: 0.1 }]);
      const body = await (await notify()).json();
      expect(body.errors[0]).toContain("too small");
      expect(gemini.placeOrder).not.toHaveBeenCalled();
      expect(tails.find((t) => t.source === "copy")).toMatchObject({ status: "cancelled" });
    });

    it("names the order when it was placed but the tail row could not be updated", async () => {
      const { notify, gemini } = setup({ updateFails: true });
      const body = await (await notify()).json();
      expect(body.errors[0]).toMatch(/order 42 was placed for tail .* could not be updated/);
      expect(gemini.placeOrder).toHaveBeenCalledTimes(1);
      const again = await (await notify()).json();
      expect(gemini.placeOrder).toHaveBeenCalledTimes(1); // still not ordered twice
      expect(again.copyTails).toBe(0);
    });
  });
});
