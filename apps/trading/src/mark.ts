import type { GeminiClient } from "./gemini.js";
import { sidePriceFromEvent } from "./gemini.js";

/**
 * The current price of the bought side, fetched live from Gemini. Returns null on any
 * failure (network, missing contract, unusable price) so the caller can fall back to the
 * last synced price. `match` finds the contract by instrument symbol or, failing that, label.
 */
export async function liveMarkPrice(
  gemini: GeminiClient,
  ticker: string,
  match: { instrumentSymbol?: string | null; label?: string | null },
  side: "yes" | "no" | null,
): Promise<number | null> {
  try {
    const event = await gemini.getEvent(ticker);
    return sidePriceFromEvent(event, match, side);
  } catch {
    return null;
  }
}
