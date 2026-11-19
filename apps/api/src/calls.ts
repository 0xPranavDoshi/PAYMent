import type { CallEntry, CallStatus } from "@copayme/shared";
import { z } from "zod";

/** A call joined with its market and post, as the ledger needs it. */
export interface LedgerRow {
  id: string;
  tweetId: string;
  tweetText: string;
  tweetedAt: Date;
  eventName: string;
  pickedOutcome: string;
  instrumentSymbol: string | null;
  side: "yes" | "no" | null;
  oddsAtCall: number | null;
  oddsSource: "history" | "snapshot" | "none";
  status: CallStatus;
  points: number | null;
  /** markets.outcomes as stored (jsonb). */
  outcomes: unknown;
}

export interface CallsStore {
  /** The user's calls, newest first; null when no user has this handle. */
  listCalls(handle: string, opts: { limit: number; statuses: readonly CallStatus[] | null }): Promise<LedgerRow[] | null>;
}

const Contract = z.object({
  instrumentSymbol: z.string(),
  resolutionSide: z.enum(["yes", "no"]).nullish(),
});

/** Whether a scored call won, from the market's stored result for its contract. Null if not known. */
export function resultOf(row: Pick<LedgerRow, "status" | "side" | "instrumentSymbol" | "outcomes">): "won" | "lost" | null {
  if (row.status !== "scored" || row.side === null || row.instrumentSymbol === null) return null;
  const contracts = z.array(Contract).safeParse(row.outcomes);
  const resolution = contracts.success
    ? contracts.data.find((c) => c.instrumentSymbol === row.instrumentSymbol)?.resolutionSide
    : undefined;
  return resolution ? (resolution === row.side ? "won" : "lost") : null;
}

export function toCallEntry(row: LedgerRow): CallEntry {
  return {
    callId: row.id,
    tweetId: row.tweetId,
    tweetText: row.tweetText,
    tweetedAt: row.tweetedAt.toISOString(),
    eventName: row.eventName,
    pickLabel: row.pickedOutcome,
    side: row.side,
    oddsAtCall: row.oddsAtCall,
    oddsSource: row.oddsSource,
    status: row.status,
    result: resultOf(row),
    points: row.points,
  };
}
