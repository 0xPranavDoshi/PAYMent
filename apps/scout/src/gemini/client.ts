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

export type SearchStatus = "active" | "settled" | "under_review";

export interface GeminiClient {
  searchEvents(term: string, status: SearchStatus): Promise<GeminiEvent[]>;
  getEvent(ticker: string): Promise<GeminiEvent>;
}

const ACTIVE_TTL_MS = 5 * 60 * 1000;
/** Settled and under_review search lists can still gain events, so they expire too (just more slowly). */
const SEARCH_TTL_MS: Record<SearchStatus, number> = {
  active: ACTIVE_TTL_MS,
  settled: 10 * 60 * 1000,
  under_review: 10 * 60 * 1000,
};
const MIN_SEARCH_LENGTH = 3;
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

export function createGeminiClient(
  opts: { fetch?: typeof fetch; baseUrl?: string; now?: () => number } = {},
): GeminiClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://api.gemini.com";
  const now = opts.now ?? Date.now;
  // expiresAt === null means cached indefinitely (settled events from getEvent)
  const cache = new Map<string, { value: unknown; expiresAt: number | null }>();

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
    async searchEvents(term, status) {
      const search = term.trim();
      if (search.length < MIN_SEARCH_LENGTH) return [];
      const base = `${baseUrl}/v1/prediction-markets/events?category=Sports&status=${status}&search=${encodeURIComponent(search)}&limit=${PAGE_SIZE}`;
      const hit = cached<GeminiEvent[]>(base);
      if (hit) return hit;
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
      store(base, events, SEARCH_TTL_MS[status]);
      return events;
    },

    async getEvent(ticker) {
      const url = `${baseUrl}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`;
      const hit = cached<GeminiEvent>(url);
      if (hit) return hit;
      const parsed = GeminiEvent.safeParse(await getJson(url));
      if (!parsed.success) throw new GeminiError(`Unexpected Gemini event response for ${url}`);
      store(url, parsed.data, parsed.data.status === "settled" ? null : ACTIVE_TTL_MS);
      return parsed.data;
    },
  };
}
