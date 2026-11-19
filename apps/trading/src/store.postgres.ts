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
  tweeted_at: Date;
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
  exit_odds: number | null;
  settled_at: Date | null;
  source: string;
  created_at: Date;
}

interface DbWatchBase {
  trader_x_handle: string;
  watched_at: Date;
  n_picks: string;
  active_picks: string;
  staked_usdc: string;
  realized_pnl_usdc: string | null;
  score_now: number | null;
  score_at_watch: number | null;
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
    tweetedAt: r.tweeted_at,
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
    exitOdds: r.exit_odds,
    settledAt: r.settled_at,
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
               c.picked_outcome, c.side, c.odds_at_call, c.status, c.tweeted_at
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

    async claimAutoTail(tail) {
      // The unique index tails_auto_once_idx makes this atomic: of any number of concurrent
      // claims for the same follower and call, exactly one inserts and the rest get no row back.
      const [row] = await sql<DbTail[]>`
        insert into tails
          (follower_id, call_id, mode, amount_usdc, entry_odds, gemini_order_id, status, pnl_usdc, source)
        values
          (${tail.followerId}, ${tail.callId}, ${tail.mode}, ${tail.amountUsdc},
           ${tail.entryOdds}, ${tail.geminiOrderId ?? null}, ${tail.status}, ${tail.pnlUsdc ?? null},
           ${tail.source})
        on conflict (follower_id, call_id, source) where source in ('watch', 'copy') do nothing
        returning *
      `;
      return row ? toTail(row) : null;
    },

