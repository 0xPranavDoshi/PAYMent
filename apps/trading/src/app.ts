import { Hono } from "hono";
import { TailRequest, TailResponse, MarketSummary } from "@copayme/shared";
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
