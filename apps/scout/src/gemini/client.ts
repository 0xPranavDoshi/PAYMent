import { GeminiEvent, GeminiEventsResponse } from "./types.js";

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export interface GeminiClient {
  /**
   * Full-game moneyline events (one per game) whose title or ticker contains `term`, across every
   * status a matchable game can have. `search` also matches tickers (undocumented, verified Nov 18
   * 2026), so `NBA-261118` returns that day's NBA games and `-LAL-` returns one team's games.
   */
  searchGames(term: string, opts?: { sport?: string }): Promise<GeminiEvent[]>;
  getEvent(ticker: string): Promise<GeminiEvent>;
  /**
   * The contract's YES price (0-1) at `at`, from Gemini's candles: the close of the last candle
   * starting at or before `at` (5-minute candles, else hourly). Null when there's no candle within
   * PRICE_MAX_AGE_MS before `at` (history reaches back about two days, and some contracts never trade).
   */
  getYesPriceAt(instrumentSymbol: string, at: Date): Promise<number | null>;
}

/** A candle older than this before the tweet is too stale to price the pick. */
export const PRICE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CANDLE_INTERVALS = ["5m", "1hr"] as const;
/** Candles for a contract are fetched once per this window (one forward pass looks up many picks). */
const CANDLE_TTL_MS = 5 * 60 * 1000;

/** Statuses a matchable game can be in: listed but not trading, trading, awaiting result, settled. */
export const GAME_STATUSES = ["approved", "active", "under_review", "settled"] as const;
const ACTIVE_TTL_MS = 5 * 60 * 1000;
/** Search lists gain games and change status, so they expire. */
const SEARCH_TTL_MS = 5 * 60 * 1000;
const MIN_SEARCH_LENGTH = 3;
/** Gemini's maximum page size. */
const PAGE_SIZE = 500;
/** How long one Gemini request may take before it counts as failed. */
export const GEMINI_TIMEOUT_MS = 20_000;
/** Backstop only: game-only searches are far smaller than one page. */
const MAX_PAGES = 4;

export function createGeminiClient(
  opts: { fetch?: typeof fetch; baseUrl?: string; now?: () => number; timeoutMs?: number } = {},
): GeminiClient {
  // Every request has a time limit: one that never answers would otherwise hang the whole scan, which
  // then stays "running" with nothing saved (seen Nov 19 on @covers, cause unconfirmed).
  const timeoutMs = opts.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const doFetch = (url: string, init: RequestInit) => (opts.fetch ?? fetch)(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const baseUrl = opts.baseUrl ?? "https://api.gemini.com";
  const now = opts.now ?? Date.now;
  // expiresAt === null means cached indefinitely (settled events from getEvent)
  const cache = new Map<string, { value: unknown; expiresAt: number | null }>();
  /** Identical searches in flight at the same time share one request. */
  const inFlight = new Map<string, Promise<GeminiEvent[]>>();

  async function getJson(url: string): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(url, { headers: { accept: "application/json" } });
    } catch (err) {
      throw new GeminiError(`Gemini request failed: ${(err as Error).message}`);
    }
    if (!res.ok) throw new GeminiError(`Gemini returned ${res.status} for ${url}`, res.status);
    try {
      return await res.json();
    } catch {
      throw new GeminiError(`Gemini returned an unparseable body for ${url}`, res.status);
    }
  }

  function cached<T>(url: string): T | undefined {
    const hit = cache.get(url);
    if (!hit) return undefined;
    if (hit.expiresAt !== null && hit.expiresAt <= now()) {
      cache.delete(url);
      return undefined;
    }
    return hit.value as T;
  }

  /** ttlMs === null caches indefinitely. */
  function store(key: string, value: unknown, ttlMs: number | null): void {
    cache.set(key, { value, expiresAt: ttlMs === null ? null : now() + ttlMs });
  }

  return {
    async searchGames(term, opts = {}) {
      const search = term.trim();
      if (search.length < MIN_SEARCH_LENGTH) return [];
      const params = new URLSearchParams({ category: "Sports", search, limit: String(PAGE_SIZE) });
      for (const status of GAME_STATUSES) params.append("status", status);
      params.append("sports_market_type", "moneyline");
      params.append("sports_market_scope", "full_contest");
      if (opts.sport) params.append("sport", opts.sport);
      const base = `${baseUrl}/v1/prediction-markets/events?${params.toString()}`;
      const hit = cached<GeminiEvent[]>(base);
      if (hit) return hit;
      const pending = inFlight.get(base);
      if (pending) return pending;

      const run = (async () => {
        const events: GeminiEvent[] = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const offset = page * PAGE_SIZE;
          const url = `${base}&offset=${offset}`;
          const parsed = GeminiEventsResponse.safeParse(await getJson(url));
          if (!parsed.success) throw new GeminiError(`Unexpected Gemini search response for ${url}`);
          const { data, pagination } = parsed.data;
          events.push(...data);
          // No pagination block: treat the page as the whole result.
          if (data.length === 0 || offset + data.length >= (pagination?.total ?? 0)) break;
        }
        store(base, events, SEARCH_TTL_MS);
        return events;
      })();
      inFlight.set(base, run);
      try {
        return await run;
      } finally {
        inFlight.delete(base);
      }
    },

    async getEvent(ticker) {
      const url = `${baseUrl}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`;
      const hit = cached<GeminiEvent>(url);
      if (hit) return hit;
      const parsed = GeminiEvent.safeParse(await getJson(url));
      if (!parsed.success) throw new GeminiError(`Unexpected Gemini event response for ${url}`);
      // Gemini sometimes returns a game without its child markets. Don't cache that (and never
      // forever), so the next lookup can get the full game.
      const incompleteGame = parsed.data.template === "sports-game" && !(parsed.data.events?.length);
      if (!incompleteGame) store(url, parsed.data, parsed.data.status === "settled" ? null : ACTIVE_TTL_MS);
      return parsed.data;
    },

    async getYesPriceAt(instrumentSymbol, at) {
      const t = at.getTime();
      for (const interval of CANDLE_INTERVALS) {
        const url = `${baseUrl}/v2/candles/${encodeURIComponent(instrumentSymbol)}/${interval}`;
        let rows = cached<number[][]>(url);
        if (!rows) {
          // No candles is an answer ({"result":"error","reason":"NoDataFound"}), not a failure.
          let body: unknown = null;
          try {
            const res = await doFetch(url, { headers: { accept: "application/json" } });
            body = await res.json();
          } catch {
            body = null;
          }
          rows = Array.isArray(body) ? (body as number[][]).filter((r) => Array.isArray(r) && r.length >= 5) : [];
          store(url, rows, CANDLE_TTL_MS);
        }
        // Rows are [startMs, open, high, low, close, volume]; take the last candle starting at or before `at`.
        let best: number[] | null = null;
        for (const r of rows) {
          const start = Number(r[0]);
          if (start <= t && (!best || start > Number(best[0]))) best = r;
        }
        if (best && t - Number(best[0]) <= PRICE_MAX_AGE_MS) {
          const close = Number(best[4]);
          if (Number.isFinite(close) && close > 0 && close < 1) return close;
        }
      }
      return null;
    },
  };
}
