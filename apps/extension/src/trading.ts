import { CopyTradeConfig, WatchItem } from "@copayme/shared";
import { z } from "zod";

/** How the trading service runs copy trades: "paper" simulates, "live" places real orders. */
export type CopyMode = "paper" | "live";

/** What watching a trader has shown since the user started. */
export interface WatchInfo {
  /** When the user started watching (ISO). */
  since: string;
  /** Paper bets placed on this trader's picks since then, settled or not. */
  picks: number;
  /** Of those, how many have not settled yet. */
  openPicks: number;
  /** Paper P&L in dollars across the settled $1 bets, or null before any has settled. */
  paperPnlUsdc: number | null;
  /** The trader's score when the user started watching, or null if they had none yet. */
  scoreThen: number | null;
}

/** What the popover needs to know about the signed-in user's relationship to one trader. */
export interface TradingState {
  /** False when no user is configured, so trading buttons explain that instead of failing. */
  signedIn: boolean;
  /** Watching this trader, with what has happened since. Null when not watching. */
  watch: WatchInfo | null;
  /** Copying this trader, and for how much per pick. */
  copy: { active: boolean; amountUsdc: number } | null;
  /** How copy trades run, so the confirmation can say truthfully whether real orders are placed. */
  copyMode: CopyMode;
}

/** Signed out, and if anything is unknown the cautious reading: assume copy trades place real orders. */
export const SIGNED_OUT: TradingState = { signedIn: false, watch: null, copy: null, copyMode: "live" };

export interface TradingActions {
  state(handle: string): Promise<TradingState>;
  setWatch(handle: string, on: boolean): Promise<void>;
  startCopy(handle: string, amountUsdc: number): Promise<void>;
  stopCopy(handle: string): Promise<void>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The follower id to trade as, or null when none is configured or it is not a valid id. */
export function validFollowerId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/**
 * Talks to the trading service's watch and copy-trade endpoints as one follower. Without a follower
 * it never makes a request: `state` says signed out and every action refuses. That is the safe
 * default, since copy trading can place real orders.
 */
export function createTradingService(opts: {
  baseUrl: string;
  getFollowerId: () => Promise<string | null>;
  /** The trader's score as of a past moment, for the trend since the user started watching. */
  scoreAt?: (handle: string, atIso: string) => Promise<number | null>;
  fetcher?: typeof fetch;
}): TradingActions {
  const { baseUrl, getFollowerId, scoreAt, fetcher = fetch } = opts;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const followerId = await getFollowerId();
    if (!followerId) throw new Error("Not signed in");
    const res = await fetcher(new URL(path, baseUrl), {
      ...init,
      headers: { "content-type": "application/json", "x-follower-id": followerId, ...init.headers },
    });
    if (!res.ok) {
      const detail = await res.json().then((b: { error?: string }) => b.error, () => undefined);
      throw new Error(detail ?? `trading service answered ${res.status}`);
    }
    return res;
  }

  async function copyMode(): Promise<CopyMode> {
    try {
      const res = await fetcher(new URL("/v1/config", baseUrl));
      const body = z.object({ copyTradeMode: z.enum(["paper", "live"]) }).parse(await res.json());
      return body.copyTradeMode;
    } catch {
      return "live"; // unknown: warn as if real money moves
    }
  }

  const handleOf = (h: string) => h.toLowerCase();

  return {
    async state(handle) {
      if (!(await getFollowerId())) return SIGNED_OUT;
      const [watches, copies, mode] = await Promise.all([
        call("/v1/watches").then(async (r) => z.array(WatchItem).parse(await r.json())),
        call("/v1/copy-trades").then(async (r) => z.array(CopyTradeConfig).parse(await r.json())),
        copyMode(),
      ]);
      const watch = watches.find((w) => handleOf(w.traderHandle) === handleOf(handle));
      const copy = copies.find((c) => handleOf(c.traderHandle) === handleOf(handle));
      const scoreThen = watch && scoreAt ? await scoreAt(handle, watch.watchedAt).catch(() => null) : null;
      return {
        signedIn: true,
        watch: watch
          ? { since: watch.watchedAt, picks: watch.nPicks, openPicks: watch.activePicks, paperPnlUsdc: watch.paperPnlUsdc, scoreThen }
          : null,
        copy: copy ? { active: copy.active, amountUsdc: copy.amountUsdc } : null,
        copyMode: mode,
      };
    },

    async setWatch(handle, on) {
      if (on) await call("/v1/watches", { method: "POST", body: JSON.stringify({ traderHandle: handleOf(handle) }) });
      else await call(`/v1/watches/${encodeURIComponent(handleOf(handle))}`, { method: "DELETE" });
    },

    async startCopy(handle, amountUsdc) {
      await call("/v1/copy-trades", { method: "POST", body: JSON.stringify({ traderHandle: handleOf(handle), amountUsdc }) });
    },

    async stopCopy(handle) {
      await call(`/v1/copy-trades/${encodeURIComponent(handleOf(handle))}`, {
        method: "PATCH",
        body: JSON.stringify({ active: false }),
      });
    },
  };
}

/** For mock mode: a signed-in user whose choices are kept in memory, with sample numbers, so the buttons can be tried without a backend. */
export function createMockTrading(): TradingActions {
  const watching = new Map<string, string>(); // handle -> started
  const copies = new Map<string, { active: boolean; amountUsdc: number }>();
  return {
    state: async (h) => ({
      signedIn: true,
      watch: watching.has(h)
        ? { since: watching.get(h)!, picks: 9, openPicks: 2, paperPnlUsdc: 0.42, scoreThen: 68 }
        : null,
      copy: copies.get(h) ?? null,
      copyMode: "paper",
    }),
    setWatch: async (h, on) => void (on ? watching.set(h, new Date(Date.now() - 3 * 86_400_000).toISOString()) : watching.delete(h)),
    startCopy: async (h, amountUsdc) => void copies.set(h, { active: true, amountUsdc }),
    stopCopy: async (h) => void copies.set(h, { active: false, amountUsdc: copies.get(h)?.amountUsdc ?? 0 }),
  };
}
