import { positiveIntOr } from "./env.js";
import type { ScoutStore } from "./store.js";

/**
 * Automatic re-checking of traders that someone is copy trading (SCOUT_AUTO_POLL=true). Off by default.
 *
 * Why: the scout never notices a new tweet by itself, and a pick is only copied when it reaches us within
 * MAX_COPY_PICK_AGE_S (10 minutes) of the tweet. Without this, a scan has to happen inside that window by
 * luck, so a pick found 20 minutes late is never copied. With it, every copied trader is scanned every
 * few minutes, and new picks arrive in time.
 *
 * It is separate from the manual path on purpose. A person opening or rescanning a profile still goes
 * through POST /v1/scout/:handle with its 10-minute (and 1-hour) cache, exactly as before. Each automatic
 * check fetches from X, which costs money, so it is bounded: only traders with an active copy trade, at most
 * `maxHandles` of them, once per interval, and never a trader that has not been scanned before (a first
 * scan reads ~100 posts and stays something a person asks for).
 */

export interface AutoPollSettings {
  enabled: boolean;
  /** Seconds between checks of the same trader. */
  everyS: number;
  /** Most traders checked per round; the rest wait for the next one. */
  maxHandles: number;
}

/** A pick older than 10 minutes is not copied, so checking less often than every 5 would miss some. */
export const AUTO_POLL_MIN_S = 60;
export const AUTO_POLL_MAX_S = 300;

export function autoPollSettings(env: Record<string, string | undefined>): AutoPollSettings {
  const everyS = Math.min(AUTO_POLL_MAX_S, Math.max(AUTO_POLL_MIN_S, positiveIntOr(env.SCOUT_AUTO_POLL_S, 180)));
  return {
    enabled: env.SCOUT_AUTO_POLL?.trim() === "true",
    everyS,
    maxHandles: positiveIntOr(env.SCOUT_AUTO_POLL_MAX_HANDLES, 10),
  };
}

export interface AutoPollDeps {
  store: Pick<ScoutStore, "getHandle" | "tryLock">;
  /** Handles with at least one active copy trade, at most `limit` of them. */
  copiedHandles: (limit: number) => Promise<string[]>;
  /** Same function the HTTP route uses once it holds the lock. */
  startScan: (handle: string, opts: { fetchNew: boolean }) => void;
  maxHandles: number;
  now?: () => Date;
  log?: (msg: string) => void;
}

export interface AutoPollResult {
  started: string[];
  skipped: Array<{ handle: string; reason: "never scanned" | "scan already running" }>;
}

/** One round: scan each copied trader that was scanned before and is not being scanned right now. */
export async function pollCopiedTraders(deps: AutoPollDeps): Promise<AutoPollResult> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const result: AutoPollResult = { started: [], skipped: [] };
  for (const handle of await deps.copiedHandles(deps.maxHandles)) {
    if (!(await deps.store.getHandle(handle))) {
      result.skipped.push({ handle, reason: "never scanned" });
      continue;
    }
    // The same atomic lock as a manual scan: if a person's scan is running, this one does not start.
    if (!(await deps.store.tryLock(handle, now()))) {
      result.skipped.push({ handle, reason: "scan already running" });
      continue;
    }
    deps.startScan(handle, { fetchNew: true });
    result.started.push(handle);
  }
  if (result.started.length > 0 || result.skipped.length > 0) {
    log(`[scout] auto-poll: scanning ${result.started.length} copied trader(s)${result.skipped.length ? `, skipped ${result.skipped.map((s) => `${s.handle} (${s.reason})`).join(", ")}` : ""}`);
  }
  return result;
}
