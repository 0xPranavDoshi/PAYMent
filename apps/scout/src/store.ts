import { countsAsPrediction, type OutcomeInfo, type PickMatch, type ScoutStatus, type Sentiment } from "@copayme/shared";
import { NO_LINE_REASON, checksBothCollegeSports } from "./match/match.js";

/**
 * Bump when the read prompt or matching changes; rows from older versions are re-read and re-matched.
 * 2: sign decides spread direction; league codes; league+day game search (Nov 18 2026).
 * 3: lineAsWritten + code-side sign rule; team_total; temperature 0; batches of 5 (Nov 18 2026).
 * 4: opponent is a hint (parlay legs); contracts matched by the game title's short names; Nov 18 2026.
 * 5: golf (Nov 20 2026). Only version-4 posts that look like golf and were read as no prediction are
 *    read again (see needsReread): the rest of a version-4 reading is still current.
 */
export const PIPELINE_VERSION = 5;

/** Words and emoji of a golf post. A version-4 post with one, read as no prediction, is read again. */
const GOLF_CUE =
  /⛳|🏌|\b(golf|pga|lpga|liv golf|dp world|masters|ryder cup|open championship|us open|make the cut|missed the cut|top 10 finish|rsm classic)\b/i;

/** True when the post is read again with Grok (and matched again), rather than only re-matched. */
export function needsReread(row: Pick<ScoutPostRow, "sentiment" | "pipelineVersion" | "text" | "quotedText">): boolean {
  if (row.pipelineVersion < 4) return true;
  if (row.pipelineVersion >= PIPELINE_VERSION || row.sentiment === null) return false;
  return !countsAsPrediction(row.sentiment) && GOLF_CUE.test(`${row.text} ${row.quotedText ?? ""}`);
}

/** A `running` lock older than this may be taken over. */
export const STALE_LOCK_MS = 5 * 60_000;

