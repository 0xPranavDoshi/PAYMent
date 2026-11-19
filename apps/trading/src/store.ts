import type { OutcomeInfo, MarketStatus, CopyTradeConfig } from "@copayme/shared";

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
  exitOdds: number | null;
  settledAt: Date | null;
  source: "manual" | "watch" | "copy";
  createdAt: Date;
}

/** Per-watched-trader aggregate that the database can compute directly (no live prices). */
export interface WatchBase {
  traderHandle: string;
  watchedAt: Date;
  nPicks: number;
  activePicks: number;
  stakedUsdc: number;
  realizedPnlUsdc: number | null;
  scoreNow: number | null;
  scoreAtWatch: number | null;
}

/** One still-open watch tail with the context needed to mark it to market. */
export interface WatchOpenMark {
  traderHandle: string;
  amountUsdc: number;
  entryOdds: number;
  side: "yes" | "no" | null;
  instrumentSymbol: string | null;
  pickedOutcome: string | null;
  ticker: string;
  storedMarkPrice: number | null;
}

export interface TradingStore {
  getCall(callId: string): Promise<CallRow | null>;
  getMarketById(marketId: string): Promise<MarketRow | null>;
  getMarketByGeminiId(geminiMarketId: string): Promise<MarketRow | null>;
  createTail(tail: Omit<TailRow, "id" | "createdAt" | "source" | "exitOdds" | "settledAt"> & { source?: TailRow["source"] }): Promise<TailRow>;
  /**
   * Creates an automatic (watch or copy) tail unless this follower already has one for this call.
   * Returns null when one exists: that follower was already handled, so skip them. Atomic.
   */
  claimAutoTail(
    tail: Omit<TailRow, "id" | "createdAt" | "source" | "exitOdds" | "settledAt"> & { source: "watch" | "copy" },
  ): Promise<TailRow | null>;
  updateTail(
    tailId: string,
    patch: {
      geminiOrderId?: string | null;
      status?: TailRow["status"];
      pnlUsdc?: number | null;
      entryOdds?: number;
      exitOdds?: number | null;
      settledAt?: Date | null;
    },
  ): Promise<void>;
  getTail(tailId: string): Promise<TailRow | null>;
  listUserTails(userId: string): Promise<TailRow[]>;
  /**
   * A user's tails joined to the call and market details needed to mark open paper tails to
   * market: the bought side, the picked contract's symbol/label, the market's Gemini ticker,
   * and the last synced price for that side (used when a live fetch fails). Newest first.
   */
  listUserTailsForPnl(
    userId: string,
    source?: TailRow["source"],
  ): Promise<
    Array<{
      tail: TailRow;
      side: "yes" | "no" | null;
      instrumentSymbol: string | null;
      pickedOutcome: string | null;
      ticker: string;
      storedMarkPrice: number | null;
    }>
  >;
  /** Open paper tails on calls belonging to this market, with the call's side and picked outcome. */
  listOpenPaperTailsByMarket(marketId: string): Promise<Array<{
    tailId: string;
    amountUsdc: number;
    entryOdds: number;
    side: "yes" | "no" | null;
    pickedOutcome: string;
  }>>;
  upsertMarket(
    market: Omit<MarketRow, "id">,
  ): Promise<MarketRow>;
  listOpenMarkets(): Promise<MarketRow[]>;

  addWatch(followerId: string, traderHandle: string): Promise<void>;
  removeWatch(followerId: string, traderHandle: string): Promise<void>;
  listWatches(followerId: string): Promise<WatchBase[]>;
  /** Open watch tails for a follower, with per-tail marking context. */
  listOpenWatchMarks(followerId: string): Promise<WatchOpenMark[]>;

  upsertCopyTrade(followerId: string, traderHandle: string, amountUsdc: number): Promise<CopyTradeConfig>;
  updateCopyTrade(followerId: string, traderHandle: string, patch: { amountUsdc?: number; active?: boolean }): Promise<CopyTradeConfig | null>;
  listCopyTrades(followerId: string): Promise<CopyTradeConfig[]>;

  getActiveWatchers(traderHandle: string): Promise<string[]>;
  getActiveCopyTraders(traderHandle: string): Promise<{ followerId: string; amountUsdc: number }[]>;
}
