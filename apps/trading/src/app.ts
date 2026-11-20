import { Hono } from "hono";
import {
  TailRequest,
  TailResponse,
  MarketSummary,
  WatchItem,
  CopyTradeConfig,
  MAX_COPY_PICK_AGE_S,
  isFreshForCopy,
  paperPnlUsdc,
} from "@copayme/shared";
import { z } from "zod";
import type { TradingStore } from "./store.js";
import type { GeminiClient } from "./gemini.js";
import { snapDown, formatToIncrement, sidePriceFromEvent } from "./gemini.js";
import { liveMarkPrice } from "./mark.js";
import { syncMarkets } from "./sync.js";

/** Max allowed price movement between quotedOdds and live price before rejecting. */
const MAX_SLIPPAGE = 0.05;

export type CopyTradeMode = "paper" | "live";

export interface AppDeps {
  store: TradingStore;
  gemini: GeminiClient;
  serviceKey: string;
  /**
   * How copy trades are executed when a pick arrives. "paper" simulates at the
   * follower's configured size (the only option that works where the order venue
   * has no market, e.g. the Gemini sandbox has no sports). "live" places a real
   * order. Defaults to "paper".
   */
  copyTradeMode?: CopyTradeMode;
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

/** A price we can trade or mark against. A quote of 0 means "no price yet", not "worth nothing". */
export const usablePrice = (p: number | null | undefined): number | null =>
  p !== null && p !== undefined && Number.isFinite(p) && p > 0 && p <= 1 ? p : null;

export function createApp({ store, gemini, serviceKey, copyTradeMode = "paper" }: AppDeps) {
  const app = new Hono();

  // ── Health ────────────────────────────────────────────────────────────────

  app.get("/health", (c) => c.json({ ok: true }));

  /** How copy trades run here, so clients can word their confirmation truthfully: "paper" simulates, "live" places real orders. */
  app.get("/v1/config", (c) => c.json({ copyTradeMode }));

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
    if (usablePrice(entryOdds) === null) {
      return c.json({ error: "no usable price for this pick yet" }, 409);
    }

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

    // Size the order to the instrument's quantity increment so we never overspend
    // and never send a quantity Gemini would reject.
    const qtyIncrement = outcome.quantityIncrement ?? 0.01;
    const qtyMinimum = outcome.quantityMinimum ?? qtyIncrement;
    const priceIncrement = outcome.priceIncrement ?? 0.01;
    const quantity = snapDown(req.amountUsdc / entryOdds, qtyIncrement);
    if (quantity < qtyMinimum) {
      return c.json(
        { error: "amount too small to buy the minimum quantity at current odds" },
        422,
      );
    }

    let geminiOrderId: string | null = null;
    let tailStatus: "open" | "filled" = "open";
    let filledOdds = entryOdds;

    try {
      const order = await gemini.placeOrder({
        symbol: outcome.instrumentSymbol,
        side: "buy",
        outcome: call.side,
        quantity: formatToIncrement(quantity, qtyIncrement),
        price: formatToIncrement(entryOdds, priceIncrement),
      });
      geminiOrderId = String(order.orderId);
      // IOC orders are either immediately filled or cancelled
      tailStatus = parseFloat(order.filledQuantity) > 0 ? "filled" : "open";
      const avg = order.avgExecutionPrice ? parseFloat(order.avgExecutionPrice) : NaN;
      if (Number.isFinite(avg) && avg > 0) filledOdds = avg;
    } catch (err) {
      return c.json({ error: `Gemini order failed: ${String(err)}` }, 502);
    }

    const tail = await store.createTail({
      followerId,
      callId: req.callId,
      mode: "live",
      amountUsdc: req.amountUsdc,
      entryOdds: filledOdds,
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

    // Settled tails (paper or live) carry final persisted pnl. Nothing to compute.
    if (tail.status === "settled") {
      return c.json(
        toTailResponse(tail, {
          realized: true,
          exitOdds: tail.exitOdds,
          settledAt: tail.settledAt ? tail.settledAt.toISOString() : null,
        }),
      );
    }

    // Open paper tails are marked to market against the live price, falling back to the
    // last synced price if Gemini can't be reached right now.
    if (tail.mode === "paper") {
      const call = await store.getCall(tail.callId);
      const market = call ? await store.getMarketById(call.marketId) : null;
      const outcome = call && market
        ? market.outcomes.find(
            (o) => o.label === call.pickedOutcome || o.instrumentSymbol === call.pickedOutcome,
          )
        : undefined;
      // NO picks are priced off the buy.no leg; fall back to currentOdds when noOdds is missing.
      const storedMark = outcome
        ? call?.side === "no" && outcome.noOdds !== null
          ? outcome.noOdds
          : outcome.currentOdds
        : null;
      let markPrice = usablePrice(storedMark);
      if (market) {
        const live = await liveMarkPrice(
          gemini,
          market.geminiMarketId,
          { instrumentSymbol: outcome?.instrumentSymbol, label: call?.pickedOutcome },
          call?.side ?? null,
        );
        if (live !== null) markPrice = live;
      }
      const unrealizedPnlUsdc =
        markPrice !== null && usablePrice(tail.entryOdds) !== null
          ? paperPnlUsdc({ amountUsdc: tail.amountUsdc, entryOdds: tail.entryOdds, exitPrice: markPrice })
          : null;
      return c.json(toTailResponse(tail, { realized: false, markPrice, unrealizedPnlUsdc }));
    }

    return c.json(toTailResponse(tail));
  });

  /**
   * List a user's tails (extension / website portfolio). Optional ?source=manual|watch|copy.
   * Open paper tails are marked to market against the live price (one Gemini fetch per distinct
   * market), falling back to the last synced price; settled tails carry their final pnl.
   */
  app.get("/v1/users/:userId/tails", async (c) => {
    const userIdSchema = z.string().uuid();
    const idParsed = userIdSchema.safeParse(c.req.param("userId"));
    if (!idParsed.success) return c.json({ error: "invalid userId" }, 400);

    const sourceParam = c.req.query("source");
    const source =
      sourceParam === "manual" || sourceParam === "watch" || sourceParam === "copy"
        ? sourceParam
        : undefined;

    const rows = await store.listUserTailsForPnl(idParsed.data, source);

    // Fetch each distinct market once, in parallel, for the open paper tails that need marking.
    const openPaperTickers = [
      ...new Set(
        rows
          .filter((r) => r.tail.mode === "paper" && r.tail.status !== "settled")
          .map((r) => r.ticker),
      ),
    ];
    const events = new Map<string, Awaited<ReturnType<GeminiClient["getEvent"]>> | null>();
    await Promise.all(
      openPaperTickers.map(async (ticker) => {
        try {
          events.set(ticker, await gemini.getEvent(ticker));
        } catch {
          events.set(ticker, null);
        }
      }),
    );

    const body = rows.map((r) => {
      const tail = r.tail;
      const what = {
        eventName: r.eventName,
        pickLabel: r.pickedOutcome,
        side: r.side,
        traderHandle: r.traderHandle,
        createdAt: tail.createdAt.toISOString(),
      };
      if (tail.status === "settled") {
        return toTailResponse(tail, {
          ...what,
          realized: true,
          exitOdds: tail.exitOdds,
          settledAt: tail.settledAt ? tail.settledAt.toISOString() : null,
        });
      }
      if (tail.mode === "paper") {
        const event = events.get(r.ticker) ?? null;
        const live = event
          ? sidePriceFromEvent(event, { instrumentSymbol: r.instrumentSymbol, label: r.pickedOutcome }, r.side)
          : null;
        const markPrice = live ?? usablePrice(r.storedMarkPrice);
        const unrealizedPnlUsdc =
          markPrice !== null && usablePrice(tail.entryOdds) !== null
            ? paperPnlUsdc({ amountUsdc: tail.amountUsdc, entryOdds: tail.entryOdds, exitPrice: markPrice })
            : null;
        return toTailResponse(tail, { ...what, realized: false, markPrice, unrealizedPnlUsdc });
      }
      return toTailResponse(tail, what);
    });
    return c.json(body);
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

    const bases = await store.listWatches(followerId);
    const marks = await store.listOpenWatchMarks(followerId);

    // Mark each distinct market once (live), then sum unrealized PnL per trader.
    const tickers = [...new Set(marks.map((m) => m.ticker))];
    const events = new Map<string, Awaited<ReturnType<GeminiClient["getEvent"]>> | null>();
    await Promise.all(
      tickers.map(async (ticker) => {
        try {
          events.set(ticker, await gemini.getEvent(ticker));
        } catch {
          events.set(ticker, null);
        }
      }),
    );

    const unrealizedByTrader = new Map<string, number>();
    for (const m of marks) {
      const event = events.get(m.ticker) ?? null;
      const live = event
        ? sidePriceFromEvent(event, { instrumentSymbol: m.instrumentSymbol, label: m.pickedOutcome }, m.side)
        : null;
      const markPrice = live ?? usablePrice(m.storedMarkPrice);
      if (markPrice === null || usablePrice(m.entryOdds) === null) continue;
      const pnl = paperPnlUsdc({ amountUsdc: m.amountUsdc, entryOdds: m.entryOdds, exitPrice: markPrice });
      const key = m.traderHandle.toLowerCase();
      unrealizedByTrader.set(key, (unrealizedByTrader.get(key) ?? 0) + pnl);
    }

    const items = bases.map((b) => {
      const key = b.traderHandle.toLowerCase();
      const hasOpen = unrealizedByTrader.has(key);
      const unrealized = unrealizedByTrader.get(key) ?? 0;
      const projectedPnlUsdc =
        b.realizedPnlUsdc !== null || hasOpen ? round2((b.realizedPnlUsdc ?? 0) + unrealized) : null;
      const pnlPct =
        projectedPnlUsdc !== null && b.stakedUsdc > 0 ? round2((projectedPnlUsdc / b.stakedUsdc) * 100) : null;
      const scoreDelta =
        b.scoreNow !== null && b.scoreAtWatch !== null ? b.scoreNow - b.scoreAtWatch : null;
      return WatchItem.parse({
        traderHandle: b.traderHandle,
        watchedAt: b.watchedAt.toISOString(),
        nPicks: b.nPicks,
        activePicks: b.activePicks,
        stakedUsdc: b.stakedUsdc,
        paperPnlUsdc: b.realizedPnlUsdc,
        projectedPnlUsdc,
        pnlPct,
        scoreNow: b.scoreNow,
        scoreAtWatch: b.scoreAtWatch,
        scoreDelta,
      });
    });
    return c.json(items);
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
   * paper tails for watchers and copy tails for copy-traders at their configured
   * size — simulated (paper) by default, or real orders when copyTradeMode is "live".
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

    // Watching and copy trading follow a pick at about the price its author saw. A pick that is
    // older than that (for example, an old tweet found by a profile scan) is never copied
    // automatically, whoever calls this endpoint.
    if (!isFreshForCopy(call.tweetedAt)) {
      return c.json({ error: `pick is too old to copy (limit ${MAX_COPY_PICK_AGE_S} s)` }, 409);
    }

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
    if (usablePrice(entryOdds) === null) {
      return c.json({ error: "no usable price for this pick yet" }, 409);
    }

    const errors: string[] = [];
    let alreadyNotified = 0;

    // Every follower's tail row is claimed (inserted) BEFORE anything else happens for them. The
    // claim is atomic (unique index tails_auto_once_idx), so if this endpoint runs twice for one
    // call, concurrently or later, the second run finds the claim and skips that follower. That
    // is what stops a retry from placing a second live order.

    // Watchers: $1 paper tails (paper only needs odds, so side may be null)
    const watchers = await store.getActiveWatchers(call.userXHandle);
    const watchResults = await Promise.allSettled(
      watchers.map(async (followerId) => {
        const tail = await store.claimAutoTail({
          followerId,
          callId: call.id,
          mode: "paper",
          amountUsdc: 1,
          entryOdds,
          geminiOrderId: null,
          status: "open",
          pnlUsdc: null,
          source: "watch",
        });
        return tail !== null;
      }),
    );
    let watchTails = 0;
    for (const r of watchResults) {
      if (r.status === "rejected") errors.push(`watch: ${String(r.reason)}`);
      else if (r.value) watchTails += 1;
      else alreadyNotified += 1;
    }

    // Copy traders: paper simulation at the configured size by default; real orders only when
    // copyTradeMode is "live" (which needs a side and an order venue that has the market).
    let copyTails = 0;
    const copyTraders = await store.getActiveCopyTraders(call.userXHandle);
    if (copyTraders.length > 0 && copyTradeMode === "paper") {
      const copyResults = await Promise.allSettled(
        copyTraders.map(async ({ followerId, amountUsdc }) => {
          const tail = await store.claimAutoTail({
            followerId,
            callId: call.id,
            mode: "paper",
            amountUsdc,
            entryOdds,
            geminiOrderId: null,
            status: "open",
            pnlUsdc: null,
            source: "copy",
          });
          return tail !== null;
        }),
      );
      for (const r of copyResults) {
        if (r.status === "rejected") errors.push(`copy: ${String(r.reason)}`);
        else if (r.value) copyTails += 1;
        else alreadyNotified += 1;
      }
    } else if (copyTraders.length > 0 && call.side) {
      const side = call.side;
      const qtyIncrement = outcome.quantityIncrement ?? 0.01;
      const qtyMinimum = outcome.quantityMinimum ?? qtyIncrement;
      const priceIncrement = outcome.priceIncrement ?? 0.01;
      const copyResults = await Promise.allSettled(
        copyTraders.map(async ({ followerId, amountUsdc }) => {
          // Claim first. Only the run that wins the claim may place an order for this follower.
          const tail = await store.claimAutoTail({
            followerId,
            callId: call.id,
            mode: "live",
            amountUsdc,
            entryOdds,
            geminiOrderId: null,
            status: "open",
            pnlUsdc: null,
            source: "copy",
          });
          if (!tail) return false;

          const quantity = snapDown(amountUsdc / entryOdds, qtyIncrement);
          if (quantity < qtyMinimum) {
            await store.updateTail(tail.id, { status: "cancelled" });
            throw new Error("amount too small to buy the minimum quantity at current odds");
          }

          let order;
          try {
            order = await gemini.placeOrder({
              symbol: outcome.instrumentSymbol,
              side: "buy",
              outcome: side,
              quantity: formatToIncrement(quantity, qtyIncrement),
              price: formatToIncrement(entryOdds, priceIncrement),
            });
          } catch (err) {
            // No order was placed. The cancelled row stays, so this follower is not retried
            // automatically: a failed live order needs a person to look at it.
            await store.updateTail(tail.id, { status: "cancelled" });
            throw err;
          }

          const avg = order.avgExecutionPrice ? parseFloat(order.avgExecutionPrice) : NaN;
          const filledOdds = Number.isFinite(avg) && avg > 0 ? avg : entryOdds;
          try {
            await store.updateTail(tail.id, {
              geminiOrderId: String(order.orderId),
              status: parseFloat(order.filledQuantity) > 0 ? "filled" : "open",
              entryOdds: filledOdds,
            });
          } catch (err) {
            // The order exists on Gemini but the tail row was not updated. Say so loudly: this
            // is the one case that needs reconciling by hand. It cannot cause a second order.
            throw new Error(
              `order ${order.orderId} was placed for tail ${tail.id} but the tail row could not be updated: ${String(err)}`,
            );
          }
          return true;
        }),
      );
      for (const r of copyResults) {
        if (r.status === "rejected") errors.push(`copy: ${String(r.reason)}`);
        else if (r.value) copyTails += 1;
        else alreadyNotified += 1;
      }
    }

    return c.json({ watchTails, copyTails, alreadyNotified, errors });
  });

  return app;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function toTailResponse(
  tail: {
    id: string;
    status: string;
    mode: string;
    entryOdds: number;
    amountUsdc: number;
    geminiOrderId: string | null;
    pnlUsdc: number | null;
  },
  extra?: {
    eventName?: string;
    pickLabel?: string | null;
    side?: "yes" | "no" | null;
    traderHandle?: string;
    createdAt?: string;
    realized?: boolean;
    markPrice?: number | null;
    unrealizedPnlUsdc?: number | null;
    exitOdds?: number | null;
    settledAt?: string | null;
  },
) {
  return TailResponse.parse({
    tailId: tail.id,
    status: tail.status,
    mode: tail.mode,
    entryOdds: tail.entryOdds,
    amountUsdc: tail.amountUsdc,
    geminiOrderId: tail.geminiOrderId,
    pnlUsdc: tail.pnlUsdc,
    ...extra,
  });
}
