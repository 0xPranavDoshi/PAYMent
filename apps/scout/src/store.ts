import { countsAsPrediction, type PickMatch, type ScoutStatus, type Sentiment } from "@copayme/shared";

export const PIPELINE_VERSION = 1;

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
  outcomes: { label: string; instrumentSymbol: string; currentOdds: number }[];
  lockTime: Date;
  status: "open" | "resolved";
  winningOutcome: string | null;
  resolvedAt: Date | null;
}

export interface ScoutStore {
  getHandle(handle: string): Promise<ScoutHandleRow | null>;
  /** Creates the row when missing. Atomic: true only when the caller now holds the lock. */
  tryLock(handle: string, now: Date): Promise<boolean>;
  finishScan(
    handle: string,
    result: { newestTweetId: string | null; xUserId: string | null; now: Date },
  ): Promise<void>;
  failScan(handle: string, error: string): Promise<void>;
  countNewHandlesSince(since: Date): Promise<number>;
  existingTweetIds(ids: string[]): Promise<Set<string>>;
  upsertPosts(rows: ScoutPostRow[]): Promise<void>;
  /** Newest first. */
  listPosts(handle: string): Promise<ScoutPostRow[]>;
  /** Unread posts, plus counted predictions whose matching is not done. */
  pendingPosts(handle: string): Promise<ScoutPostRow[]>;
  unforwardedPosts(handle: string): Promise<ScoutPostRow[]>;
  markForwarded(ids: string[], at: Date): Promise<void>;
  upsertMarket(row: MarketRow): Promise<void>;
}

export function isPending(row: Pick<ScoutPostRow, "sentiment" | "matches">): boolean {
  return row.sentiment === null || (row.matches === null && countsAsPrediction(row.sentiment));
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
    async finishScan(handle, { newestTweetId, xUserId, now }) {
      const row = handles.get(handle);
      if (!row) return;
      row.status = "idle";
      row.scannedAt = now;
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
  };
}
