/** A user as the on-chain service needs them (subset of the users table). */
export interface OnchainUser {
  id: string;
  xUserId: string;
  /** Lowercase x_handle, no leading @. */
  handle: string;
  walletAddress: string | null;
  rewardsOptIn: boolean;
}

/** One earnings_ledger row. */
export interface LedgerRow {
  id: string;
  amountUsdc: number;
  reason: string;
  txHash: string | null;
  createdAt: Date;
}

export interface EarningsTotals {
  totalEarnedUsdc: number;
  redeemedUsdc: number;
  availableUsdc: number;
  rows: LedgerRow[];
}

export interface AddLedgerEntry {
  userId: string;
  /** Signed: positive = reward credited, negative = redeemed. */
  amountUsdc: number;
  reason: string;
  txHash: string | null;
  /** Idempotency key, e.g. `reward:<tailId>`. */
  sourceRef?: string | null;
}

export interface OnchainStore {
  findUserById(id: string): Promise<OnchainUser | null>;
  findUserByHandle(handle: string): Promise<OnchainUser | null>;
  /** Create or update the users row for an X identity. */
  upsertXUser(x: { xUserId: string; handle: string }): Promise<OnchainUser>;
  setWalletAddress(userId: string, walletAddress: string): Promise<void>;
  setOptIn(userId: string, optIn: boolean): Promise<void>;
  /** True if a ledger row already exists for this sourceRef (so a retried payout is a no-op). */
  ledgerExists(sourceRef: string): Promise<boolean>;
  addLedgerEntry(entry: AddLedgerEntry): Promise<LedgerRow>;
  earningsFor(userId: string): Promise<EarningsTotals>;
}

/** Sum signed ledger rows into display totals. Shared by every store implementation. */
export function totalsFromRows(rows: LedgerRow[]): Omit<EarningsTotals, "rows"> {
  let totalEarnedUsdc = 0;
  let redeemedUsdc = 0;
  for (const r of rows) {
    if (r.amountUsdc >= 0) totalEarnedUsdc += r.amountUsdc;
    else redeemedUsdc += -r.amountUsdc;
  }
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    totalEarnedUsdc: round(totalEarnedUsdc),
    redeemedUsdc: round(redeemedUsdc),
    availableUsdc: round(totalEarnedUsdc - redeemedUsdc),
  };
}

/** Normalize an X handle: trim, drop a leading @, lowercase. */
export function normHandle(h: string): string {
  return h.trim().replace(/^@/, "").toLowerCase();
}
