import { randomUUID } from "node:crypto";
import {
  normHandle,
  totalsFromRows,
  type AddLedgerEntry,
  type LedgerRow,
  type OnchainStore,
  type OnchainUser,
} from "./store.js";

/**
 * In-memory store. Lets the service, its tests, and a credential-free demo run with
 * no Postgres. Not durable — swap for the Postgres store (STORE=postgres) for real data.
 */
export function createMemoryStore(seed: OnchainUser[] = []): OnchainStore {
  const users = new Map<string, OnchainUser>();
  for (const u of seed) users.set(u.id, { ...u, handle: normHandle(u.handle) });
  const ledger: (LedgerRow & { userId: string; sourceRef: string | null })[] = [];

  const byHandle = (h: string) =>
    [...users.values()].find((u) => u.handle === normHandle(h)) ?? null;

  return {
    async findUserById(id) {
      return users.get(id) ?? null;
    },
    async findUserByHandle(handle) {
      return byHandle(handle);
    },
    async upsertXUser({ xUserId, handle }) {
      const existing = [...users.values()].find((u) => u.xUserId === xUserId);
      if (existing) {
        existing.handle = normHandle(handle);
        return existing;
      }
      const user: OnchainUser = {
        id: randomUUID(),
        xUserId,
        handle: normHandle(handle),
        walletAddress: null,
        rewardsOptIn: false,
      };
      users.set(user.id, user);
      return user;
    },
    async setWalletAddress(userId, walletAddress) {
      const u = users.get(userId);
      if (u) u.walletAddress = walletAddress;
    },
    async setOptIn(userId, optIn) {
      const u = users.get(userId);
      if (u) u.rewardsOptIn = optIn;
    },
    async ledgerExists(sourceRef) {
      return ledger.some((r) => r.sourceRef === sourceRef);
    },
    async addLedgerEntry(entry: AddLedgerEntry) {
      const row = {
        id: randomUUID(),
        userId: entry.userId,
        amountUsdc: entry.amountUsdc,
        reason: entry.reason,
        txHash: entry.txHash,
        sourceRef: entry.sourceRef ?? null,
        createdAt: new Date(),
      };
      ledger.push(row);
      return { id: row.id, amountUsdc: row.amountUsdc, reason: row.reason, txHash: row.txHash, createdAt: row.createdAt };
    },
    async earningsFor(userId) {
      const rows = ledger
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((r): LedgerRow => ({ id: r.id, amountUsdc: r.amountUsdc, reason: r.reason, txHash: r.txHash, createdAt: r.createdAt }));
      return { ...totalsFromRows(rows), rows };
    },
  };
}
