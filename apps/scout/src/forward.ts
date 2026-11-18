import type { NewPost, PickMatch } from "@copayme/shared";
import type { GeminiClient } from "./gemini/client.js";
import type { GeminiEvent } from "./gemini/types.js";
import type { MarketRow, ScoutPostRow, ScoutStore } from "./store.js";

export interface Forwarder {
  /** Returns the tweet ids the ingest API accepted. Never throws. */
  forward(posts: ScoutPostRow[], handle: string): Promise<string[]>;
}

/** Forwarding disabled: nothing is accepted, so nothing is marked forwarded. */
export const noopForwarder: Forwarder = { forward: async () => [] };

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Null when there is no known game start time (no lock time to store). */
function toMarketRow(sub: GeminiEvent, gameStartTime: string | null): MarketRow | null {
  const start = gameStartTime ?? sub.startTime;
  if (!start) return null;
  const winner = sub.contracts.find((c) => c.resolutionSide === "yes");
  return {
    geminiMarketId: sub.id,
    sport: sub.sportsMarket?.sport ?? sub.subcategory?.name ?? "unknown",
    eventName: sub.title,
    outcomes: sub.contracts.map((c) => {
      const prices = c.prices as { buy?: { yes?: string }; bestAsk?: string } | undefined;
      return {
        label: c.label,
        instrumentSymbol: c.instrumentSymbol,
        currentOdds: clamp01(Number(prices?.buy?.yes ?? prices?.bestAsk ?? 0)),
      };
    }),
    lockTime: new Date(start),
    status: sub.status === "settled" ? "resolved" : "open",
    winningOutcome: winner?.label ?? null,
    resolvedAt: winner?.resolvedAt ? new Date(winner.resolvedAt) : null,
  };
}

/**
 * Only win picks (the sub-event is the game itself) are forwardable: spread/total/prop events are
 * ladders where several contracts resolve YES together, but `markets.winning_outcome` holds one label.
 */
const isWinPick = (m: PickMatch): boolean => m.geminiEventTicker !== null && m.geminiEventTicker === m.gameTicker;

/** The label to send as `pickedOutcome`, or null when the pick can't be expressed without a side field. */
function forwardableLabel(m: PickMatch, sub: GeminiEvent): string | null {
  if (!m.contractLabel) return null;
  if (m.side === "yes") return m.contractLabel;
  if (m.side === "no" && sub.contracts.length === 2) {
    return sub.contracts.find((c) => c.label !== m.contractLabel)?.label ?? null;
  }
  return null;
}

export function createForwarder(opts: {
  url: string;
  serviceKey: string;
  store: ScoutStore;
  gemini: GeminiClient;
  fetch?: typeof fetch;
}): Forwarder {
  const doFetch = opts.fetch ?? fetch;
  return {
    async forward(posts) {
      const candidates: { entry: NewPost; market: MarketRow }[] = [];
      for (const post of posts) {
        for (const m of post.matches ?? []) {
          if (m.status !== "matched" || !m.geminiEventTicker || !isWinPick(m)) continue;
          try {
            const sub = await opts.gemini.getEvent(m.geminiEventTicker);
            const pickedOutcome = forwardableLabel(m, sub);
            const market = toMarketRow(sub, m.gameStartTime);
            if (pickedOutcome === null || market === null) continue;
            candidates.push({
              market,
              entry: {
                tweetId: post.tweetId,
                xUserId: post.xUserId,
                xHandle: post.handle,
                tweetedAt: post.tweetedAt.toISOString(),
                tweetText: post.text,
                sentiment: post.sentiment,
                geminiMarketId: sub.id,
                pickedOutcome,
              },
            });
            break;
          } catch {
            // This pick's event can't be loaded; try the post's next pick.
          }
        }
      }

      // A post whose market upsert fails is not sent this round.
      const upserted = new Map<string, boolean>();
      const entries: NewPost[] = [];
      for (const { entry, market } of candidates) {
        let ok = upserted.get(market.geminiMarketId);
        if (ok === undefined) {
          try {
            await opts.store.upsertMarket(market);
            ok = true;
          } catch {
            ok = false;
          }
          upserted.set(market.geminiMarketId, ok);
        }
        if (ok) entries.push(entry);
      }
      if (entries.length === 0) return [];

      try {
        const res = await doFetch(`${opts.url}/v1/posts`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.serviceKey}` },
          body: JSON.stringify({ posts: entries }),
        });
        return res.ok ? entries.map((e) => e.tweetId) : [];
      } catch {
        return [];
      }
    },
  };
}
