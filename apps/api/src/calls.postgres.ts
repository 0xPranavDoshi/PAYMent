import type postgres from "postgres";
import type { CallsStore, LedgerRow } from "./calls.js";

interface Row {
  id: string;
  tweet_id: string;
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

export function createPostgresCallsStore(sql: postgres.Sql): CallsStore {
  return {
    async listCalls(handle, { limit, statuses }) {
      const [user] = await sql<{ id: string }[]>`select id from users where lower(x_handle) = ${handle}`;
      if (!user) return null;

      const rows = await sql<Row[]>`
        select c.id, p.tweet_id, c.tweeted_at, m.event_name, c.picked_outcome, c.instrument_symbol,
               c.side, c.odds_at_call, c.odds_source, c.status, c.points, m.outcomes
        from calls c
        join posts p on p.id = c.post_id
        join markets m on m.id = c.market_id
        where c.user_id = ${user.id}
          ${statuses ? sql`and c.status in ${sql(statuses as string[])}` : sql``}
        order by c.tweeted_at desc, c.id desc
        limit ${limit}`;

      return rows.map(
        (r): LedgerRow => ({
          id: r.id,
          tweetId: r.tweet_id,
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
        }),
      );
    },
  };
}
