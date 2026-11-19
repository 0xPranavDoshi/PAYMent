import type postgres from "postgres";
import type { TradingStore, CallRow, MarketRow, TailRow } from "./store.js";
import type { OutcomeInfo, CopyTradeConfig } from "@copayme/shared";

// ── raw DB row shapes ────────────────────────────────────────────────────────

interface DbCall {
  id: string;
  user_id: string;
  user_x_handle: string;
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
  source: string;
  created_at: Date;
}

interface DbWatchItem {
  trader_x_handle: string;
  created_at: Date;
  n_picks: string;
  paper_pnl_usdc: string | null;
  active_picks: string;
}

interface DbCopyTrade {
  id: string;
  follower_id: string;
  trader_x_handle: string;
  amount_usdc: string;
  active: boolean;
  created_at: Date;
  paused_at: Date | null;
}

interface DbCopyTradeStats {
  n_trades: string;
  live_pnl_usdc: string | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function toCall(r: DbCall): CallRow {
  return {
    id: r.id,
    userId: r.user_id,
    userXHandle: r.user_x_handle,
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
    source: r.source as TailRow["source"],
    createdAt: r.created_at,
  };
}

function toCopyTradeConfig(
  r: DbCopyTrade,
  nTrades: number,
  livePnlUsdc: number | null,
): CopyTradeConfig {
  return {
    traderHandle: r.trader_x_handle,
    amountUsdc: parseFloat(r.amount_usdc),
    active: r.active,
    createdAt: r.created_at.toISOString(),
    nTrades,
    livePnlUsdc,
  };
}

// ── store factory ────────────────────────────────────────────────────────────

export function createPostgresStore(sql: postgres.Sql): TradingStore {
  return {
    async getCall(callId) {
      const [row] = await sql<DbCall[]>`
        select c.id, c.user_id, u.x_handle as user_x_handle, c.market_id,
               c.picked_outcome, c.side, c.odds_at_call, c.status
        from calls c
        join users u on u.id = c.user_id
        where c.id = ${callId}
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
          (follower_id, call_id, mode, amount_usdc, entry_odds, gemini_order_id, status, pnl_usdc, source)
        values
          (${tail.followerId}, ${tail.callId}, ${tail.mode}, ${tail.amountUsdc},
           ${tail.entryOdds}, ${tail.geminiOrderId ?? null}, ${tail.status}, ${tail.pnlUsdc ?? null},
           ${tail.source ?? "manual"})
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

    async addWatch(followerId, traderHandle) {
      await sql`
        insert into watches (follower_id, trader_x_handle)
        values (${followerId}, ${traderHandle})
        on conflict (follower_id, trader_x_handle) do nothing
      `;
    },

    async removeWatch(followerId, traderHandle) {
      await sql`
        delete from watches
        where follower_id = ${followerId} and trader_x_handle = ${traderHandle}
      `;
    },

    async listWatches(followerId) {
      const rows = await sql<DbWatchItem[]>`
        select w.trader_x_handle, w.created_at,
          count(t.id) as n_picks,
          sum(t.pnl_usdc) filter (where t.pnl_usdc is not null) as paper_pnl_usdc,
          count(t.id) filter (where t.status = 'open') as active_picks
        from watches w
        left join tails t on t.follower_id = w.follower_id
          and t.source = 'watch'
          and t.mode = 'paper'
          and exists (
            select 1 from calls c join users u on u.id = c.user_id
            where c.id = t.call_id and lower(u.x_handle) = lower(w.trader_x_handle)
          )
        where w.follower_id = ${followerId}
        group by w.trader_x_handle, w.created_at
        order by w.created_at desc
      `;
      return rows.map((r) => ({
        traderHandle: r.trader_x_handle,
        watchedAt: r.created_at.toISOString(),
        nPicks: Number(r.n_picks),
        paperPnlUsdc: r.paper_pnl_usdc !== null ? parseFloat(r.paper_pnl_usdc) : null,
        activePicks: Number(r.active_picks),
      }));
    },

    async upsertCopyTrade(followerId, traderHandle, amountUsdc) {
      const [row] = await sql<DbCopyTrade[]>`
        insert into copy_trades (follower_id, trader_x_handle, amount_usdc)
        values (${followerId}, ${traderHandle}, ${amountUsdc})
        on conflict (follower_id, trader_x_handle) do update set
          amount_usdc = excluded.amount_usdc,
          active      = true,
          paused_at   = null
        returning *
      `;
      if (!row) throw new Error("upsert into copy_trades returned no row");
      return toCopyTradeConfig(row, 0, null);
    },

    async updateCopyTrade(followerId, traderHandle, patch) {
      const [row] = await sql<DbCopyTrade[]>`
        update copy_trades set
          amount_usdc = ${patch.amountUsdc ?? sql`amount_usdc`},
          active      = ${patch.active ?? sql`active`},
          paused_at   = ${patch.active === false ? sql`now()` : patch.active === true ? sql`null` : sql`paused_at`}
        where follower_id = ${followerId} and trader_x_handle = ${traderHandle}
        returning *
      `;
      if (!row) return null;
      const [stats] = await sql<DbCopyTradeStats[]>`
        select
          count(t.id) as n_trades,
          sum(t.pnl_usdc) filter (where t.pnl_usdc is not null) as live_pnl_usdc
        from tails t
        where t.follower_id = ${followerId}
          and t.source = 'copy'
          and t.mode = 'live'
          and exists (
            select 1 from calls c join users u on u.id = c.user_id
            where c.id = t.call_id and lower(u.x_handle) = lower(${traderHandle})
          )
      `;
      return toCopyTradeConfig(
        row,
        stats ? Number(stats.n_trades) : 0,
        stats && stats.live_pnl_usdc !== null ? parseFloat(stats.live_pnl_usdc) : null,
      );
    },

    async listCopyTrades(followerId) {
      const rows = await sql<(DbCopyTrade & DbCopyTradeStats)[]>`
        select ct.*,
          count(t.id) as n_trades,
          sum(t.pnl_usdc) filter (where t.pnl_usdc is not null) as live_pnl_usdc
        from copy_trades ct
        left join tails t on t.follower_id = ct.follower_id
          and t.source = 'copy'
          and t.mode = 'live'
          and exists (
            select 1 from calls c join users u on u.id = c.user_id
            where c.id = t.call_id and lower(u.x_handle) = lower(ct.trader_x_handle)
          )
        where ct.follower_id = ${followerId}
        group by ct.id
        order by ct.created_at desc
      `;
      return rows.map((r) =>
        toCopyTradeConfig(
          r,
          Number(r.n_trades),
          r.live_pnl_usdc !== null ? parseFloat(r.live_pnl_usdc) : null,
        ),
      );
    },

    async getActiveWatchers(traderHandle) {
      const rows = await sql<{ follower_id: string }[]>`
        select follower_id from watches
        where lower(trader_x_handle) = lower(${traderHandle})
      `;
      return rows.map((r) => r.follower_id);
    },

    async getActiveCopyTraders(traderHandle) {
      const rows = await sql<{ follower_id: string; amount_usdc: string }[]>`
        select follower_id, amount_usdc from copy_trades
        where lower(trader_x_handle) = lower(${traderHandle}) and active = true
      `;
      return rows.map((r) => ({
        followerId: r.follower_id,
        amountUsdc: parseFloat(r.amount_usdc),
      }));
    },
  };
}
