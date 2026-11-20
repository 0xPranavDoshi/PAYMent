import { countsAsPrediction, type PickMatch } from "@copayme/shared";
import type { Forwarder } from "./forward.js";
import type { GeminiClient } from "./gemini/client.js";
import type { Grok } from "./grok/client.js";
import { NO_GAME_REASON } from "./match/candidates.js";
import { matchPrediction, NO_SUB_MARKETS_REASON } from "./match/match.js";
import type { PostSource, RawPost } from "./posts/source.js";
import { readPosts } from "./stages/read.js";
import { PIPELINE_VERSION, type ScoutPostRow, type ScoutStore } from "./store.js";

export interface ScanDeps {
  store: ScoutStore;
  source: PostSource;
  grok: Grok;
  gemini: GeminiClient;
  forwarder: Forwarder;
  model: string;
  now?: () => Date;
  log?: (msg: string) => void;
}

const FIRST_SCAN_LIMIT = 100;
const TOP_UP_LIMIT = 20;
/** A post with no game found yet is retried on later scans until it is this old. */
const NO_GAME_RETRY_MS = 8 * 24 * 60 * 60 * 1000;
/** Posts matched at the same time. */
const MATCH_CONCURRENCY = 6;
/** no_market reasons that may change on a later scan (Gemini lists games and sub-markets late). */
const RETRYABLE_REASONS = new Set([NO_GAME_REASON, NO_SUB_MARKETS_REASON]);

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function maxId(ids: (string | null)[]): string | null {
  let best: string | null = null;
  for (const id of ids) {
    if (id !== null && (best === null || BigInt(id) > BigInt(best))) best = id;
  }
  return best;
}

const toRow = (p: RawPost, handle: string): ScoutPostRow => ({
  tweetId: p.tweetId,
  handle,
  xUserId: p.xUserId,
  tweetedAt: new Date(p.createdAt),
  text: p.text,
  isReply: p.isReply,
  quotedText: p.quotedText ?? null,
  sentiment: null,
  matches: null,
  pipelineVersion: PIPELINE_VERSION,
  forwardedAt: null,
});

const toRaw = (r: ScoutPostRow): RawPost => ({
  tweetId: r.tweetId,
  xUserId: r.xUserId,
  xHandle: r.handle,
  text: r.text,
  createdAt: r.tweetedAt.toISOString(),
  isRetweet: false,
  isReply: r.isReply,
  ...(r.quotedText ? { quotedText: r.quotedText } : {}),
});

/** Run one scan. The caller already holds the lock; this always ends in finishScan or failScan. */
export interface ScanOptions {
  /**
   * false: the account has posted nothing since the last fetch (the extension saw no newer tweet), so
   * skip X (Apify) and only finish what is pending: posts whose game wasn't listed yet, failed reads.
   */
  fetchNew?: boolean;
  /**
   * Asked between the stages (and between matched posts); true means the user pressed Stop, so the
   * remaining paid work (reading with the model, matching, forwarding) is skipped. What is already
   * done is kept, and posts not yet read stay pending, so a later scan finishes them without fetching again.
   */
  shouldStop?: () => boolean;
}

