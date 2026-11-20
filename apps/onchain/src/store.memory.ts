import { randomUUID } from "node:crypto";
import {
  normHandle,
  totalsFromRows,
  type AddLedgerEntry,
  type LedgerRow,
  type OnchainStore,
  type OnchainUser,
  type PayoutRunSummary,
} from "./store.js";

/** A settled follower trade, for the in-memory store's payout tests. */
export interface MemoryTail {
  id: string;
  creatorId: string;
  followerId: string;
  pnlUsdc: number;
  settledAt: Date;
}

/**
 * In-memory store. Lets the service, its tests, and a credential-free demo run with
 * no Postgres. Not durable — swap for the Postgres store (STORE=postgres) for real data.
 */
export function createMemoryStore(
  seed: OnchainUser[] = [],
  opts: { tails?: MemoryTail[]; optedInAt?: Record<string, Date> } = {},
): OnchainStore {
  const users = new Map<string, OnchainUser>();
  for (const u of seed) users.set(u.id, { ...u, handle: normHandle(u.handle) });
  const ledger: (LedgerRow & { userId: string; sourceRef: string | null })[] = [];
  const optedInAt = new Map<string, Date | null>(Object.entries(opts.optedInAt ?? {}));
  const tails = opts.tails ?? [];
  const processed = new Set<string>();
  const runs: PayoutRunSummary[] = [];

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
      if (!u) return;
      if (optIn && !u.rewardsOptIn) optedInAt.set(userId, new Date());
      if (!optIn) optedInAt.set(userId, null);
      u.rewardsOptIn = optIn;
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

    async listUnprocessedWinningTails({ includeDemo = false } = {}) {
      const isDemo = (id: string) => users.get(id)?.xUserId.startsWith("demo:") ?? false;
      return tails
        .filter((t) => t.pnlUsdc > 0 && t.followerId !== t.creatorId && !processed.has(t.id))
        .filter((t) => includeDemo || !isDemo(t.followerId))
        .map((t) => {
          const creator = users.get(t.creatorId);
          return {
            tailId: t.id,
            creatorId: t.creatorId,
            creatorHandle: creator?.handle ?? "unknown",
            pnlUsdc: t.pnlUsdc,
            settledAt: t.settledAt,
            creatorOptedInAt: creator?.rewardsOptIn ? (optedInAt.get(t.creatorId) ?? null) : null,
          };
        });
    },
    async hasPayoutRun(day) {
      return runs.some((r) => r.day === day);
    },
    async recordPayoutRun({ day, runBy, plan }) {
      if (runs.some((r) => r.day === day)) throw new Error(`payout already ran on ${day}`);
      const id = randomUUID();
      runs.push({
        id, day, runBy, tails: plan.tails, followerProfitUsdc: plan.followerProfitUsdc,
        feeTotalUsdc: plan.feeTotalUsdc, feeCreditedUsdc: plan.feeCreditedUsdc,
        feeRetainedUsdc: plan.feeRetainedUsdc, createdAt: new Date(),
      });
      for (const i of plan.items) processed.add(i.tailId);
      for (const line of plan.lines) {
        if (!line.credited || !(line.feeUsdc > 0)) continue;
        ledger.push({
          id: randomUUID(), userId: line.creatorId, amountUsdc: line.feeUsdc, reason: "revenue_share",
          txHash: null, sourceRef: `revshare:${id}:${line.creatorId}`, createdAt: new Date(),
        });
      }
      return id;
    },
    async listPayoutRuns(limit) {
      return [...runs].sort((a, b) => b.day.localeCompare(a.day)).slice(0, limit);
    },
  };
}
