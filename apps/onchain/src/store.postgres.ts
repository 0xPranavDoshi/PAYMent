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
      await sql`update users set rewards_opt_in = ${optIn} where id = ${userId}`;
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
  };
}
