import { ScoutResponse, type Badge } from "@copayme/shared";

/** The scout serves a scan from cache for 10 minutes, so asking again sooner is pointless. */
export const RESCAN_AFTER_MS = 10 * 60_000;
/** How often to check a running scan, and for how long, before giving up for now. */
export const POLL_EVERY_MS = 3_000;
export const POLL_FOR_MS = 90_000;

export type ScanOutcome =
  /** The scan finished; `badge` is the handle's fresh badge (null: still no score). */
  | { status: "done"; badge: Badge | null }
  /** Scanned recently; nothing was asked. */
  | { status: "skipped" }
  | { status: "failed" | "timeout"; error?: string };

/**
 * Runs in the background worker: asks the scout to scan a handle when someone opens its profile,
 * waits for the scan, then fetches the handle's fresh badge from the scoring API.
 */
export function createScanService(opts: {
  scoutUrl: string;
  /** Fetches the handle's badge from the scoring API, bypassing (and refreshing) the badge cache. */
  refreshBadge: (handle: string) => Promise<Badge | null>;
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const fetcher = opts.fetcher ?? fetch;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const lastAsked = new Map<string, number>();
  /** One scan per handle at a time, shared by every tab that asks. */
  const inFlight = new Map<string, Promise<ScanOutcome>>();

  const url = (handle: string, newestTweetId: string | null = null) => {
    const u = new URL(`/v1/scout/${encodeURIComponent(handle)}`, opts.scoutUrl);
    // The scout skips fetching from X (which costs) when it already has this tweet.
    if (newestTweetId) u.searchParams.set("newest", newestTweetId);
    return u;
  };

  async function read(res: Response): Promise<ScoutResponse> {
    if (!res.ok) throw new Error(`scout returned ${res.status}`);
    return ScoutResponse.parse(await res.json());
  }

  async function run(handle: string, newestTweetId: string | null): Promise<ScanOutcome> {
    try {
      let state = await read(await fetcher(url(handle, newestTweetId), { method: "POST" }));
      const deadline = now() + POLL_FOR_MS;
      while (state.status === "running") {
        if (now() >= deadline) return { status: "timeout" };
        await sleep(POLL_EVERY_MS);
        state = await read(await fetcher(url(handle)));
      }
      if (state.status === "failed") return { status: "failed", error: "scan failed" };
      return { status: "done", badge: await opts.refreshBadge(handle) };
    } catch (err) {
      return { status: "failed", error: String(err) };
    }
  }

  return {
    /** `newestTweetId`: the newest tweet by the handle shown on its profile, or null if none showed. */
    scan(handle: string, newestTweetId: string | null = null): Promise<ScanOutcome> {
      const pending = inFlight.get(handle);
      if (pending) return pending;
      const last = lastAsked.get(handle);
      if (last !== undefined && now() - last < RESCAN_AFTER_MS) return Promise.resolve({ status: "skipped" });
      lastAsked.set(handle, now());
      const job = run(handle, newestTweetId).finally(() => inFlight.delete(handle));
      inFlight.set(handle, job);
      return job;
    },
  };
}

export type ScanService = ReturnType<typeof createScanService>;
