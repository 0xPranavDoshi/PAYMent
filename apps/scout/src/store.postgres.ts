import type { PickMatch, ScoutStatus, Sentiment } from "@copayme/shared";
import type postgres from "postgres";
import { PIPELINE_VERSION, STALE_LOCK_MS, isPending, type ScoutPostRow, type ScoutStore } from "./store.js";

/** Posts per multi-row upsert statement (well under Postgres' 65535 bind-parameter limit). */
const UPSERT_CHUNK = 200;

interface HandleDb {
  x_handle: string;
  x_user_id: string | null;
  status: ScoutStatus;
  newest_tweet_id: string | null;
  scanned_at: Date | null;
  locked_at: Date | null;
  last_error: string | null;
  created_at: Date;
}

interface PostDb {
  tweet_id: string;
  x_handle: string;
  x_user_id: string;
  tweeted_at: Date;
  tweet_text: string;
  is_reply: boolean;
  quoted_text: string | null;
  sentiment: Sentiment | null;
  matches: PickMatch[] | null;
  pipeline_version: number;
  forwarded_at: Date | null;
}

function toPost(r: PostDb): ScoutPostRow {
  return {
    tweetId: r.tweet_id,
    handle: r.x_handle,
    xUserId: r.x_user_id,
    tweetedAt: r.tweeted_at,
    text: r.tweet_text,
    isReply: r.is_reply,
    quotedText: r.quoted_text,
    sentiment: r.sentiment,
    matches: r.matches,
    pipelineVersion: r.pipeline_version,
    forwardedAt: r.forwarded_at,
  };
}

export function createPostgresStore(sql: postgres.Sql): ScoutStore {
  return {
    async getHandle(handle) {
      const [r] = await sql<HandleDb[]>`select * from scout_handles where x_handle = ${handle}`;
      if (!r) return null;
      return {
        handle: r.x_handle,
        xUserId: r.x_user_id,
        status: r.status,
        newestTweetId: r.newest_tweet_id,
        scannedAt: r.scanned_at,
        lockedAt: r.locked_at,
        lastError: r.last_error,
        createdAt: r.created_at,
      };
    },
    async tryLock(handle, now) {
      const stale = new Date(now.getTime() - STALE_LOCK_MS);
      const rows = await sql`
        insert into scout_handles (x_handle, status, locked_at, created_at)
        values (${handle}, 'running', ${now}, ${now})
        on conflict (x_handle) do update
          set status = 'running', locked_at = ${now}
          where scout_handles.status <> 'running' or scout_handles.locked_at < ${stale}
        returning x_handle
      `;
      return rows.length > 0;
    },
    async finishScan(handle, { newestTweetId, xUserId, now }) {
      await sql`
        update scout_handles
        set status = 'idle', scanned_at = ${now}, locked_at = null, last_error = null,
            newest_tweet_id = coalesce(${newestTweetId}, newest_tweet_id),
            x_user_id = coalesce(${xUserId}, x_user_id)
        where x_handle = ${handle}
      `;
    },
    async failScan(handle, error) {
      await sql`
        update scout_handles set status = 'failed', locked_at = null, last_error = ${error}
        where x_handle = ${handle}
      `;
    },
    async countNewHandlesSince(since) {
      const [r] = await sql<{ n: number }[]>`
        select count(*)::int as n from scout_handles where created_at > ${since}
      `;
      return r?.n ?? 0;
    },
    async existingTweetIds(ids) {
      if (ids.length === 0) return new Set();
      const rows = await sql<{ tweet_id: string }[]>`
        select tweet_id from scout_posts where tweet_id in ${sql(ids)}
      `;
      return new Set(rows.map((r) => r.tweet_id));
    },
    async upsertPosts(rows) {
      // One multi-row statement per chunk instead of one round trip per post (71 posts took ~6 s
      // against the Supabase pooler). Duplicate ids within a call would make one statement update
      // the same row twice, which Postgres rejects, so the last row per id wins.
      const unique = [...new Map(rows.map((p) => [p.tweetId, p])).values()];
      for (let i = 0; i < unique.length; i += UPSERT_CHUNK) {
        const values = unique.slice(i, i + UPSERT_CHUNK).map((p) => ({
          tweet_id: p.tweetId,
          x_handle: p.handle,
          x_user_id: p.xUserId,
          tweeted_at: p.tweetedAt,
          tweet_text: p.text,
          is_reply: p.isReply,
          quoted_text: p.quotedText,
          sentiment: p.sentiment === null ? null : sql.json(p.sentiment),
          matches: p.matches === null ? null : sql.json(p.matches),
          pipeline_version: p.pipelineVersion,
          forwarded_at: p.forwardedAt,
        }));
        await sql`
          insert into scout_posts ${sql(values as never)}
          on conflict (tweet_id) do update set
            x_handle = excluded.x_handle, x_user_id = excluded.x_user_id,
            tweeted_at = excluded.tweeted_at, tweet_text = excluded.tweet_text,
            is_reply = excluded.is_reply, quoted_text = excluded.quoted_text,
            sentiment = excluded.sentiment, matches = excluded.matches,
            pipeline_version = excluded.pipeline_version, forwarded_at = excluded.forwarded_at
        `;
      }
    },
    async listPosts(handle) {
      const rows = await sql<PostDb[]>`
        select * from scout_posts where x_handle = ${handle} order by tweeted_at desc
      `;
      return rows.map(toPost);
    },
    async pendingPosts(handle) {
      const rows = await sql<PostDb[]>`
        select * from scout_posts
        where x_handle = ${handle}
          and (sentiment is null or matches is null or pipeline_version < ${PIPELINE_VERSION})
        order by tweeted_at desc
      `;
      return rows.map(toPost).filter(isPending);
    },
    async unforwardedPosts(handle) {
      const rows = await sql<PostDb[]>`
        select * from scout_posts
        where x_handle = ${handle} and forwarded_at is null
        order by tweeted_at desc
      `;
      return rows.map(toPost);
    },
    async markForwarded(ids, at) {
      if (ids.length === 0) return;
      await sql`update scout_posts set forwarded_at = ${at} where tweet_id in ${sql(ids)}`;
    },
    async upsertMarket(m) {
      await sql`
        insert into markets
          (gemini_market_id, sport, event_name, outcomes, lock_time, status, winning_outcome, resolved_at)
        values
          (${m.geminiMarketId}, ${m.sport}, ${m.eventName}, ${sql.json(m.outcomes)}, ${m.lockTime},
           ${m.status}, ${m.winningOutcome}, ${m.resolvedAt})
        on conflict (gemini_market_id) do update set
          outcomes = excluded.outcomes, status = excluded.status,
          winning_outcome = excluded.winning_outcome, resolved_at = excluded.resolved_at,
          lock_time = excluded.lock_time, synced_at = now()
      `;
    },
  };
}
