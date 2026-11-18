import type { OutcomeInfo, MarketStatus } from "@copayme/shared";

export interface CallRow {
  id: string;
  userId: string;
  marketId: string;
  pickedOutcome: string;
  oddsAtCall: number;
  status: string;
}

export interface MarketRow {
  id: string;
  geminiMarketId: string;
  sport: string;
  eventName: string;
  outcomes: OutcomeInfo[];
  lockTime: Date;
  status: MarketStatus;
  winningOutcome: string | null;
}

export interface TailRow {
  id: string;
  followerId: string;
  callId: string;
  mode: "paper" | "live";
  amountUsdc: number;
  entryOdds: number;
  geminiOrderId: string | null;
  status: "open" | "filled" | "settled" | "cancelled";
  pnlUsdc: number | null;
  createdAt: Date;
}

export interface TradingStore {
  getCall(callId: string): Promise<CallRow | null>;
  getMarketById(marketId: string): Promise<MarketRow | null>;
  getMarketByGeminiId(geminiMarketId: string): Promise<MarketRow | null>;
  createTail(tail: Omit<TailRow, "id" | "createdAt">): Promise<TailRow>;
  getTail(tailId: string): Promise<TailRow | null>;
  listUserTails(userId: string): Promise<TailRow[]>;
  upsertMarket(
    market: Omit<MarketRow, "id">,
  ): Promise<MarketRow>;
  listOpenMarkets(): Promise<MarketRow[]>;
}
