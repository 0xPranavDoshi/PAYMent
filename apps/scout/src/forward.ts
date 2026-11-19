import { IngestResponse, MAX_POSTS_PER_REQUEST, type NewPost, type Pick, type PickMatch } from "@copayme/shared";
import type { GeminiClient } from "./gemini/client.js";
import type { GeminiContract, GeminiEvent } from "./gemini/types.js";
import type { KalshiClient } from "./kalshi/client.js";
import type { MarketRow, ScoutPostRow, ScoutStore } from "./store.js";

export interface Forwarder {
  /** Returns the tweet ids the ingest API stored. Never throws. */
  forward(posts: ScoutPostRow[], handle: string): Promise<string[]>;
}

/** Forwarding disabled: nothing is accepted, so nothing is marked forwarded. */
export const noopForwarder: Forwarder = { forward: async () => [] };

/** Asking the scoring API to run its worker after forwarding: tries while it answers 409 (busy), and the wait between. */
const WORKER_RUN_ATTEMPTS = 4;
const WORKER_BUSY_WAIT_MS = 2_000;
const WORKER_RUN_TIMEOUT_MS = 30_000;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const priceOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? null : clamp01(n);
};

/**
 * The `markets` row for a matched event, keyed by its ticker (what ingest looks up).
 * lock_time is the market's expiryDate, the same value Yash's sync writes (team decision, Nov 18
 * 2026), falling back to the game start. Null when neither is known.
 */
export function toMarketRow(sub: GeminiEvent, gameStartTime: string | null): MarketRow | null {
  const start = sub.expiryDate ?? gameStartTime ?? sub.startTime;
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
    status: sub.status === "settled" ? "resolved" : sub.status === "invalid" ? "void" : "open",
    winningOutcome: winner?.label ?? null,
    resolvedAt: winner?.resolvedAt ? new Date(winner.resolvedAt) : null,
  };
}

export type PriceSource = "gemini" | "kalshi";

/**
 * The YES price of the picked contract when the tweet was sent: Gemini's own candles first (the
 * venue picks are tailed on), else the Kalshi market Gemini mirrors (same game, same strike,
 * agreeing result) when Gemini hasn't traded it. Null when neither has a price; ingest then stores
 * the pick unpriced, and it doesn't count toward the score.
 */
export async function yesPriceAtTweet(
  m: PickMatch,
  sub: GeminiEvent,
  contract: GeminiContract,
  tweetedAt: Date,
  deps: { gemini: GeminiClient; kalshi?: KalshiClient; log: (msg: string) => void },
): Promise<{ yes: number; source: PriceSource; ref: string } | null> {
  const symbol = contract.instrumentSymbol;
  try {
    const yes = await deps.gemini.getYesPriceAt(symbol, tweetedAt);
    if (yes !== null) return { yes, source: "gemini", ref: symbol };
  } catch {
    // fall through to Kalshi
  }
  if (!deps.kalshi || !m.gameTicker) return null;
  try {
    const game = m.gameTicker === sub.ticker ? sub : await deps.gemini.getEvent(m.gameTicker);
    const found = await deps.kalshi.findMarket(game, sub, contract);
    if (found.series === null) {
      deps.log(`[scout] no Kalshi price for ${symbol}: ${found.reason}`);
      return null;
    }
    const yes = await deps.kalshi.getYesPriceAt(found.series, found.market, tweetedAt);
    if (yes === null) {
      deps.log(`[scout] no Kalshi price for ${symbol}: ${found.market.ticker} had no quote at the tweet`);
      return null;
    }
    return { yes, source: "kalshi", ref: found.market.ticker };
  } catch (err) {
    deps.log(`[scout] Kalshi lookup failed for ${symbol}: ${(err as Error).message}`);
    return null;
  }
}

/**
 * The pick for ingest, priced at the tweet's time. Without that price ingest stores the pick but
 * can't score it (points = won - price), so backfilled picks would never count.
 */
async function toPick(
  m: PickMatch,
  sub: GeminiEvent,
  tweetedAt: Date,
  deps: { gemini: GeminiClient; kalshi?: KalshiClient; log: (msg: string) => void },
): Promise<Pick | null> {
  if (!m.instrumentSymbol || !m.side || !m.gameStartTime) return null;
  const contract = sub.contracts.find((c) => c.instrumentSymbol === m.instrumentSymbol);
  if (!contract) return null;
  let oddsAtTweet: number | null = null;
  const priced = await yesPriceAtTweet(m, sub, contract, tweetedAt, deps);
  if (priced) {
    oddsAtTweet = Math.round((m.side === "yes" ? priced.yes : 1 - priced.yes) * 10000) / 10000;
    deps.log(`[scout] priced ${m.instrumentSymbol} ${m.side} at ${oddsAtTweet} via ${priced.source} (${priced.ref})`);
  }
  return {
    geminiEventTicker: sub.ticker,
    instrumentSymbol: m.instrumentSymbol,
    side: m.side,
    gameStartTime: m.gameStartTime,
    resolutionSide: contract.resolutionSide ?? null,
    resolvedAt: contract.resolvedAt ?? null,
    oddsAtTweet,
  };
}

export function createForwarder(opts: {
  url: string;
  serviceKey: string;
  store: ScoutStore;
  gemini: GeminiClient;
  /** Prices picks Gemini has no trade history for, from the Kalshi market Gemini mirrors. */
  kalshi?: KalshiClient;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}): Forwarder {
  const doFetch = opts.fetch ?? fetch;
  const log = opts.log ?? (() => {});
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

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
            const pick = await toPick(m, sub, post.tweetedAt, { gemini: opts.gemini, kalshi: opts.kalshi, log });
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
      // Score the new picks now rather than on the worker's next timer, so the badge the extension
      // fetches when the scan ends already has the score (it would otherwise cache "no data" for 30 min).
      if (accepted.length > 0) await runScoring();
      return accepted;
    },
  };

  /**
   * Asks the scoring API to run its worker now (POST /v1/worker/run). A 409 means a run is already in
   * progress that may have started before our picks arrived, so wait and ask again. Never throws:
   * if this fails, the picks are still scored on the worker's normal schedule.
   */
  async function runScoring(): Promise<void> {
    for (let attempt = 0; attempt < WORKER_RUN_ATTEMPTS; attempt++) {
      try {
        const res = await doFetch(`${opts.url}/v1/worker/run`, {
          method: "POST",
          headers: { "x-service-key": opts.serviceKey },
          signal: AbortSignal.timeout(WORKER_RUN_TIMEOUT_MS),
        });
        if (res.status === 409) {
          await sleep(WORKER_BUSY_WAIT_MS);
          continue;
        }
        if (!res.ok) {
          log(`[scout] scoring run returned HTTP ${res.status}; picks will be scored on the worker's schedule`);
          return;
        }
        const summary = (await res.json().catch(() => null)) as { settled?: number; usersUpdated?: number } | null;
        log(`[scout] scoring run: settled ${summary?.settled ?? "?"}, users updated ${summary?.usersUpdated ?? "?"}`);
        return;
      } catch (err) {
        log(`[scout] scoring run failed (${(err as Error).name}); picks will be scored on the worker's schedule`);
        return;
      }
    }
    log("[scout] scoring worker stayed busy; picks will be scored on its next run");
  }
}
