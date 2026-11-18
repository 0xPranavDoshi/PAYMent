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
  searchEvents(term: string, status: "active" | "settled"): Promise<GeminiEvent[]>;
  getEvent(ticker: string): Promise<GeminiEvent>;
}

const ACTIVE_TTL_MS = 5 * 60 * 1000;
const MIN_SEARCH_LENGTH = 3;

export function createGeminiClient(
  opts: { fetch?: typeof fetch; baseUrl?: string; now?: () => number } = {},
): GeminiClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? "https://api.gemini.com";
  const now = opts.now ?? Date.now;
  // expiresAt === null means cached indefinitely (settled)
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

  function store(url: string, value: unknown, settled: boolean): void {
    cache.set(url, { value, expiresAt: settled ? null : now() + ACTIVE_TTL_MS });
  }

  return {
    async searchEvents(term, status) {
      const search = term.trim();
      if (search.length < MIN_SEARCH_LENGTH) return [];
      const url = `${baseUrl}/v1/prediction-markets/events?category=Sports&status=${status}&search=${encodeURIComponent(search)}&limit=50`;
      const hit = cached<GeminiEvent[]>(url);
      if (hit) return hit;
      const parsed = GeminiEventsResponse.safeParse(await getJson(url));
      if (!parsed.success) throw new GeminiError(`Unexpected Gemini search response for ${url}`);
      store(url, parsed.data.data, status === "settled");
      return parsed.data.data;
    },

    async getEvent(ticker) {
      const url = `${baseUrl}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`;
      const hit = cached<GeminiEvent>(url);
      if (hit) return hit;
      const parsed = GeminiEvent.safeParse(await getJson(url));
      if (!parsed.success) throw new GeminiError(`Unexpected Gemini event response for ${url}`);
      store(url, parsed.data, parsed.data.status === "settled");
      return parsed.data;
    },
  };
}
