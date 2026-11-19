// Pure paper-trading P&L math. No DB, no network, no clock: a stake bought at
// `entryOdds` buys `amount / entryOdds` contracts, each later worth `exitPrice`.

function assertEntryOdds(entryOdds: number): void {
  if (!(entryOdds > 0) || entryOdds > 1) {
    throw new RangeError(`entryOdds must be in (0,1], got ${entryOdds}`);
  }
}

function assertExitPrice(exitPrice: number): void {
  if (!(exitPrice >= 0) || exitPrice > 1) {
    throw new RangeError(`exitPrice must be in [0,1], got ${exitPrice}`);
  }
}

/** Contracts implied by a stake at an entry price. */
export function contractsFor(amountUsdc: number, entryOdds: number): number {
  assertEntryOdds(entryOdds);
  return amountUsdc / entryOdds;
}

/**
 * Mark-to-market / realized PnL for a paper position priced at `entryOdds`,
 * now worth `exitPrice` per contract. pnl = amount * (exitPrice - entryOdds) / entryOdds.
 * Rounded to cents. exitPrice must be in [0,1].
 */
export function paperPnlUsdc(args: {
  amountUsdc: number;
  entryOdds: number;
  exitPrice: number;
}): number {
  assertEntryOdds(args.entryOdds);
  assertExitPrice(args.exitPrice);
  const pnl = (args.amountUsdc * (args.exitPrice - args.entryOdds)) / args.entryOdds;
  return Math.round(pnl * 100) / 100;
}

/**
 * The exit price of a resolved binary contract for the side we bought:
 * 1 if the contract resolved to our side, else 0. Returns null when the
 * contract has no resolutionSide yet (market not actually resolved) or side is null.
 */
export function resolvedExitPrice(
  boughtSide: "yes" | "no" | null,
  resolutionSide: "yes" | "no" | null,
): 0 | 1 | null {
  if (boughtSide === null || resolutionSide === null) return null;
  return boughtSide === resolutionSide ? 1 : 0;
}
