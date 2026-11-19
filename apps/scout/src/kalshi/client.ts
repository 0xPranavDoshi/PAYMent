import type { GeminiContract, GeminiEvent } from "../gemini/types.js";
import {
  betKindOf,
  findKalshiEvent,
  findKalshiMarket,
  kalshiDateCode,
  kalshiSeriesFor,
  teamPair,
  type KalshiEvent,
  type KalshiMarket,
} from "./match.js";

/**
 * Kalshi's public market data (no key; https://docs.kalshi.com/openapi.yaml, read Nov 18 2026).
 * Used only to price a Gemini pick when Gemini has no trade history for it: Gemini's sports
 * markets mirror Kalshi's, and Kalshi's are far more liquid.
 *
 * Endpoints: GET /events/{ticker}, GET /events?series_ticker&min_close_ts&cursor (max 200/page),
 * GET /markets?event_ticker (max 1000/page), GET /series/{s}/markets/{t}/candlesticks
 * (period 1 | 60 | 1440 minutes, at most 5,000 periods), and GET /historical/... for markets that
 * settled before GET /historical/cutoff's market_settled_ts. Limits: 20 reads/s per IP; 429 on excess.
 */
export interface KalshiClient {
  /** The Kalshi market mirroring this Gemini contract, or null with the reason. */
  findMarket(
    game: GeminiEvent,
    sub: GeminiEvent,
    contract: GeminiContract,
  ): Promise<{ series: string; market: KalshiMarket } | { series: null; reason: string }>;
  /** The YES fair value at `at`: the bid/ask midpoint (or a trade) from the last candle at or before it. */
  getYesPriceAt(series: string, market: KalshiMarket, at: Date): Promise<number | null>;
}

export const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
/** Wider than this, a quote isn't a usable fair value; fall back to a trade price. */
export const MAX_SPREAD = 0.1;
const LIST_TTL_MS = 5 * 60 * 1000;
const CUTOFF_TTL_MS = 60 * 60 * 1000;
const MAX_EVENT_PAGES = 5;

type Candle = {
  end_period_ts: number;
  yes_bid?: { close_dollars?: string | null } | null;
  yes_ask?: { close_dollars?: string | null } | null;
  price?: { close_dollars?: string | null } | null;
};

