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

function toMarketRow(sub: GeminiEvent, gameStartTime: string | null): MarketRow {
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
    lockTime: new Date(gameStartTime ?? sub.startTime ?? 0),
    status: sub.status === "settled" ? "resolved" : "open",
    winningOutcome: winner?.label ?? null,
    resolvedAt: winner?.resolvedAt ? new Date(winner.resolvedAt) : null,
  };
}

/** The label to send as `pickedOutcome`, or null when the pick can't be expressed without a side field. */
function forwardableLabel(m: PickMatch, sub: GeminiEvent): string | null {
  if (!m.contractLabel) return null;
  if (m.side === "yes") return m.contractLabel;
  if (m.side === "no" && m.geminiEventTicker === m.gameTicker && sub.contracts.length === 2) {
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
      try {
        const entries: NewPost[] = [];
        const markets = new Map<string, MarketRow>();
        for (const post of posts) {
          for (const m of post.matches ?? []) {
            if (m.status !== "matched" || !m.geminiEventTicker) continue;
            const sub = await opts.gemini.getEvent(m.geminiEventTicker);
            const pickedOutcome = forwardableLabel(m, sub);
            if (pickedOutcome === null) continue;
            markets.set(sub.id, toMarketRow(sub, m.gameStartTime));
            entries.push({
              tweetId: post.tweetId,
              xUserId: post.xUserId,
              xHandle: post.handle,
              tweetedAt: post.tweetedAt.toISOString(),
              tweetText: post.text,
              sentiment: post.sentiment,
              geminiMarketId: sub.id,
              pickedOutcome,
            });
            break;
          }
        }
        if (entries.length === 0) return [];
        for (const row of markets.values()) await opts.store.upsertMarket(row);
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
