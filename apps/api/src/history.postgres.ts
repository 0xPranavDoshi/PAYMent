import type postgres from "postgres";
import type { ScoreHistoryStore } from "./history.js";

export function createPostgresHistoryStore(sql: postgres.Sql): ScoreHistoryStore {
  return {
    async scoreAt(handle, at) {
      const [user] = await sql<{ id: string }[]>`select id from users where lower(x_handle) = ${handle}`;
      if (!user) return undefined;
      const [row] = await sql<{ score: number; computed_at: Date }[]>`
        select score, computed_at from score_snapshots
        where user_id = ${user.id} and computed_at <= ${at}
        order by computed_at desc, id desc
        limit 1`;
      return row ? { score: row.score, computedAt: row.computed_at } : null;
    },
  };
}