export async function runScan(handle: string, deps: ScanDeps, opts: ScanOptions = {}): Promise<void> {
  const fetchNew = opts.fetchNew ?? true;
  const stopped = opts.shouldStop ?? (() => false);
  const { store, source, grok, gemini, forwarder, model } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const tStart = performance.now();
  try {
    const previous = await store.getHandle(handle);
    const sinceId = previous?.newestTweetId ?? undefined;

    let fetched: RawPost[] = [];
    if (fetchNew) {
      try {
        fetched = await source.fetchPosts(handle, sinceId ? { sinceId, limit: TOP_UP_LIMIT } : { limit: FIRST_SCAN_LIMIT });
      } catch (e) {
        await store.failScan(handle, errMsg(e));
        return;
      }
    }

    const kept = fetched.filter((p) => !p.isRetweet);
    const existing = await store.existingTweetIds(kept.map((p) => p.tweetId));
    const rows = new Map<string, ScoutPostRow>();
    for (const p of kept) {
      if (!existing.has(p.tweetId) && !rows.has(p.tweetId)) rows.set(p.tweetId, toRow(p, handle));
    }
    // Pending rows keep their stored fields; only what is missing gets filled below. Rows from an
    // older pipeline version are read and matched again from scratch.
    for (const r of await store.pendingPosts(handle)) {
      if (r.pipelineVersion < PIPELINE_VERSION) {
        r.sentiment = null;
        r.matches = null;
        r.pipelineVersion = PIPELINE_VERSION;
      }
      rows.set(r.tweetId, r);
    }

    const tFetched = performance.now();

    const toRead = [...rows.values()].filter((r) => r.sentiment === null);
    if (toRead.length > 0 && !stopped()) {
      const read = await readPosts(toRead.map(toRaw), grok, model, log);
      for (const r of toRead) r.sentiment = read.get(r.tweetId) ?? null;
    }
    const tRead = performance.now();

    const toMatch: ScoutPostRow[] = [];
    for (const row of rows.values()) {
      if (row.sentiment === null || row.matches !== null) continue;
      if (countsAsPrediction(row.sentiment)) toMatch.push(row);
      else row.matches = [];
    }
    const matchRow = async (row: ScoutPostRow): Promise<void> => {
      try {
        const matches: PickMatch[] = [];
        for (const [i, p] of row.sentiment!.predictions.entries()) {
          matches.push(await matchPrediction(p, i, row.tweetedAt, { gemini, grok }));
        }
        // Gemini may not have listed the game (or its sub-markets) yet: keep the post pending while the
        // window is still open.
        const noGameYet =
          matches.length > 0 &&
          matches.every((m) => m.status === "no_market" && RETRYABLE_REASONS.has(m.reason ?? "")) &&
          row.tweetedAt.getTime() > now().getTime() - NO_GAME_RETRY_MS;
        row.matches = noGameYet ? null : matches;
      } catch (e) {
        log(`[scout] matching failed for tweet ${row.tweetId}, will retry: ${errMsg(e)}`);
      }
    };
    // A small worker pool: identical Gemini searches in flight are shared, so parallel posts mostly
    // hit the same few league/day lookups.
    let nextRow = 0;
    const worker = async () => {
      while (nextRow < toMatch.length && !stopped()) await matchRow(toMatch[nextRow++]!);
    };
    await Promise.all(Array.from({ length: Math.min(MATCH_CONCURRENCY, toMatch.length) }, worker));
    const tMatched = performance.now();

    await store.upsertPosts([...rows.values()]);

    const halted = stopped();
    const toForward = halted
      ? []
      : (await store.unforwardedPosts(handle)).filter((p) => p.matches?.some((m) => m.status === "matched"));
    if (toForward.length > 0) {
      const accepted = await forwarder.forward(toForward, handle);
      if (accepted.length > 0) await store.markForwarded(accepted, now());
    }

    await store.finishScan(handle, {
      newestTweetId: maxId([previous?.newestTweetId ?? null, ...fetched.map((p) => p.tweetId)]),
      xUserId: fetched[0]?.xUserId ?? null,
      now: now(),
      fetched: fetchNew,
    });
    const tDone = performance.now();
    const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
    const predictions = toMatch.reduce((n, r) => n + (r.sentiment?.predictions.length ?? 0), 0);
    if (halted) log(`[scout] scan @${handle} stopped by the user; unread posts stay pending`);
    log(
      `[scout] scan @${handle}: fetch ${fetchNew ? s(tFetched - tStart) : "skipped (nothing new posted)"} (${fetched.length} fetched, ${rows.size} to process), ` +
        `read ${s(tRead - tFetched)} (${toRead.length} posts), match ${s(tMatched - tRead)} ` +
        `(${predictions} predictions in ${toMatch.length} posts), save+forward ${s(tDone - tMatched)}, total ${s(tDone - tStart)}`,
    );
  } catch (e) {
    await store.failScan(handle, errMsg(e));
  }
}
