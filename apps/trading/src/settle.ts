import { paperPnlUsdc, resolvedExitPrice } from "@copayme/shared";
import type { MarketRow, TradingStore } from "./store.js";

/**
 * Settle every open paper tail on a resolved/void market. Idempotent: only
 * touches tails still 'open'. For 'void' markets the stake is returned (pnl 0,
 * exitOdds null). Returns the number settled.
 */
export async function settlePaperTailsForMarket(
  store: TradingStore,
  market: MarketRow,
): Promise<number> {
  if (market.status !== "resolved" && market.status !== "void") return 0;

  const tails = await store.listOpenPaperTailsByMarket(market.id);
  let settled = 0;

  for (const tail of tails) {
    const contract = market.outcomes.find(
      (o) => o.label === tail.pickedOutcome || o.instrumentSymbol === tail.pickedOutcome,
    );

    let pnl: number;
    let exitOdds: number | null;

    if (market.status === "void") {
      pnl = 0;
      exitOdds = null;
    } else {
      const exitPrice = resolvedExitPrice(tail.side, contract?.resolutionSide ?? null);
      // Market says resolved but this contract has no resolution direction yet (or the tail
      // has no side): we can't price it. Leave it open so a later sync settles it.
      if (exitPrice === null) continue;
      pnl = paperPnlUsdc({ amountUsdc: tail.amountUsdc, entryOdds: tail.entryOdds, exitPrice });
      exitOdds = exitPrice;
    }

    await store.updateTail(tail.tailId, {
      status: "settled",
      pnlUsdc: pnl,
      exitOdds,
      settledAt: new Date(),
    });
    settled += 1;
  }

  return settled;
}
