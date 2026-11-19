import type postgres from "postgres";
import type { IngestDb, IngestStore, MarketRow } from "./ingest.js";

interface DbMarket {
  id: string;
  lock_time: Date;
  status: MarketRow["status"];
  outcomes: unknown;
  synced_at: Date;
}

function createDb(sql: postgres.TransactionSql): IngestDb {
  return {
    async upsertUser(xUserId, handle) {
      const [row] = await sql<{ id: string }[]>`
        insert into users (x_user_id, x_handle) values (${xUserId}, ${handle})
        on conflict (x_user_id) do update set x_handle = excluded.x_handle
        returning id`;
      return row!.id;
    },

    async upsertPost({ tweetId, userId, tweetedAt, tweetText, sentiment }) {
      const json = sentiment === undefined ? null : sql.json(sentiment as postgres.JSONValue);
      // A re-sent post refreshes its text and sentiment; it can never move to another user.
      const [row] = await sql<{ id: string }[]>`
        insert into posts (tweet_id, user_id, tweeted_at, tweet_text, sentiment)
        values (${tweetId}, ${userId}, ${tweetedAt}, ${tweetText}, ${json})
        on conflict (tweet_id) do update
          set tweet_text = excluded.tweet_text, sentiment = excluded.sentiment
          where posts.user_id = excluded.user_id
        returning id`;
      return row?.id ?? null;
    },

    async findMarket(ticker) {
      const [row] = await sql<DbMarket[]>`
        select id, lock_time, status, outcomes, synced_at
        from markets where gemini_market_id = ${ticker}`;
      return row
        ? { id: row.id, lockTime: row.lock_time, status: row.status, outcomes: row.outcomes, syncedAt: row.synced_at }
        : null;
    },

    async upsertCall(c) {
      // One atomic statement. The unique (user_id, market_id) means a second pick on the same
      // market conflicts; it only replaces the first while that is still pending and either
      // comes from the same post (a re-send) or was tweeted earlier (earliest tweet wins).
      const [row] = await sql<{ id: string; inserted: boolean }[]>`
        insert into calls
          (post_id, user_id, market_id, picked_outcome, instrument_symbol, side,
           tweeted_at, odds_at_call, odds_source, ingest_lag_s, status)
        values
          (${c.postId}, ${c.userId}, ${c.marketId}, ${c.pickedOutcome}, ${c.instrumentSymbol}, ${c.side},
           ${c.tweetedAt}, ${c.oddsAtCall}, ${c.oddsSource}, ${c.ingestLagS}, 'pending')
        on conflict on constraint calls_one_per_user_market do update set
          post_id = excluded.post_id,
          picked_outcome = excluded.picked_outcome,
          instrument_symbol = excluded.instrument_symbol,
          side = excluded.side,
          tweeted_at = excluded.tweeted_at,
          odds_at_call = excluded.odds_at_call,
          odds_source = excluded.odds_source,
          ingest_lag_s = excluded.ingest_lag_s
        where calls.status = 'pending'
          and (calls.post_id = excluded.post_id or excluded.tweeted_at < calls.tweeted_at)
        returning id, (xmax = 0) as inserted`;
      return row ? { callId: row.id, inserted: row.inserted } : null;
    },
  };
}

export function createPostgresIngestStore(sql: postgres.Sql): IngestStore {
  return {
    transaction: (fn) => sql.begin((tx) => fn(createDb(tx))) as ReturnType<typeof fn>,
  };
}