    async updateTail(tailId, patch) {
      const columns: Record<string, unknown> = {};
      if (patch.geminiOrderId !== undefined) columns.gemini_order_id = patch.geminiOrderId;
      if (patch.status !== undefined) columns.status = patch.status;
      if (patch.pnlUsdc !== undefined) columns.pnl_usdc = patch.pnlUsdc;
      if (patch.entryOdds !== undefined) columns.entry_odds = patch.entryOdds;
      if (patch.exitOdds !== undefined) columns.exit_odds = patch.exitOdds;
      if (patch.settledAt !== undefined) columns.settled_at = patch.settledAt;
      if (Object.keys(columns).length === 0) return;
      await sql`update tails set ${sql(columns)} where id = ${tailId}`;
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

    async listUserTailsForPnl(userId, source) {
      const rows = await sql<
        (DbTail & {
          side: string | null;
          instrument_symbol: string | null;
          picked_outcome: string | null;
          gemini_market_id: string;
          outcomes: OutcomeInfo[];
          event_name: string;
          trader_handle: string;
        })[]
      >`
        select t.*, c.side, c.instrument_symbol, c.picked_outcome,
               m.gemini_market_id, m.outcomes, m.event_name, u.x_handle as trader_handle
        from tails t
        join calls c   on c.id = t.call_id
        join markets m on m.id = c.market_id
        join users u   on u.id = c.user_id
        where t.follower_id = ${userId}
          ${source ? sql`and t.source = ${source}` : sql``}
        order by t.created_at desc
      `;
      return rows.map((r) => {
        const side = (r.side as "yes" | "no") ?? null;
        const outcome = (r.outcomes ?? []).find(
          (o) =>
            (r.instrument_symbol != null && o.instrumentSymbol === r.instrument_symbol) ||
            (r.picked_outcome != null && o.label === r.picked_outcome),
        );
        const storedMarkPrice = outcome
          ? side === "no" && outcome.noOdds != null
            ? outcome.noOdds
            : outcome.currentOdds
          : null;
        return {
          tail: toTail(r),
          side,
          instrumentSymbol: r.instrument_symbol,
          pickedOutcome: r.picked_outcome,
          ticker: r.gemini_market_id,
          storedMarkPrice,
          eventName: r.event_name,
          traderHandle: r.trader_handle,
        };
      });
    },

    async listOpenPaperTailsByMarket(marketId) {
      const rows = await sql<
        { id: string; amount_usdc: string; entry_odds: number; side: string | null; picked_outcome: string }[]
      >`
        select t.id, t.amount_usdc, t.entry_odds, c.side, c.picked_outcome
        from tails t
        join calls c on c.id = t.call_id
        where c.market_id = ${marketId}
          and t.mode = 'paper'
          and t.status = 'open'
      `;
      return rows.map((r) => ({
        tailId: r.id,
        amountUsdc: parseFloat(r.amount_usdc),
        entryOdds: r.entry_odds,
        side: (r.side as "yes" | "no") ?? null,
        pickedOutcome: r.picked_outcome,
      }));
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
      const rows = await sql<DbWatchBase[]>`
        select
          w.trader_x_handle,
          w.created_at as watched_at,
          count(t.id) as n_picks,
          count(t.id) filter (where t.status = 'open') as active_picks,
          coalesce(sum(t.amount_usdc), 0) as staked_usdc,
          sum(t.pnl_usdc) filter (where t.pnl_usdc is not null) as realized_pnl_usdc,
          us.score as score_now,
          (
            select ss.score from score_snapshots ss
            where ss.user_id = u.id and ss.computed_at <= w.created_at
            order by ss.computed_at desc limit 1
          ) as score_at_watch
        from watches w
        left join users u on lower(u.x_handle) = lower(w.trader_x_handle)
        left join user_scores us on us.user_id = u.id
        left join tails t on t.follower_id = w.follower_id
          and t.source = 'watch'
          and t.mode = 'paper'
          and exists (
            select 1 from calls c join users cu on cu.id = c.user_id
            where c.id = t.call_id and lower(cu.x_handle) = lower(w.trader_x_handle)
          )
        where w.follower_id = ${followerId}
        group by w.trader_x_handle, w.created_at, us.score, u.id
        order by w.created_at desc
      `;
      return rows.map((r) => ({
        traderHandle: r.trader_x_handle,
        watchedAt: r.watched_at,
        nPicks: Number(r.n_picks),
        activePicks: Number(r.active_picks),
        stakedUsdc: parseFloat(r.staked_usdc),
        realizedPnlUsdc: r.realized_pnl_usdc !== null ? parseFloat(r.realized_pnl_usdc) : null,
        scoreNow: r.score_now,
        scoreAtWatch: r.score_at_watch,
      }));
    },

    async listOpenWatchMarks(followerId) {
      const rows = await sql<
        {
          trader_handle: string;
          amount_usdc: string;
          entry_odds: number;
          side: string | null;
          instrument_symbol: string | null;
          picked_outcome: string | null;
          ticker: string;
          outcomes: OutcomeInfo[];
        }[]
      >`
        select
          u.x_handle as trader_handle,
          t.amount_usdc, t.entry_odds, c.side, c.instrument_symbol, c.picked_outcome,
          m.gemini_market_id as ticker, m.outcomes
        from tails t
        join calls c   on c.id = t.call_id
        join users u   on u.id = c.user_id
        join markets m on m.id = c.market_id
        join watches w on w.follower_id = t.follower_id
          and lower(w.trader_x_handle) = lower(u.x_handle)
        where t.follower_id = ${followerId}
          and t.source = 'watch' and t.mode = 'paper' and t.status = 'open'
      `;
      return rows.map((r) => {
        const side = (r.side as "yes" | "no") ?? null;
        const outcome = (r.outcomes ?? []).find(
          (o) =>
            (r.instrument_symbol != null && o.instrumentSymbol === r.instrument_symbol) ||
            (r.picked_outcome != null && o.label === r.picked_outcome),
        );
        const storedMarkPrice = outcome
          ? side === "no" && outcome.noOdds != null
            ? outcome.noOdds
            : outcome.currentOdds
          : null;
        return {
          traderHandle: r.trader_handle,
          amountUsdc: parseFloat(r.amount_usdc),
          entryOdds: r.entry_odds,
          side,
          instrumentSymbol: r.instrument_symbol,
          pickedOutcome: r.picked_outcome,
          ticker: r.ticker,
          storedMarkPrice,
        };
      });
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
          count(t.id) filter (where t.status <> 'cancelled') as n_trades,
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
          count(t.id) filter (where t.status <> 'cancelled') as n_trades,
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
