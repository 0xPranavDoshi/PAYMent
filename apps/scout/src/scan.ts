import { countsAsPrediction, type PickMatch } from "@copayme/shared";
import type { Forwarder } from "./forward.js";
import type { GeminiClient } from "./gemini/client.js";
import type { Grok } from "./grok/client.js";
import { matchPrediction } from "./match/match.js";
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
export async function runScan(handle: string, deps: ScanDeps): Promise<void> {
  const { store, source, grok, gemini, forwarder, model } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((msg: string) => console.log(msg));
  try {
    const previous = await store.getHandle(handle);
    const sinceId = previous?.newestTweetId ?? undefined;

    let fetched: RawPost[];
    try {
      fetched = await source.fetchPosts(handle, {
        limit: FIRST_SCAN_LIMIT,
        ...(sinceId ? { sinceId } : {}),
      });
    } catch (e) {
      await store.failScan(handle, errMsg(e));
      return;
    }

    const kept = fetched.filter((p) => !p.isRetweet);
    const existing = await store.existingTweetIds(kept.map((p) => p.tweetId));
    const rows = new Map<string, ScoutPostRow>();
    for (const p of kept) {
      if (!existing.has(p.tweetId) && !rows.has(p.tweetId)) rows.set(p.tweetId, toRow(p, handle));
    }
    // Pending rows keep their stored fields; only what is missing gets filled below.
    for (const r of await store.pendingPosts(handle)) rows.set(r.tweetId, r);

    const toRead = [...rows.values()].filter((r) => r.sentiment === null);
    if (toRead.length > 0) {
      const read = await readPosts(toRead.map(toRaw), grok, model);
      for (const r of toRead) r.sentiment = read.get(r.tweetId) ?? null;
    }

    for (const row of rows.values()) {
      if (row.sentiment === null || row.matches !== null) continue;
      if (!countsAsPrediction(row.sentiment)) {
        row.matches = [];
        continue;
      }
      try {
        const matches: PickMatch[] = [];
        for (const [i, p] of row.sentiment.predictions.entries()) {
          matches.push(await matchPrediction(p, i, row.tweetedAt, { gemini, grok }));
        }
        row.matches = matches;
      } catch (e) {
        log(`[scout] matching failed for tweet ${row.tweetId}, will retry: ${errMsg(e)}`);
      }
    }

    await store.upsertPosts([...rows.values()]);

    const toForward = (await store.unforwardedPosts(handle)).filter((p) =>
      p.matches?.some((m) => m.status === "matched"),
    );
    if (toForward.length > 0) {
      const accepted = await forwarder.forward(toForward, handle);
      if (accepted.length > 0) await store.markForwarded(accepted, now());
    }

    await store.finishScan(handle, {
      newestTweetId: maxId([previous?.newestTweetId ?? null, ...fetched.map((p) => p.tweetId)]),
      xUserId: fetched[0]?.xUserId ?? null,
      now: now(),
    });
  } catch (e) {
    await store.failScan(handle, errMsg(e));
  }
}
