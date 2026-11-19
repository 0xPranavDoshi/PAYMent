import type { OutcomeInfo, MarketStatus, WatchItem, CopyTradeConfig } from "@copayme/shared";

export interface CallRow {
  id: string;
  userId: string;
  userXHandle: string;
  marketId: string;
  pickedOutcome: string;
  side: "yes" | "no" | null;
  oddsAtCall: number | null;
  status: string;
  /** When the user tweeted the pick. */
  tweetedAt: Date;
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
  source: "manual" | "watch" | "copy";
  createdAt: Date;
}

export interface TradingStore {
  getCall(callId: string): Promise<CallRow | null>;
  getMarketById(marketId: string): Promise<MarketRow | null>;
  getMarketByGeminiId(geminiMarketId: string): Promise<MarketRow | null>;
  createTail(tail: Omit<TailRow, "id" | "createdAt" | "source"> & { source?: TailRow["source"] }): Promise<TailRow>;
  getTail(tailId: string): Promise<TailRow | null>;
  listUserTails(userId: string): Promise<TailRow[]>;
  upsertMarket(
    market: Omit<MarketRow, "id">,
  ): Promise<MarketRow>;
  listOpenMarkets(): Promise<MarketRow[]>;

  addWatch(followerId: string, traderHandle: string): Promise<void>;
  removeWatch(followerId: string, traderHandle: string): Promise<void>;
  listWatches(followerId: string): Promise<WatchItem[]>;

  upsertCopyTrade(followerId: string, traderHandle: string, amountUsdc: number): Promise<CopyTradeConfig>;
  updateCopyTrade(followerId: string, traderHandle: string, patch: { amountUsdc?: number; active?: boolean }): Promise<CopyTradeConfig | null>;
  listCopyTrades(followerId: string): Promise<CopyTradeConfig[]>;

  getActiveWatchers(traderHandle: string): Promise<string[]>;
  getActiveCopyTraders(traderHandle: string): Promise<{ followerId: string; amountUsdc: number }[]>;
}