const num = (v: string | null | undefined): number | null => {
  const n = v === null || v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The YES fair value from one candle: bid/ask midpoint when the quote is tight, else that period's trade. */
export function candlePrice(c: Candle): number | null {
  const bid = num(c.yes_bid?.close_dollars);
  const ask = num(c.yes_ask?.close_dollars);
  if (bid !== null && ask !== null && bid > 0 && ask < 1 && ask >= bid && ask - bid <= MAX_SPREAD) {
    return Math.round(((bid + ask) / 2) * 10000) / 10000;
  }
  const trade = num(c.price?.close_dollars);
  return trade !== null && trade > 0 && trade < 1 ? trade : null;
}

/** The price of the last candle ending at or before `atSec` that has one. */
export function priceAt(candles: Candle[], atSec: number): number | null {
  const usable = candles
    .filter((c) => c.end_period_ts <= atSec)
    .sort((a, b) => b.end_period_ts - a.end_period_ts);
  for (const c of usable) {
    const p = candlePrice(c);
    if (p !== null) return p;
  }
  return null;
}

export function createKalshiClient(
  opts: { fetch?: typeof fetch; baseUrl?: string; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): KalshiClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? KALSHI_BASE;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cache = new Map<string, { value: unknown; expiresAt: number }>();

  /** JSON for a GET, null on 404 or any failure; one retry with backoff on 429. */
  async function getJson(path: string): Promise<any | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await doFetch(`${base}${path}`, { headers: { accept: "application/json" } });
      } catch {
        return null;
      }
      if (res.status === 429 && attempt < 2) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (!res.ok) return null;
      try {
        return await res.json();
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Lookups in progress, so picks priced in parallel on the same game share one request. */
  const pending = new Map<string, Promise<unknown>>();
  async function cached<T>(key: string, ttlMs: number, load: () => Promise<T | null>): Promise<T | null> {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) return hit.value as T;
    const running = pending.get(key);
    if (running) return running as Promise<T | null>;
    const run = load().then((value) => {
      if (value !== null) cache.set(key, { value, expiresAt: now() + ttlMs });
      return value;
    });
    pending.set(key, run);
    try {
      return await run;
    } finally {
      pending.delete(key);
    }
  }

  /** The event by Gemini's own team codes (they often match Kalshi's), confirmed by its title's teams. */
  async function eventByGuess(series: string, game: GeminiEvent): Promise<KalshiEvent | null> {
    const [, , away, home] = game.ticker.split("-");
    if (!away || !home || !game.startTime) return null;
    const ticker = `${series}-${kalshiDateCode(game.startTime)}${away}${home}`;
    const body = await cached<{ event?: KalshiEvent }>(`event:${ticker}`, LIST_TTL_MS, () => getJson(`/events/${ticker}`));
    const ev = body?.event;
    if (!ev?.title) return null;
    const want = teamPair(game.title);
    const got = teamPair(ev.title);
    return want && got && want[0] === got[0] && want[1] === got[1] ? ev : null;
  }

  /** Events in the series with a market closing after the game started (paged), for local matching. */
  async function eventsAround(series: string, game: GeminiEvent): Promise<KalshiEvent[]> {
    const minClose = Math.floor(Date.parse(game.startTime ?? "") / 1000 / 86400) * 86400; // day bucket: shared cache
    return (
      (await cached<KalshiEvent[]>(`events:${series}:${minClose}`, LIST_TTL_MS, async () => {
        const all: KalshiEvent[] = [];
        let cursor = "";
        for (let page = 0; page < MAX_EVENT_PAGES; page++) {
          const qs = new URLSearchParams({ series_ticker: series, min_close_ts: String(minClose), limit: "200" });
          if (cursor) qs.set("cursor", cursor);
          const body = await getJson(`/events?${qs}`);
          if (!body) return all.length ? all : null;
          all.push(...((body.events ?? []) as KalshiEvent[]));
          cursor = body.cursor ?? "";
          if (!cursor) break;
        }
        return all;
      })) ?? []
    );
  }

  async function marketsOf(eventTicker: string): Promise<KalshiMarket[]> {
    const body = await cached<{ markets?: KalshiMarket[] }>(`markets:${eventTicker}`, LIST_TTL_MS, () =>
      getJson(`/markets?event_ticker=${encodeURIComponent(eventTicker)}&limit=1000`),
    );
    return body?.markets ?? [];
  }

  async function settledCutoffMs(): Promise<number> {
    const body = await cached<{ market_settled_ts?: string }>("cutoff", CUTOFF_TTL_MS, () => getJson("/historical/cutoff"));
    const t = Date.parse(body?.market_settled_ts ?? "");
    return Number.isFinite(t) ? t : 0;
  }

  async function candles(series: string, market: KalshiMarket, startSec: number, endSec: number, period: 1 | 60): Promise<Candle[]> {
    const qs = new URLSearchParams({ start_ts: String(startSec), end_ts: String(endSec), period_interval: String(period) });
    const settledMs = Date.parse(String((market as { settlement_ts?: string }).settlement_ts ?? ""));
    const historical = Number.isFinite(settledMs) && settledMs < (await settledCutoffMs());
    const path = historical
      ? `/historical/markets/${encodeURIComponent(market.ticker)}/candlesticks?${qs}`
      : `/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(market.ticker)}/candlesticks?${qs}`;
    const body = await getJson(path);
    return (body?.candlesticks ?? []) as Candle[];
  }

  return {
    async findMarket(game, sub, contract) {
      const bet = betKindOf(game, sub);
      if (!bet) return { series: null, reason: "bet kind not mirrored on Kalshi" };
      const series = kalshiSeriesFor(game.ticker, bet);
      if (!series) return { series: null, reason: "no Kalshi series for this league/bet" };
      const event = (await eventByGuess(series, game)) ?? findKalshiEvent(await eventsAround(series, game), game);
      if (!event) return { series: null, reason: `no Kalshi ${series} event with the same date and teams` };
      const found = findKalshiMarket(await marketsOf(event.event_ticker), contract, bet);
      if (!found.market) return { series: null, reason: `${event.event_ticker}: ${found.reason}` };
      return { series, market: found.market };
    },

    async getYesPriceAt(series, market, at) {
      const atSec = Math.floor(at.getTime() / 1000);
      // 1-minute candles carry the bid/ask even when nothing trades; candles exist only when quotes change.
      const minute = priceAt(await candles(series, market, atSec - 3600, atSec, 1), atSec);
      if (minute !== null) return minute;
      return priceAt(await candles(series, market, atSec - 6 * 3600, atSec, 60), atSec);
    },
  };
}
