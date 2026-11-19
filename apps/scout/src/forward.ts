import { IngestResponse, MAX_POSTS_PER_REQUEST, type NewPost, type Pick, type PickMatch } from "@copayme/shared";
import type { GeminiClient } from "./gemini/client.js";
import type { GeminiEvent } from "./gemini/types.js";
import type { MarketRow, ScoutPostRow, ScoutStore } from "./store.js";

export interface Forwarder {
  /** Returns the tweet ids the ingest API stored. Never throws. */
  forward(posts: ScoutPostRow[], handle: string): Promise<string[]>;
}

/** Forwarding disabled: nothing is accepted, so nothing is marked forwarded. */
export const noopForwarder: Forwarder = { forward: async () => [] };

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const priceOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? null : clamp01(n);
};

/**
 * The `markets` row for a matched event, keyed by its ticker (what ingest looks up). Null when there
 * is no known game start time, so no lock time to store.
 */
export function toMarketRow(sub: GeminiEvent, gameStartTime: string | null): MarketRow | null {
  const start = gameStartTime ?? sub.startTime;
  if (!start) return null;
  const winner = sub.contracts.find((c) => c.resolutionSide === "yes");
  return {
    geminiMarketId: sub.ticker,
    sport: sub.sportsMarket?.sport ?? sub.subcategory?.name ?? "unknown",
    eventName: sub.title,
    outcomes: sub.contracts.map((c) => {
      const prices = c.prices as { buy?: { yes?: string; no?: string }; bestAsk?: string } | undefined;
      return {
        label: c.label,
        instrumentSymbol: c.instrumentSymbol,
        currentOdds: priceOrNull(prices?.buy?.yes ?? prices?.bestAsk) ?? 0,
        noOdds: priceOrNull(prices?.buy?.no),
        // Ladders (spreads, totals, props) resolve several contracts YES at once; ingest settles per contract.
        resolutionSide: c.resolutionSide ?? null,
      };
    }),
    lockTime: new Date(start),
    status: sub.status === "settled" ? "resolved" : "open",
    winningOutcome: winner?.label ?? null,
    resolvedAt: winner?.resolvedAt ? new Date(winner.resolvedAt) : null,
  };
}

function toPick(m: PickMatch, sub: GeminiEvent): Pick | null {
  if (!m.instrumentSymbol || !m.side || !m.gameStartTime) return null;
  const contract = sub.contracts.find((c) => c.instrumentSymbol === m.instrumentSymbol);
  if (!contract) return null;
  return {
    geminiEventTicker: sub.ticker,
    instrumentSymbol: m.instrumentSymbol,
    side: m.side,
    gameStartTime: m.gameStartTime,
    resolutionSide: contract.resolutionSide ?? null,
    resolvedAt: contract.resolvedAt ?? null,
    // Gemini has no reliable contract price history; ingest prices the pick itself.
    oddsAtTweet: null,
  };
}

export function createForwarder(opts: {
  url: string;
  serviceKey: string;
  store: ScoutStore;
  gemini: GeminiClient;
  fetch?: typeof fetch;
  log?: (msg: string) => void;
}): Forwarder {
  const doFetch = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});

  /** Upserts each market once per call; false when the upsert failed (its picks are held back). */
  const upserted = new Map<string, boolean>();
  async function ensureMarket(row: MarketRow): Promise<boolean> {
    const known = upserted.get(row.geminiMarketId);
    if (known !== undefined) return known;
    let ok = true;
    try {
      await opts.store.upsertMarket(row);
    } catch (err) {
      ok = false;
      log(`[scout] market upsert failed for ${row.geminiMarketId}: ${(err as Error).message}`);
    }
    upserted.set(row.geminiMarketId, ok);
    return ok;
  }

  async function send(batch: NewPost[]): Promise<string[]> {
    try {
      const res = await doFetch(`${opts.url}/v1/posts`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-service-key": opts.serviceKey },
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        log(`[scout] ingest returned HTTP ${res.status}`);
        return [];
      }
      const parsed = IngestResponse.safeParse(await res.json());
      if (!parsed.success) {
        log("[scout] ingest returned an unexpected body");
        return [];
      }
      // A post with `error` wasn't stored; it stays unforwarded and is retried next scan.
      return parsed.data.results.filter((r) => !r.error).map((r) => r.tweetId);
    } catch (err) {
      log(`[scout] ingest request failed: ${(err as Error).name}`);
      return [];
    }
  }

  return {
    async forward(posts) {
      upserted.clear();
      const entries: NewPost[] = [];
      for (const post of posts) {
        const picks: Pick[] = [];
        for (const m of post.matches ?? []) {
          if (m.status !== "matched" || !m.geminiEventTicker) continue;
          try {
            const sub = await opts.gemini.getEvent(m.geminiEventTicker);
            const pick = toPick(m, sub);
            const market = toMarketRow(sub, m.gameStartTime);
            if (pick && market && (await ensureMarket(market))) picks.push(pick);
          } catch (err) {
            // This pick's event can't be loaded; the post's other picks still go.
            log(`[scout] skipping pick on ${m.geminiEventTicker}: ${(err as Error).message}`);
          }
        }
        if (picks.length === 0) continue;
        entries.push({
          tweetId: post.tweetId,
          xUserId: post.xUserId,
          xHandle: post.handle,
          tweetedAt: post.tweetedAt.toISOString(),
          tweetText: post.text,
          sentiment: post.sentiment,
          picks,
        });
      }

      const accepted: string[] = [];
      for (let i = 0; i < entries.length; i += MAX_POSTS_PER_REQUEST) {
        accepted.push(...(await send(entries.slice(i, i + MAX_POSTS_PER_REQUEST))));
      }
      return accepted;
    },
  };
}
