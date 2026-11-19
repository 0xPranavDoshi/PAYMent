import type { GeminiClient, GeminiEvent } from "./gemini.js";
import { contractToOutcome } from "./gemini.js";
import type { TradingStore } from "./store.js";

const SPORTS = [
  "american_football",
  "basketball",
  "baseball",
  "soccer",
  "hockey",
];

function geminiStatusToLocal(
  event: GeminiEvent,
): "open" | "locked" | "resolved" | "void" {
  if (event.status === "settled") return "resolved";
  if (event.status === "invalid") return "void";
  if (event.status === "closed") return "locked";
  return "open";
}

function lockTimeFor(event: GeminiEvent): Date {
  // Team decision (Nov 18 2026): lock at the market's expiry, the same value the scout writes.
  // effectiveDate is NOT game start: it equals createdAt (when the market was listed, ~2-3 days
  // before the game), so locking on it rejected nearly every real pick as after_lock.
  // Note: with expiryDate, picks tweeted during or shortly after a game pass ingest's lock check.
  if (event.expiryDate) return new Date(event.expiryDate);
  if (event.resolvedAt) return new Date(event.resolvedAt);
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

function winningOutcomeFor(event: GeminiEvent): string | null {
  for (const c of event.contracts) {
    if (c.resolutionSide === "yes") return c.label;
  }
  return null;
}

/** Pull open and recently settled sports events from Gemini and upsert them. */
export async function syncMarkets(
  gemini: GeminiClient,
  store: TradingStore,
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];

  for (const sport of SPORTS) {
    // Fetch active and settled separately — unfiltered listing returns only active
    for (const qStatus of ["active", "settled"] as const) {
      let events: GeminiEvent[] = [];
      try {
        events = await gemini.listSportsEvents({ sport, limit: 200, status: qStatus });
      } catch (err) {
        errors.push(`listSportsEvents(${sport}, ${qStatus}): ${String(err)}`);
        continue;
      }

      for (const event of events) {
        try {
          await store.upsertMarket({
            geminiMarketId: event.ticker,
            sport: event.sportsMarket?.sport ?? sport,
            eventName: event.title,
            outcomes: event.contracts.map(contractToOutcome),
            lockTime: lockTimeFor(event),
            status: geminiStatusToLocal(event),
            winningOutcome: winningOutcomeFor(event),
          });
          upserted++;
        } catch (err) {
          errors.push(`upsertMarket(${event.ticker}): ${String(err)}`);
        }
      }
    }
  }

  return { upserted, errors };
}
