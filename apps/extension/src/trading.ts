import { CopyTradeConfig, WatchItem } from "@copayme/shared";
import { z } from "zod";

/** How the trading service runs copy trades: "paper" simulates, "live" places real orders. */
export type CopyMode = "paper" | "live";

/** What the popover needs to know about the signed-in user's relationship to one trader. */
export interface TradingState {
  /** False when no user is configured, so trading buttons explain that instead of failing. */
  signedIn: boolean;
  /** On the user's watchlist. How the trader is doing is shown on the website's watchlist page, not here. */
  watching: boolean;
  /** Copying this trader, and for how much per pick. */
  copy: { active: boolean; amountUsdc: number } | null;
  /** How copy trades run, so the confirmation can say truthfully whether real orders are placed. */
  copyMode: CopyMode;
}

/** Signed out, and if anything is unknown the cautious reading: assume copy trades place real orders. */
export const SIGNED_OUT: TradingState = { signedIn: false, watching: false, copy: null, copyMode: "live" };

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
  fetcher?: typeof fetch;
}): TradingActions {
  const { baseUrl, getFollowerId, fetcher = fetch } = opts;

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
      return {
        signedIn: true,
        watching: watch !== undefined,
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

/** For mock mode: a signed-in user whose choices are kept in memory, so the buttons can be tried without a backend. */
export function createMockTrading(): TradingActions {
  const watching = new Set<string>();
  const copies = new Map<string, { active: boolean; amountUsdc: number }>();
  return {
    state: async (h) => ({ signedIn: true, watching: watching.has(h), copy: copies.get(h) ?? null, copyMode: "paper" }),
    setWatch: async (h, on) => void (on ? watching.add(h) : watching.delete(h)),
    startCopy: async (h, amountUsdc) => void copies.set(h, { active: true, amountUsdc }),
    stopCopy: async (h) => void copies.set(h, { active: false, amountUsdc: copies.get(h)?.amountUsdc ?? 0 }),
  };
}