export interface ScoutHandleRow {
  handle: string;
  xUserId: string | null;
  status: ScoutStatus;
  newestTweetId: string | null;
  scannedAt: Date | null;
  lockedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface ScoutPostRow {
  tweetId: string;
  handle: string;
  xUserId: string;
  tweetedAt: Date;
  text: string;
  isReply: boolean;
  quotedText: string | null;
  sentiment: Sentiment | null;
  /** null means matching is not done yet, retry. */
  matches: PickMatch[] | null;
  pipelineVersion: number;
  forwardedAt: Date | null;
}

export interface MarketRow {
  geminiMarketId: string;
  sport: string;
  eventName: string;
  outcomes: OutcomeInfo[];
  lockTime: Date;
  status: "open" | "resolved" | "void";
  winningOutcome: string | null;
  resolvedAt: Date | null;
}

/** A market behind a forwarded pick that still needs its result written to `markets`. */
export interface MarketToRefresh {
  geminiEventTicker: string;
  gameStartTime: string;
}

export interface ScoutStore {
  getHandle(handle: string): Promise<ScoutHandleRow | null>;
  /** Creates the row when missing. Atomic: true only when the caller now holds the lock. */
  tryLock(handle: string, now: Date): Promise<boolean>;
  finishScan(
    handle: string,
    /**
     * `fetched: false` (a scan that skipped X because nothing new was posted) leaves scannedAt alone:
     * scannedAt is when posts were last fetched from X.
     */
    result: { newestTweetId: string | null; xUserId: string | null; now: Date; fetched?: boolean },
  ): Promise<void>;
  failScan(handle: string, error: string): Promise<void>;
  countNewHandlesSince(since: Date): Promise<number>;
  existingTweetIds(ids: string[]): Promise<Set<string>>;
  upsertPosts(rows: ScoutPostRow[]): Promise<void>;
  /** Newest first. */
  listPosts(handle: string): Promise<ScoutPostRow[]>;
  /** Unread posts, counted predictions whose matching is not done, and rows from an older pipeline version. */
  pendingPosts(handle: string): Promise<ScoutPostRow[]>;
  unforwardedPosts(handle: string): Promise<ScoutPostRow[]>;
  markForwarded(ids: string[], at: Date): Promise<void>;
  upsertMarket(row: MarketRow): Promise<void>;
  /**
   * Distinct event tickers of forwarded, matched picks whose game has started (gameStartTime <= now)
   * and whose `markets` row isn't settled yet (missing, open or locked). The trading sync only keeps
   * recent game-winner markets current, so these would otherwise never get a result.
   */
  marketsToRefresh(now: Date, limit: number): Promise<MarketToRefresh[]>;
}

/**
 * Match reasons that older code gave and the current rules no longer would: a post with one is matched
 * again on its next scan (free: no Grok, no X). "tweet during game" was the rule that live picks didn't
 * count, replaced on Nov 19 by "live picks count until settlement". A plain "no contract at the tweet's
 * line" on a college pick that doesn't name its sport predates checking both college sports (Nov 20);
 * the current code says so in a different reason, so each such post is matched again only once.
 */
export const OBSOLETE_MATCH_REASONS = ["tweet during game", NO_LINE_REASON] as const;

type ObsoleteCheck = Pick<ScoutPostRow, "matches" | "sentiment" | "text" | "quotedText">;

export function hasObsoleteMatch(row: ObsoleteCheck): boolean {
  return (row.matches ?? []).some((m) => {
    if (m.reason === "tweet during game") return true;
    if (m.reason !== NO_LINE_REASON) return false;
    const p = row.sentiment?.predictions[m.predictionIndex];
    return p !== undefined && checksBothCollegeSports(p, `${row.text} ${row.quotedText ?? ""}`);
  });
}

export function isPending(row: Pick<ScoutPostRow, "sentiment" | "matches" | "pipelineVersion" | "text" | "quotedText">): boolean {
  return (
    needsReread(row) ||
    row.sentiment === null ||
    (row.matches === null && countsAsPrediction(row.sentiment)) ||
    hasObsoleteMatch(row)
  );
}

export function createMemoryStore(): ScoutStore & { markets: Map<string, MarketRow> } {
  const handles = new Map<string, ScoutHandleRow>();
  const posts = new Map<string, ScoutPostRow>();
  const markets = new Map<string, MarketRow>();
  const forHandle = (handle: string) =>
    [...posts.values()]
      .filter((p) => p.handle === handle)
      .sort((a, b) => b.tweetedAt.getTime() - a.tweetedAt.getTime());

  return {
    markets,
    async getHandle(handle) {
      return handles.get(handle) ?? null;
    },
    async tryLock(handle, now) {
      const row = handles.get(handle);
      if (!row) {
        handles.set(handle, {
          handle,
          xUserId: null,
          status: "running",
          newestTweetId: null,
          scannedAt: null,
          lockedAt: now,
          lastError: null,
          createdAt: now,
        });
        return true;
      }
      const stale = row.lockedAt !== null && row.lockedAt.getTime() < now.getTime() - STALE_LOCK_MS;
      if (row.status === "running" && !stale) return false;
      row.status = "running";
      row.lockedAt = now;
      return true;
    },
    async finishScan(handle, { newestTweetId, xUserId, now, fetched = true }) {
      const row = handles.get(handle);
      if (!row) return;
      row.status = "idle";
      if (fetched) row.scannedAt = now;
      row.lockedAt = null;
      row.lastError = null;
      if (newestTweetId !== null) row.newestTweetId = newestTweetId;
      if (xUserId !== null) row.xUserId = xUserId;
    },
    async failScan(handle, error) {
      const row = handles.get(handle);
      if (!row) return;
      row.status = "failed";
      row.lockedAt = null;
      row.lastError = error;
    },
    async countNewHandlesSince(since) {
      return [...handles.values()].filter((h) => h.createdAt.getTime() > since.getTime()).length;
    },
    async existingTweetIds(ids) {
      return new Set(ids.filter((id) => posts.has(id)));
    },
    async upsertPosts(rows) {
      for (const row of rows) posts.set(row.tweetId, { ...row });
    },
    async listPosts(handle) {
      return forHandle(handle);
    },
    async pendingPosts(handle) {
      return forHandle(handle).filter(isPending);
    },
    async unforwardedPosts(handle) {
      return forHandle(handle).filter((p) => p.forwardedAt === null);
    },
    async markForwarded(ids, at) {
      for (const id of ids) {
        const row = posts.get(id);
        if (row) row.forwardedAt = at;
      }
    },
    async upsertMarket(row) {
      markets.set(row.geminiMarketId, { ...row });
    },
    async marketsToRefresh(now, limit) {
      const out = new Map<string, MarketToRefresh>();
      for (const p of posts.values()) {
        if (p.forwardedAt === null) continue;
        for (const m of p.matches ?? []) {
          if (m.status !== "matched" || !m.geminiEventTicker || !m.gameStartTime) continue;
          if (Date.parse(m.gameStartTime) > now.getTime()) continue;
          const status = markets.get(m.geminiEventTicker)?.status;
          if (status === "resolved" || status === "void") continue;
          out.set(m.geminiEventTicker, { geminiEventTicker: m.geminiEventTicker, gameStartTime: m.gameStartTime });
        }
      }
      return [...out.values()].slice(0, limit);
    },
  };
}
