import { toMarketRow } from "./forward.js";
import type { GeminiClient } from "./gemini/client.js";
import type { ScoutStore } from "./store.js";

/** Markets refreshed per run (each is one Gemini lookup). */
export const REFRESH_BATCH = 100;

/**
 * Writes the latest Gemini state of the markets behind forwarded picks whose games have started,
 * so the scoring worker can settle them. The trading sync only keeps recent game-winner markets
 * current; spread, total and prop markets (and older games) would otherwise keep an empty
 * `resolutionSide` forever. Never throws: one bad market doesn't stop the rest.
 */
export async function refreshMarkets(deps: {
  store: ScoutStore;
  gemini: GeminiClient;
  now?: () => Date;
  log?: (msg: string) => void;
}): Promise<{ checked: number; settled: number; failed: number }> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  let todo;
  try {
    todo = await deps.store.marketsToRefresh(now(), REFRESH_BATCH);
  } catch (err) {
    log(`[scout] market refresh: couldn't list markets: ${(err as Error).message}`);
    return { checked: 0, settled: 0, failed: 0 };
  }

  let settled = 0;
  let failed = 0;
  for (const { geminiEventTicker, gameStartTime } of todo) {
    try {
      const sub = await deps.gemini.getEvent(geminiEventTicker);
      const row = toMarketRow(sub, gameStartTime);
      if (!row) continue;
      await deps.store.upsertMarket(row);
      if (row.status !== "open") settled++;
    } catch (err) {
      failed++;
      log(`[scout] market refresh failed for ${geminiEventTicker}: ${(err as Error).message}`);
    }
  }
  if (todo.length > 0) log(`[scout] market refresh: checked ${todo.length}, settled ${settled}, failed ${failed}`);
  return { checked: todo.length, settled, failed };
}
