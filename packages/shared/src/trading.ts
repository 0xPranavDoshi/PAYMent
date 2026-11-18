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
});
export type TailResponse = z.infer<typeof TailResponse>;

// ── Post ingest (from Pranav's Grok pipeline) ────────────────────────────────

export const NewPost = z.object({
  tweetId: z.string(),
  xUserId: z.string(),
  xHandle: z.string(),
  tweetedAt: z.string().datetime(),
  tweetText: z.string(),
  sentiment: z.unknown(),
  geminiMarketId: z.string().nullable(),
  pickedOutcome: z.string().nullable(),
});
export type NewPost = z.infer<typeof NewPost>;

// ── Market ───────────────────────────────────────────────────────────────────

export const MarketStatus = z.enum(["open", "locked", "resolved", "void"]);
export type MarketStatus = z.infer<typeof MarketStatus>;

export const OutcomeInfo = z.object({
  label: z.string(),
  instrumentSymbol: z.string(),
  currentOdds: z.number().min(0).max(1),
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
