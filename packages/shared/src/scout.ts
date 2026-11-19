import { z } from "zod";
import { Sentiment } from "./sentiment.js";

export const PickMatch = z.object({
  predictionIndex: z.number().int(),
  status: z.enum(["matched", "no_market", "rejected"]),
  reason: z.string().nullable(),
  geminiEventTicker: z.string().nullable(), // the sub-event, e.g. "NCAAM-2611190200-UCONN-ARI-S"
  gameTicker: z.string().nullable(), // the parent game, e.g. "NCAAM-2611190200-UCONN-ARI-M"
  instrumentSymbol: z.string().nullable(), // e.g. "GEMI-NCAAM-2611190200-UCONN-ARI-M-ARI"
  contractLabel: z.string().nullable(),
  side: z.enum(["yes", "no"]).nullable(),
  gameStartTime: z.string().datetime().nullable(),
  marketStatus: z.enum(["open", "settled"]).nullable(),
  resolutionSide: z.enum(["yes", "no"]).nullable(), // filled when settled
});
export type PickMatch = z.infer<typeof PickMatch>;

export const ScoutResult = z.object({
  tweetId: z.string(),
  tweetedAt: z.string().datetime(),
  tweetText: z.string(),
  sentiment: Sentiment,
  matches: z.array(PickMatch),
});
export type ScoutResult = z.infer<typeof ScoutResult>;

export const ScoutStatus = z.enum(["idle", "running", "failed"]);
export type ScoutStatus = z.infer<typeof ScoutStatus>;

export const ScoutResponse = z.object({
  handle: z.string(),
  status: ScoutStatus,
  scannedAt: z.string().datetime().nullable(),
  results: z.array(ScoutResult),
});
export type ScoutResponse = z.infer<typeof ScoutResponse>;
