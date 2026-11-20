// Daily revenue share. A follower trade (tail) that settled in profit pays a fee of
// PAYOUT_FEE_RATE × its profit. The fee goes to the creator whose pick it was, if that creator
// opted in to rewards before the trade's settle day (UTC) — rewards start the day after opting
// in. Otherwise the treasury keeps it. Pure functions here; persistence lives in the store.

/** A settled, profitable follower trade that hasn't been through a payout run yet. */
export interface UnprocessedTail {
  tailId: string;
  creatorId: string;
  creatorHandle: string;
  pnlUsdc: number;
  settledAt: Date;
  /** When the creator turned rewards on; null when they're not opted in. */
  creatorOptedInAt: Date | null;
}

export interface PayoutLine {
  creatorId: string;
  creatorHandle: string;
  tails: number;
  followerProfitUsdc: number;
  feeUsdc: number;
  /** True when the fee is credited to the creator; false when the treasury keeps it. */
  credited: boolean;
}

export interface PayoutItem {
  tailId: string;
  creatorId: string;
  pnlUsdc: number;
  feeUsdc: number;
  credited: boolean;
}

export interface PayoutPlan {
  feeRate: number;
  tails: number;
  followerProfitUsdc: number;
  feeTotalUsdc: number;
  feeCreditedUsdc: number;
  feeRetainedUsdc: number;
  lines: PayoutLine[];
  items: PayoutItem[];
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Start of the UTC day after `d` — the first moment a new opt-in earns rewards. */
export function nextUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}

/** Whether a trade settled at `settledAt` earns its creator a share. */
export function isCreditable(settledAt: Date, optedInAt: Date | null): boolean {
  return optedInAt !== null && settledAt.getTime() >= nextUtcDay(optedInAt).getTime();
}

/** Today's UTC date as YYYY-MM-DD. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Turns the unprocessed profitable trades into a payout plan: a fee per trade, and one line per
 * creator split into the credited part and the part the treasury keeps.
 */
export function planPayout(tails: readonly UnprocessedTail[], feeRate: number): PayoutPlan {
  const items: PayoutItem[] = [];
  // Key by creator and credited-ness: a creator can have both if they opted in mid-batch.
  const lines = new Map<string, PayoutLine>();

  for (const t of tails) {
    if (!(t.pnlUsdc > 0)) continue;
    const feeUsdc = round6(t.pnlUsdc * feeRate);
    const credited = isCreditable(t.settledAt, t.creatorOptedInAt);
    items.push({ tailId: t.tailId, creatorId: t.creatorId, pnlUsdc: t.pnlUsdc, feeUsdc, credited });

    const key = `${t.creatorId}:${credited}`;
    const line = lines.get(key) ?? {
      creatorId: t.creatorId,
      creatorHandle: t.creatorHandle,
      tails: 0,
      followerProfitUsdc: 0,
      feeUsdc: 0,
      credited,
    };
    line.tails += 1;
    line.followerProfitUsdc = round6(line.followerProfitUsdc + t.pnlUsdc);
    line.feeUsdc = round6(line.feeUsdc + feeUsdc);
    lines.set(key, line);
  }

  const sorted = [...lines.values()].sort((a, b) => b.feeUsdc - a.feeUsdc);
  const sum = (xs: PayoutItem[]) => round6(xs.reduce((s, x) => s + x.feeUsdc, 0));
  return {
    feeRate,
    tails: items.length,
    followerProfitUsdc: round6(items.reduce((s, x) => s + x.pnlUsdc, 0)),
    feeTotalUsdc: sum(items),
    feeCreditedUsdc: sum(items.filter((i) => i.credited)),
    feeRetainedUsdc: sum(items.filter((i) => !i.credited)),
    lines: sorted,
    items,
  };
}
