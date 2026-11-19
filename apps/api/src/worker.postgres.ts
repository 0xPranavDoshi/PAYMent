import type postgres from "postgres";
import type { DueCall, ScoredCall, WorkerDb, WorkerStore } from "./worker.js";

/** Arbitrary constant; whichever run holds it is the only one settling. */
const WORKER_LOCK_ID = 7_203_412;

interface DbDue {
  id: string;
  user_id: string;
  side: "yes" | "no" | null;
  instrument_symbol: string | null;
  odds_at_call: number | null;
  market_status: "resolved" | "void";
  outcomes: unknown;
}

function createDb(sql: postgres.TransactionSql): WorkerDb {
  return {
    async tryLock() {
      const [row] = await sql<{ ok: boolean }[]>`select pg_try_advisory_xact_lock(${WORKER_LOCK_ID}) as ok`;
      return row?.ok === true;
    },

    async dueCalls(limit) {
      const rows = await sql<DbDue[]>`
        select c.id, c.user_id, c.side, c.instrument_symbol, c.odds_at_call,
               m.status as market_status, m.outcomes
        from calls c
        join markets m on m.id = c.market_id
        where c.status = 'pending' and m.status in ('resolved', 'void')
        order by c.tweeted_at, c.id
        limit ${limit}
        for update of c`;
      return rows.map(
        (r): DueCall => ({
          id: r.id,
          userId: r.user_id,
          side: r.side,
          instrumentSymbol: r.instrument_symbol,
          oddsAtCall: r.odds_at_call,
          marketStatus: r.market_status,
          outcomes: r.outcomes,
        }),
      );
    },

    async markCall(id, status, points) {
      await sql`update calls set status = ${status}, points = ${points} where id = ${id} and status = 'pending'`;
    },

    async pricedScoredCalls(userId) {
      const rows = await sql<{ id: string; odds_at_call: number; points: number }[]>`
        select id, odds_at_call, points from calls
        where user_id = ${userId} and status = 'scored' and points is not null and odds_at_call is not null
        order by id`;
      return rows.map((r): ScoredCall => ({ id: r.id, oddsAtCall: r.odds_at_call, points: r.points }));
    },

    async lastCallAt(userId) {
      const [row] = await sql<{ last: Date | null }[]>`select max(tweeted_at) as last from calls where user_id = ${userId}`;
      return row?.last ?? null;
    },

    async snapshots(userId) {
      const rows = await sql<{ score: number; computed_at: Date }[]>`
        select score, computed_at from score_snapshots where user_id = ${userId}`;
      return rows.map((r) => ({ score: r.score, computedAt: r.computed_at }));
    },

    async insertSnapshot(s) {
      const [row] = await sql<{ id: string }[]>`
        insert into score_snapshots (user_id, score, call_ids, inputs_hash, computed_at)
        values (${s.userId}, ${s.score}, ${s.callIds}::uuid[], ${s.inputsHash}, ${s.computedAt})
        returning id`;
      return row!.id;
    },

    async upsertUserScore(r) {
      await sql`
        insert into user_scores
          (user_id, score, score_change_14d, skill, n_resolved, n_wins, hit_rate, last_call_at, snapshot_id, updated_at)
        values
          (${r.userId}, ${r.score}, ${r.change14d}, ${r.skill}, ${r.nResolved}, ${r.nWins},
           ${r.hitRate}, ${r.lastCallAt}, ${r.snapshotId}, ${r.updatedAt})
        on conflict (user_id) do update set
          score = excluded.score,
          score_change_14d = excluded.score_change_14d,
          skill = excluded.skill,
          n_resolved = excluded.n_resolved,
          n_wins = excluded.n_wins,
          hit_rate = excluded.hit_rate,
          last_call_at = excluded.last_call_at,
          snapshot_id = excluded.snapshot_id,
          updated_at = excluded.updated_at`;
    },

    async handles(userIds) {
      if (userIds.length === 0) return [];
      const rows = await sql<{ x_handle: string }[]>`select x_handle from users where id in ${sql(userIds)}`;
      return rows.map((r) => r.x_handle);
    },
  };
}

export function createPostgresWorkerStore(sql: postgres.Sql): WorkerStore {
  return {
    transaction: (fn) => sql.begin((tx) => fn(createDb(tx))) as ReturnType<typeof fn>,
  };
}
