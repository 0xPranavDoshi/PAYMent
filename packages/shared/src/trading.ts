import { z } from "zod";

// ── Tail (copy-trade) ────────────────────────────────────────────────────────

/** Sent by the extension tail card to POST /v1/tails on the trading service. */
export const TailRequest = z.object({
  /** UUID of the calls row being tailed. */
  callId: z.string().uuid(),
  /** paper = simulated; live = real order on Gemini sandbox */
  mode: z.enum(["paper", "live"]),
  /** How much USDC to risk. */
  amountUsdc: z.number().positive(),
  /** Current odds shown to the user at click time, used for slippage check. */
  quotedOdds: z.number().min(0).max(1),
});
export type TailRequest = z.infer<typeof TailRequest>;

export const TailResponse = z.object({
  tailId: z.string().uuid(),
  status: z.enum(["open", "filled", "settled", "cancelled"]),
  mode: z.enum(["paper", "live"]),
  entryOdds: z.number(),
  amountUsdc: z.number(),
  geminiOrderId: z.string().nullable(),
  pnlUsdc: z.number().nullable(),
  // Paper-sim settlement detail. Optional so existing clients keep working.
  realized: z.boolean().optional(),          // true once the market resolved and pnl is final
  markPrice: z.number().min(0).max(1).nullable().optional(), // current/exit price per contract
  unrealizedPnlUsdc: z.number().nullable().optional(),       // mark-to-market pnl while open
  exitOdds: z.number().min(0).max(1).nullable().optional(),  // resolved exit price (0/1) once settled
  settledAt: z.string().datetime().nullable().optional(),
});
export type TailResponse = z.infer<typeof TailResponse>;

// ── Market ───────────────────────────────────────────────────────────────────

export const MarketStatus = z.enum(["open", "locked", "resolved", "void"]);
export type MarketStatus = z.infer<typeof MarketStatus>;

export const OutcomeInfo = z.object({
  label: z.string(),
  instrumentSymbol: z.string(),
  currentOdds: z.number().min(0).max(1),
  noOdds: z.number().min(0).max(1).nullable(),
  resolutionSide: z.enum(["yes", "no"]).nullable(),
  // Order sizing increments from Gemini. Optional: only the trading service's own
  // sync populates them, so other workstreams can build markets without them.
  priceIncrement: z.number().positive().nullish(),
  quantityIncrement: z.number().positive().nullish(),
  quantityMinimum: z.number().positive().nullish(),
});
export type OutcomeInfo = z.infer<typeof OutcomeInfo>;

export const MarketSummary = z.object({
  id: z.string().uuid(),
  geminiMarketId: z.string(),
  sport: z.string(),
  eventName: z.string(),
  outcomes: z.array(OutcomeInfo),
  lockTime: z.string().datetime(),
  status: MarketStatus,
  winningOutcome: z.string().nullable(),
});
export type MarketSummary = z.infer<typeof MarketSummary>;

// ── Watch / Copy Trade ───────────────────────────────────────────────────────

export const WatchItem = z.object({
  traderHandle: z.string(),
  watchedAt: z.string().datetime(),
  nPicks: z.number().int().nonnegative(),
  activePicks: z.number().int().nonnegative(),
  /** Total USDC staked across this trader's watched picks ($1 each). */
  stakedUsdc: z.number().nonnegative(),
  /** Realized PnL from settled picks (kept for existing clients). */
  paperPnlUsdc: z.number().nullable(),
  /** Realized + live mark-to-market of still-open picks: "what could have been" so far. */
  projectedPnlUsdc: z.number().nullable(),
  /** projectedPnlUsdc / stakedUsdc * 100. */
  pnlPct: z.number().nullable(),
  /** The trader's score now and when you started watching, and the change since. */
  scoreNow: z.number().int().nullable(),
  scoreAtWatch: z.number().int().nullable(),
  scoreDelta: z.number().int().nullable(),
});
export type WatchItem = z.infer<typeof WatchItem>;

export const CopyTradeConfig = z.object({
  traderHandle: z.string(),
  amountUsdc: z.number().positive(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  nTrades: z.number().int().nonnegative(),
  livePnlUsdc: z.number().nullable(),
});
export type CopyTradeConfig = z.infer<typeof CopyTradeConfig>;
