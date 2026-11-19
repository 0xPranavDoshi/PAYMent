import type postgres from "postgres";
import type { CallsStore, LedgerRow } from "./calls.js";

interface Row {
  id: string;
  tweet_id: string;
  tweet_text: string;
  tweeted_at: Date;
  event_name: string;
  picked_outcome: string;
  instrument_symbol: string | null;
  side: "yes" | "no" | null;
  odds_at_call: number | null;
  odds_source: "history" | "snapshot" | "none";
  status: LedgerRow["status"];
  points: number | null;
  outcomes: unknown;
}

const toRow = (r: Row): LedgerRow => ({
  id: r.id,
  tweetId: r.tweet_id,
  tweetText: r.tweet_text,
  tweetedAt: r.tweeted_at,
  eventName: r.event_name,
  pickedOutcome: r.picked_outcome,
  instrumentSymbol: r.instrument_symbol,
  side: r.side,
  oddsAtCall: r.odds_at_call,
  oddsSource: r.odds_source,
  status: r.status,
  points: r.points,
  outcomes: r.outcomes,
});

export function createPostgresCallsStore(sql: postgres.Sql): CallsStore {
  return {
    async listRecent(limit) {
      const rows = await sql<(Row & { handle: string })[]>`
        select c.id, p.tweet_id, p.tweet_text, c.tweeted_at, m.event_name, c.picked_outcome, c.instrument_symbol,
               c.side, c.odds_at_call, c.odds_source, c.status, c.points, m.outcomes, u.x_handle as handle
        from calls c
        join posts p on p.id = c.post_id
        join markets m on m.id = c.market_id
        join users u on u.id = c.user_id
        where c.status in ('pending', 'scored')
        order by c.tweeted_at desc, c.id desc
        limit ${limit}`;
      return rows.map((r) => ({ ...toRow(r), handle: r.handle }));
    },

    async scoreHistory(handle, limit) {
      const [user] = await sql<{ id: string }[]>`select id from users where lower(x_handle) = ${handle}`;
      if (!user) return null;
      const rows = await sql<{ score: number; computed_at: Date }[]>`
        select score, computed_at from score_snapshots
        where user_id = ${user.id}
        order by computed_at desc
        limit ${limit}`;
      return rows.reverse().map((r) => ({ score: r.score, computedAt: r.computed_at }));
    },

    async listCalls(handle, { limit, statuses }) {
      const [user] = await sql<{ id: string }[]>`select id from users where lower(x_handle) = ${handle}`;
      if (!user) return null;

      const rows = await sql<Row[]>`
        select c.id, p.tweet_id, p.tweet_text, c.tweeted_at, m.event_name, c.picked_outcome, c.instrument_symbol,
               c.side, c.odds_at_call, c.odds_source, c.status, c.points, m.outcomes
        from calls c
        join posts p on p.id = c.post_id
        join markets m on m.id = c.market_id
        where c.user_id = ${user.id}
          ${statuses ? sql`and c.status in ${sql(statuses as string[])}` : sql``}
        order by c.tweeted_at desc, c.id desc
        limit ${limit}`;

      return rows.map(toRow);
    },
  };
}
