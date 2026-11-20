import type postgres from "postgres";
import {
  normHandle,
  totalsFromRows,
  type AddLedgerEntry,
  type LedgerRow,
  type OnchainStore,
  type OnchainUser,
} from "./store.js";

interface UserRow {
  id: string;
  x_user_id: string;
  x_handle: string;
  wallet_address: string | null;
  rewards_opt_in: boolean;
}

interface LedgerDbRow {
  id: string;
  amount_usdc: string; // numeric comes back as string
  reason: string;
  tx_hash: string | null;
  created_at: Date;
}

function toUser(r: UserRow): OnchainUser {
  return {
    id: r.id,
    xUserId: r.x_user_id,
    handle: r.x_handle.toLowerCase(),
    walletAddress: r.wallet_address,
    rewardsOptIn: r.rewards_opt_in,
  };
}

function toRow(r: LedgerDbRow): LedgerRow {
  return {
    id: r.id,
    amountUsdc: Number(r.amount_usdc),
    reason: r.reason,
    txHash: r.tx_hash,
    createdAt: r.created_at,
  };
}

export function createPostgresStore(sql: postgres.Sql): OnchainStore {
  return {
    async findUserById(id) {
      const [r] = await sql<UserRow[]>`
        select id, x_user_id, x_handle, wallet_address, rewards_opt_in from users where id = ${id}`;
      return r ? toUser(r) : null;
    },
    async findUserByHandle(handle) {
      const [r] = await sql<UserRow[]>`
        select id, x_user_id, x_handle, wallet_address, rewards_opt_in
        from users where lower(x_handle) = ${normHandle(handle)}`;
      return r ? toUser(r) : null;
    },
    async upsertXUser({ xUserId, handle }) {
      const [r] = await sql<UserRow[]>`
        insert into users (x_user_id, x_handle) values (${xUserId}, ${normHandle(handle)})
        on conflict (x_user_id) do update set x_handle = excluded.x_handle
        returning id, x_user_id, x_handle, wallet_address, rewards_opt_in`;
      if (!r) throw new Error("upsertXUser returned no row");
      return toUser(r);
    },
    async setWalletAddress(userId, walletAddress) {
      await sql`update users set wallet_address = ${walletAddress} where id = ${userId}`;
    },
    async setOptIn(userId, optIn) {
      // Record when rewards were turned on (kept if already on; cleared when turned off). On the
      // right-hand side, rewards_opt_in is the value before this update.
      await sql`
        update users set
          rewards_opted_in_at = case
            when ${optIn} then case when rewards_opt_in then coalesce(rewards_opted_in_at, now()) else now() end
            else null end,
          rewards_opt_in = ${optIn}
        where id = ${userId}`;
    },
    async ledgerExists(sourceRef) {
      const [r] = await sql<{ one: number }[]>`
        select 1 as one from earnings_ledger where source_ref = ${sourceRef} limit 1`;
      return r !== undefined;
    },
    async addLedgerEntry(entry: AddLedgerEntry) {
      const [r] = await sql<LedgerDbRow[]>`
        insert into earnings_ledger (user_id, amount_usdc, reason, tx_hash, source_ref)
        values (${entry.userId}, ${entry.amountUsdc}, ${entry.reason}, ${entry.txHash}, ${entry.sourceRef ?? null})
        returning id, amount_usdc, reason, tx_hash, created_at`;
      if (!r) throw new Error("addLedgerEntry returned no row");
      return toRow(r);
    },
    async earningsFor(userId) {
      const rows = (
        await sql<LedgerDbRow[]>`
          select id, amount_usdc, reason, tx_hash, created_at
          from earnings_ledger where user_id = ${userId} order by created_at desc`
      ).map(toRow);
      return { ...totalsFromRows(rows), rows };
    },

    async listUnprocessedWinningTails({ includeDemo = false } = {}) {
      const rows = await sql<{
        tail_id: string;
        creator_id: string;
        creator_handle: string;
        pnl: string;
        settled_at: Date;
        rewards_opt_in: boolean;
        rewards_opted_in_at: Date | null;
      }[]>`
        select t.id as tail_id, c.user_id as creator_id, u.x_handle as creator_handle,
               t.pnl_usdc::text as pnl, coalesce(t.settled_at, t.created_at) as settled_at,
               u.rewards_opt_in, u.rewards_opted_in_at
        from tails t
        join calls c on c.id = t.call_id
        join users u on u.id = c.user_id
        join users f on f.id = t.follower_id
        where t.status = 'settled' and t.pnl_usdc > 0
          and t.follower_id <> c.user_id
          and (${includeDemo} or f.x_user_id not like 'demo:%')
          and not exists (select 1 from payout_items pi where pi.tail_id = t.id)
        order by settled_at`;
      return rows.map((r) => ({
        tailId: r.tail_id,
        creatorId: r.creator_id,
        creatorHandle: r.creator_handle.toLowerCase(),
        pnlUsdc: Number(r.pnl),
        settledAt: r.settled_at,
        creatorOptedInAt: r.rewards_opt_in ? r.rewards_opted_in_at : null,
      }));
    },

    async hasPayoutRun(day) {
      const [r] = await sql`select 1 as one from payout_runs where run_day = ${day}::date limit 1`;
      return r !== undefined;
    },

    async recordPayoutRun({ day, runBy, plan }) {
      return sql.begin(async (tx) => {
        const [run] = await tx<{ id: string }[]>`
          insert into payout_runs
            (run_day, run_by, fee_rate, tails, follower_profit, fee_total, fee_credited, fee_retained)
          values (${day}::date, ${runBy}, ${plan.feeRate}, ${plan.tails}, ${plan.followerProfitUsdc},
                  ${plan.feeTotalUsdc}, ${plan.feeCreditedUsdc}, ${plan.feeRetainedUsdc})
          returning id`;
        if (!run) throw new Error("recordPayoutRun: no run row");
        if (plan.items.length > 0) {
          await tx`insert into payout_items ${tx(
            plan.items.map((i) => ({
              tail_id: i.tailId,
              run_id: run.id,
              creator_id: i.creatorId,
              pnl_usdc: i.pnlUsdc,
              fee_usdc: i.feeUsdc,
              credited: i.credited,
            })),
          )}`;
        }
        for (const line of plan.lines) {
          if (!line.credited || !(line.feeUsdc > 0)) continue;
          await tx`
            insert into earnings_ledger (user_id, amount_usdc, reason, tx_hash, source_ref)
            values (${line.creatorId}, ${line.feeUsdc}, 'revenue_share', null, ${`revshare:${run.id}:${line.creatorId}`})`;
        }
        return run.id;
      });
    },

    async listPayoutRuns(limit) {
      const rows = await sql<{
        id: string; run_day: Date; run_by: string; tails: number; follower_profit: string;
        fee_total: string; fee_credited: string; fee_retained: string; created_at: Date;
      }[]>`
        select id, run_day, run_by, tails, follower_profit::text, fee_total::text,
               fee_credited::text, fee_retained::text, created_at
        from payout_runs order by run_day desc limit ${limit}`;
      return rows.map((r) => ({
        id: r.id,
        day: r.run_day.toISOString().slice(0, 10),
        runBy: r.run_by,
        tails: r.tails,
        followerProfitUsdc: Number(r.follower_profit),
        feeTotalUsdc: Number(r.fee_total),
        feeCreditedUsdc: Number(r.fee_credited),
        feeRetainedUsdc: Number(r.fee_retained),
        createdAt: r.created_at,
      }));
    },
  };
}
