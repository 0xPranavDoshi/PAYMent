import type postgres from "postgres";
import type { TradingStore, CallRow, MarketRow, TailRow } from "./store.js";
import type { OutcomeInfo } from "@copayme/shared";

// ── raw DB row shapes ────────────────────────────────────────────────────────

interface DbCall {
  id: string;
  user_id: string;
  market_id: string;
  picked_outcome: string;
  side: string | null;
  odds_at_call: number | null;
  status: string;
}

interface DbMarket {
  id: string;
  gemini_market_id: string;
  sport: string;
  event_name: string;
  outcomes: OutcomeInfo[];
  lock_time: Date;
  status: string;
  winning_outcome: string | null;
}

interface DbTail {
  id: string;
  follower_id: string;
  call_id: string;
  mode: string;
  amount_usdc: string;
  entry_odds: number;
  gemini_order_id: string | null;
  status: string;
  pnl_usdc: string | null;
  created_at: Date;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toCall(r: DbCall): CallRow {
  return {
    id: r.id,
    userId: r.user_id,
    marketId: r.market_id,
    pickedOutcome: r.picked_outcome,
    side: (r.side as "yes" | "no") ?? null,
    oddsAtCall: r.odds_at_call,
    status: r.status,
  };
}

function toMarket(r: DbMarket): MarketRow {
  return {
    id: r.id,
    geminiMarketId: r.gemini_market_id,
    sport: r.sport,
    eventName: r.event_name,
    outcomes: r.outcomes as OutcomeInfo[],
    lockTime: r.lock_time,
    status: r.status as MarketRow["status"],
    winningOutcome: r.winning_outcome,
  };
}

function toTail(r: DbTail): TailRow {
  return {
    id: r.id,
    followerId: r.follower_id,
    callId: r.call_id,
    mode: r.mode as TailRow["mode"],
    amountUsdc: parseFloat(r.amount_usdc),
    entryOdds: r.entry_odds,
    geminiOrderId: r.gemini_order_id,
    status: r.status as TailRow["status"],
    pnlUsdc: r.pnl_usdc !== null ? parseFloat(r.pnl_usdc) : null,
    createdAt: r.created_at,
  };
}

// ── store factory ────────────────────────────────────────────────────────────

export function createPostgresStore(sql: postgres.Sql): TradingStore {
  return {
    async getCall(callId) {
      const [row] = await sql<DbCall[]>`
        select id, user_id, market_id, picked_outcome, side, odds_at_call, status
        from calls where id = ${callId}
      `;
      return row ? toCall(row) : null;
    },

    async getMarketById(marketId) {
      const [row] = await sql<DbMarket[]>`
        select id, gemini_market_id, sport, event_name, outcomes,
               lock_time, status, winning_outcome
        from markets where id = ${marketId}
      `;
      return row ? toMarket(row) : null;
    },

    async getMarketByGeminiId(geminiMarketId) {
      const [row] = await sql<DbMarket[]>`
        select id, gemini_market_id, sport, event_name, outcomes,
               lock_time, status, winning_outcome
        from markets where gemini_market_id = ${geminiMarketId}
      `;
      return row ? toMarket(row) : null;
    },

    async listOpenMarkets() {
      const rows = await sql<DbMarket[]>`
        select id, gemini_market_id, sport, event_name, outcomes,
               lock_time, status, winning_outcome
        from markets where status = 'open'
        order by lock_time asc
      `;
      return rows.map(toMarket);
    },

    async createTail(tail) {
      const [row] = await sql<DbTail[]>`
        insert into tails
          (follower_id, call_id, mode, amount_usdc, entry_odds, gemini_order_id, status, pnl_usdc)
        values
          (${tail.followerId}, ${tail.callId}, ${tail.mode}, ${tail.amountUsdc},
           ${tail.entryOdds}, ${tail.geminiOrderId ?? null}, ${tail.status}, ${tail.pnlUsdc ?? null})
        returning *
      `;
      if (!row) throw new Error("insert into tails returned no row");
      return toTail(row);
    },

    async getTail(tailId) {
      const [row] = await sql<DbTail[]>`
        select * from tails where id = ${tailId}
      `;
      return row ? toTail(row) : null;
    },

    async listUserTails(userId) {
      const rows = await sql<DbTail[]>`
        select * from tails where follower_id = ${userId}
        order by created_at desc
      `;
      return rows.map(toTail);
    },

    async upsertMarket(market) {
      const [row] = await sql<DbMarket[]>`
        insert into markets
          (gemini_market_id, sport, event_name, outcomes, lock_time, status, winning_outcome, synced_at)
        values
          (${market.geminiMarketId}, ${market.sport}, ${market.eventName},
           ${sql.json(market.outcomes)}, ${market.lockTime}, ${market.status},
           ${market.winningOutcome ?? null}, now())
        on conflict (gemini_market_id) do update set
          event_name      = excluded.event_name,
          outcomes        = excluded.outcomes,
          lock_time       = excluded.lock_time,
          status          = excluded.status,
          winning_outcome = excluded.winning_outcome,
          synced_at       = now()
        returning *
      `;
      if (!row) throw new Error("upsert into markets returned no row");
      return toMarket(row);
    },
  };
}
