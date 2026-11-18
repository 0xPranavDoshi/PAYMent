import type postgres from "postgres";
import type { ScoreRow, ScoreStore } from "./store.js";

interface Row {
  x_handle: string;
  score: number;
  score_change_14d: number | null;
  skill: number;
  n_resolved: number;
  n_wins: number;
  hit_rate: number | null;
  last_call_at: Date | null;
  updated_at: Date;
  inputs_hash: string | null;
  computed_at: Date | null;
}

export function createPostgresStore(sql: postgres.Sql): ScoreStore {
  return {
    async findByHandles(handles) {
      if (handles.length === 0) return [];
      const rows = await sql<Row[]>`
        select u.x_handle, us.score, us.score_change_14d, us.skill, us.n_resolved, us.n_wins,
               us.hit_rate, us.last_call_at, us.updated_at, s.inputs_hash, s.computed_at
        from users u
        join user_scores us on us.user_id = u.id
        left join score_snapshots s on s.id = us.snapshot_id
        where lower(u.x_handle) in ${sql(handles as string[])}
      `;
      return rows.map(
        (r): ScoreRow => ({
          handle: r.x_handle.toLowerCase(),
          score: r.score,
          scoreChange14d: r.score_change_14d,
          skill: r.skill,
          nResolved: r.n_resolved,
          nWins: r.n_wins,
          hitRate: r.hit_rate,
          lastCallAt: r.last_call_at,
          updatedAt: r.updated_at,
          latestSnapshot:
            r.inputs_hash && r.computed_at
              ? { inputsHash: r.inputs_hash, computedAt: r.computed_at }
              : null,
        }),
      );
    },
  };
}
