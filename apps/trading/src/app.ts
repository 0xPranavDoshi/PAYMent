import { Hono } from "hono";
import { TailRequest, TailResponse, MarketSummary, WatchItem, CopyTradeConfig } from "@copayme/shared";
import { z } from "zod";
import type { TradingStore } from "./store.js";
import type { GeminiClient } from "./gemini.js";
import { syncMarkets } from "./sync.js";

/** Max allowed price movement between quotedOdds and live price before rejecting. */
const MAX_SLIPPAGE = 0.05;

export interface AppDeps {
  store: TradingStore;
  gemini: GeminiClient;
  serviceKey: string;
}

/** Middleware that guards service-only routes with a static key header. */
function requireServiceKey(key: string) {
  return async (
    c: Parameters<Parameters<Hono["use"]>[1]>[0],
    next: () => Promise<void>,
  ) => {
    if (c.req.header("x-service-key") !== key) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  };
}

export function createApp({ store, gemini, serviceKey }: AppDeps) {
  const app = new Hono();

  // ── Health ────────────────────────────────────────────────────────────────

  app.get("/health", (c) => c.json({ ok: true }));

  // ── Markets ───────────────────────────────────────────────────────────────

  /** List open sports markets (used by extension to show tradeable calls). */
  app.get("/v1/markets", async (c) => {
    const markets = await store.listOpenMarkets();
    return c.json(markets.map((m) => MarketSummary.parse({
      ...m,
      lockTime: m.lockTime.toISOString(),
    })));
  });

  /**
   * Trigger a Gemini market sync.
   * Called by a cron job or manually during the demo — requires service key.
   */
  app.post(
    "/v1/markets/sync",
    requireServiceKey(serviceKey),
    async (c) => {
      const result = await syncMarkets(gemini, store);
      return c.json(result, result.errors.length > 0 ? 207 : 200);
    },
  );

  // ── Tails ─────────────────────────────────────────────────────────────────

  /**
   * Place a paper or live tail on a call.
   *
   * The extension tail card sends this. The follower_id comes from the
   * X-Follower-Id header (set by Mugdha's X-login auth layer once integrated;
   * sent explicitly by the extension for now).
   */
  app.post("/v1/tails", async (c) => {
    // Auth: get the follower's user id from the extension
    const followerId = c.req.header("x-follower-id");
    if (!followerId || !/^[0-9a-f-]{36}$/.test(followerId)) {
      return c.json({ error: "x-follower-id header with a valid UUID is required" }, 400);
    }

    // Validate request body
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = TailRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }
    const req = parsed.data;

    // Load the call and its market
    const call = await store.getCall(req.callId);
    if (!call) return c.json({ error: "call not found" }, 404);

    const market = await store.getMarketById(call.marketId);
    if (!market) return c.json({ error: "market not found" }, 404);

    if (market.status !== "open") {
      return c.json({ error: `market is ${market.status}, trading is closed` }, 409);
    }

    // Find the outcome being tailed
    const outcome = market.outcomes.find(
      (o) => o.label === call.pickedOutcome || o.instrumentSymbol === call.pickedOutcome,
    );
    if (!outcome) {
      return c.json({ error: "picked outcome not found in market" }, 422);
    }

    // Side-specific price: NO picks use the buy.no price
    const entryOdds =
      call.side === "no" && outcome.noOdds !== null
        ? outcome.noOdds
        : outcome.currentOdds;

    // Slippage check
    const priceDrift = Math.abs(entryOdds - req.quotedOdds);
    if (priceDrift > MAX_SLIPPAGE) {
      return c.json(
        {
          error: "price moved too much",
          quotedOdds: req.quotedOdds,
          currentOdds: entryOdds,
          drift: priceDrift,
        },
        409,
      );
    }

    // ── Paper trade ───────────────────────────────────────────────────────
    if (req.mode === "paper") {
      const tail = await store.createTail({
        followerId,
        callId: req.callId,
        mode: "paper",
        amountUsdc: req.amountUsdc,
        entryOdds,
        geminiOrderId: null,
        status: "open",
        pnlUsdc: null,
        source: "manual",
      });
      return c.json(toTailResponse(tail), 201);
    }

    // ── Live trade ────────────────────────────────────────────────────────
    if (!call.side) {
      return c.json({ error: "call is missing side (yes/no), cannot place live order" }, 422);
    }

    // quantity = floor(amountUsdc / price) so we never overspend
    const quantity = Math.floor(req.amountUsdc / entryOdds);
    if (quantity < 1) {
      return c.json(
        { error: "amount too small to buy even one contract at current odds" },
        422,
      );
    }

    let geminiOrderId: string | null = null;
    let tailStatus: "open" | "filled" = "open";

    try {
      const order = await gemini.placeOrder({
        symbol: outcome.instrumentSymbol,
        side: "buy",
        outcome: call.side,
        quantity: String(quantity),
        price: entryOdds.toFixed(4),
      });
      geminiOrderId = String(order.orderId);
      // IOC orders are either immediately filled or cancelled
      tailStatus =
        parseFloat(order.filledQuantity) > 0 ? "filled" : "open";
    } catch (err) {
      return c.json({ error: `Gemini order failed: ${String(err)}` }, 502);
    }

    const tail = await store.createTail({
      followerId,
      callId: req.callId,
      mode: "live",
      amountUsdc: req.amountUsdc,
      entryOdds,
      geminiOrderId,
      status: tailStatus,
      pnlUsdc: null,
      source: "manual",
    });
    return c.json(toTailResponse(tail), 201);
  });

  /** Get a single tail by id. */
  app.get("/v1/tails/:id", async (c) => {
    const tail = await store.getTail(c.req.param("id"));
    if (!tail) return c.json({ error: "not found" }, 404);

    // Compute paper-trade P&L on-the-fly if the market has resolved
    if (tail.mode === "paper" && tail.pnlUsdc === null) {
      const call = await store.getCall(tail.callId);
      if (call) {
        const market = await store.getMarketById(call.marketId);
        if (market?.status === "resolved") {
          const pickedContract = market.outcomes.find(
            (o) => o.label === call.pickedOutcome || o.instrumentSymbol === call.pickedOutcome,
          );
          // win if the contract's resolution direction matches the side we bought
          const won =
            pickedContract?.resolutionSide != null &&
            call.side != null &&
            pickedContract.resolutionSide === call.side;
          const contracts = Math.floor(tail.amountUsdc / tail.entryOdds);
          tail.pnlUsdc = won
            ? contracts - tail.amountUsdc
            : -tail.amountUsdc;
        }
      }
    }

    return c.json(toTailResponse(tail));
  });

  /** List all tails for a user (used by extension portfolio view). */
  app.get("/v1/users/:userId/tails", async (c) => {
    const userIdSchema = z.string().uuid();
    const idParsed = userIdSchema.safeParse(c.req.param("userId"));
    if (!idParsed.success) return c.json({ error: "invalid userId" }, 400);
    const tails = await store.listUserTails(idParsed.data);
    return c.json(tails.map(toTailResponse));
  });

  // ── Watches ─────────────────────────────────────────────────────────────────

  app.post("/v1/watches", async (c) => {
    const followerId = c.req.header("x-follower-id");
    if (!followerId || !/^[0-9a-f-]{36}$/.test(followerId)) {
      return c.json({ error: "x-follower-id header with a valid UUID is required" }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = z.object({ traderHandle: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }
    await store.addWatch(followerId, parsed.data.traderHandle);
    return c.json({}, 201);
  });

  app.delete("/v1/watches/:traderHandle", async (c) => {
    const followerId = c.req.header("x-follower-id");
    if (!followerId || !/^[0-9a-f-]{36}$/.test(followerId)) {
      return c.json({ error: "x-follower-id header with a valid UUID is required" }, 400);
    }
    await store.removeWatch(followerId, c.req.param("traderHandle"));
    return c.body(null, 204);
  });

  app.get("/v1/watches", async (c) => {
    const followerId = c.req.header("x-follower-id");
    if (!followerId || !/^[0-9a-f-]{36}$/.test(followerId)) {
      return c.json({ error: "x-follower-id header with a valid UUID is required" }, 400);
    }
    const watches = await store.listWatches(followerId);
    return c.json(watches.map((w) => WatchItem.parse(w)));
  });

  // ── Copy trades ─────────────────────────────────────────────────────────────

  app.post("/v1/copy-trades", async (c) => {
    const followerId = c.req.header("x-follower-id");
    if (!followerId || !/^[0-9a-f-]{36}$/.test(followerId)) {
      return c.json({ error: "x-follower-id header with a valid UUID is required" }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = z
      .object({ traderHandle: z.string().min(1), amountUsdc: z.number().positive() })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }
    const config = await store.upsertCopyTrade(
      followerId,
      parsed.data.traderHandle,
      parsed.data.amountUsdc,
    );
    return c.json(CopyTradeConfig.parse(config), 201);
  });

  app.patch("/v1/copy-trades/:traderHandle", async (c) => {
    const followerId = c.req.header("x-follower-id");
    if (!followerId || !/^[0-9a-f-]{36}$/.test(followerId)) {
      return c.json({ error: "x-follower-id header with a valid UUID is required" }, 400);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = z
      .object({ amountUsdc: z.number().positive().optional(), active: z.boolean().optional() })
      .refine((p) => p.amountUsdc !== undefined || p.active !== undefined, {
        message: "at least one of amountUsdc or active is required",
      })
      .safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }
    const config = await store.updateCopyTrade(
      followerId,
      c.req.param("traderHandle"),
      parsed.data,
    );
    if (!config) return c.json({ error: "copy trade not found" }, 404);
    return c.json(CopyTradeConfig.parse(config));
  });

  app.get("/v1/copy-trades", async (c) => {
    const followerId = c.req.header("x-follower-id");
    if (!followerId || !/^[0-9a-f-]{36}$/.test(followerId)) {
      return c.json({ error: "x-follower-id header with a valid UUID is required" }, 400);
    }
    const configs = await store.listCopyTrades(followerId);
    return c.json(configs.map((cfg) => CopyTradeConfig.parse(cfg)));
  });

  // ── Notify (service-only) ────────────────────────────────────────────────────

  /**
   * Called by the ingest worker when a new call is recorded. Auto-places $1
   * paper tails for watchers and configurable live orders for copy-traders.
   */
  app.post("/v1/calls/notify", requireServiceKey(serviceKey), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    const parsed = z.object({ callId: z.string().uuid() }).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const call = await store.getCall(parsed.data.callId);
    if (!call) return c.json({ error: "call not found" }, 404);

    const market = await store.getMarketById(call.marketId);
    if (!market) return c.json({ error: "market not found" }, 404);
    if (market.status !== "open") {
      return c.json({ error: `market is ${market.status}, trading is closed` }, 409);
    }
    if (new Date() >= market.lockTime) {
      return c.json({ error: "pick window has closed" }, 409);
    }

    const outcome = market.outcomes.find(
      (o) => o.label === call.pickedOutcome || o.instrumentSymbol === call.pickedOutcome,
    );
    if (!outcome) {
      return c.json({ error: "picked outcome not found in market" }, 422);
    }

    const entryOdds =
      call.side === "no" && outcome.noOdds !== null ? outcome.noOdds : outcome.currentOdds;

    const errors: string[] = [];

    // Watchers: $1 paper tails (paper only needs odds, so side may be null)
    const watchers = await store.getActiveWatchers(call.userXHandle);
    const watchResults = await Promise.allSettled(
      watchers.map((followerId) =>
        store.createTail({
          followerId,
          callId: call.id,
          mode: "paper",
          amountUsdc: 1,
          entryOdds,
          geminiOrderId: null,
          status: "open",
          pnlUsdc: null,
          source: "watch",
        }),
      ),
    );
    let watchTails = 0;
    for (const r of watchResults) {
      if (r.status === "fulfilled") watchTails += 1;
      else errors.push(`watch: ${String(r.reason)}`);
    }

    // Copy traders: live orders (needs a side)
    let copyTails = 0;
    const copyTraders = await store.getActiveCopyTraders(call.userXHandle);
    if (call.side) {
      const side = call.side;
      const copyResults = await Promise.allSettled(
        copyTraders.map(async ({ followerId, amountUsdc }) => {
          const quantity = Math.floor(amountUsdc / entryOdds);
          if (quantity < 1) {
            throw new Error("amount too small to buy one contract at current odds");
          }
          const order = await gemini.placeOrder({
            symbol: outcome.instrumentSymbol,
            side: "buy",
            outcome: side,
            quantity: String(quantity),
            price: entryOdds.toFixed(4),
          });
          const status = parseFloat(order.filledQuantity) > 0 ? "filled" : "open";
          await store.createTail({
            followerId,
            callId: call.id,
            mode: "live",
            amountUsdc,
            entryOdds,
            geminiOrderId: String(order.orderId),
            status,
            pnlUsdc: null,
            source: "copy",
          });
        }),
      );
      for (const r of copyResults) {
        if (r.status === "fulfilled") copyTails += 1;
        else errors.push(`copy: ${String(r.reason)}`);
      }
    }

    return c.json({ watchTails, copyTails, errors });
  });

  return app;
}

function toTailResponse(tail: {
  id: string;
  status: string;
  mode: string;
  entryOdds: number;
  amountUsdc: number;
  geminiOrderId: string | null;
  pnlUsdc: number | null;
}) {
  return TailResponse.parse({
    tailId: tail.id,
    status: tail.status,
    mode: tail.mode,
    entryOdds: tail.entryOdds,
    amountUsdc: tail.amountUsdc,
    geminiOrderId: tail.geminiOrderId,
    pnlUsdc: tail.pnlUsdc,
  });
}
