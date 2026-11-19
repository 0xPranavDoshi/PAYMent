import { randomUUID } from "node:crypto";
import {
  callPoints,
  computeUserScore,
  scoreChange14d,
  type ResolvedCall,
} from "@copayme/shared";
import type postgres from "postgres";
import { inputsHash } from "../worker.js";

/**
 * Demo users for local development and the demo. Handles start with demo_ so they can
 * never be mistaken for real X accounts, and the data is generated, not real picks.
 */
interface DemoUser {
  handle: string;
  nCalls: number;
  /** Cycled through to give each call its odds at call time. */
  oddsPool: number[];
  /** Share of calls that win. */
  winRate: number;
  /** Score in a snapshot 20 days ago, or null for a user too new to have one. */
  olderScore: number | null;
  lastCallHoursAgo: number;
}

export const DEMO_USERS: DemoUser[] = [
  // Beats the market and has improved: shows an up arrow.
  { handle: "demo_sharp", nCalls: 40, oddsPool: [0.35, 0.45, 0.5, 0.6, 0.4], winRate: 0.6, olderScore: 66, lastCallHoursAgo: 3 },
  // Wins as often as the odds say: score near 50, no arrow.
  { handle: "demo_steady", nCalls: 30, oddsPool: [0.5, 0.6, 0.4, 0.7, 0.3], winRate: 0.5, olderScore: 49, lastCallHoursAgo: 20 },
  // Loses to the market and is getting worse: shows a down arrow.
  { handle: "demo_slump", nCalls: 30, oddsPool: [0.5, 0.55, 0.45, 0.6], winRate: 0.3, olderScore: 38, lastCallHoursAgo: 8 },
  // Favourite picker: high hit rate but small edge.
  { handle: "demo_chalk", nCalls: 35, oddsPool: [0.8, 0.85, 0.75, 0.9], winRate: 0.8, olderScore: null, lastCallHoursAgo: 30 },
  // Under 5 resolved calls: shows the grey New badge.
  { handle: "demo_rookie", nCalls: 3, oddsPool: [0.4, 0.5, 0.6], winRate: 0.7, olderScore: null, lastCallHoursAgo: 5 },
];

/** Deterministic: call i wins when its slot in a 0..9 cycle falls under winRate. */
function makeCalls(user: DemoUser): ResolvedCall[] {
  return Array.from({ length: user.nCalls }, (_, i) => ({
    oddsAtCall: user.oddsPool[i % user.oddsPool.length]!,
    won: ((i * 7) % 10) / 10 < user.winRate,
  }));
}

export async function seedDemoData(sql: postgres.Sql, now: Date = new Date()) {
  const summary: { handle: string; score: number; change14d: number | null; tier: string }[] = [];

  await sql.begin(async (tx) => {
    // Re-running replaces the demo users; their scores and snapshots cascade.
    await tx`delete from users where x_user_id like 'demo-%'`;

    for (const [i, user] of DEMO_USERS.entries()) {
      const calls = makeCalls(user);
      const result = computeUserScore(calls);
      const entries = calls.map((c) => ({ id: randomUUID(), points: callPoints(c) }));
      const hash = inputsHash(entries);

      const [userRow] = await tx<{ id: string }[]>`
        insert into users (x_user_id, x_handle)
        values (${`demo-${i + 1}`}, ${user.handle})
        returning id`;
      const userId = userRow!.id;

      const twentyDaysAgo = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000);
      const snapshots: { score: number; computedAt: Date }[] = [];
      if (user.olderScore !== null) {
        snapshots.push({ score: user.olderScore, computedAt: twentyDaysAgo });
        await tx`
          insert into score_snapshots (user_id, score, call_ids, inputs_hash, computed_at)
          values (${userId}, ${user.olderScore}, ${[]}::uuid[], ${hash}, ${twentyDaysAgo})`;
      }

      const [snapshotRow] = await tx<{ id: string }[]>`
        insert into score_snapshots (user_id, score, call_ids, inputs_hash, computed_at)
        values (${userId}, ${result.score}, ${entries.map((e) => e.id)}::uuid[], ${hash}, ${now})
        returning id`;
      const snapshotId = snapshotRow!.id;

      const change = scoreChange14d(result.score, snapshots, now);
      const lastCallAt = new Date(now.getTime() - user.lastCallHoursAgo * 60 * 60 * 1000);

      await tx`
        insert into user_scores
          (user_id, score, score_change_14d, skill, n_resolved, n_wins, hit_rate, last_call_at, snapshot_id, updated_at)
        values
          (${userId}, ${result.score}, ${change}, ${result.skill}, ${result.nResolved}, ${result.nWins},
           ${result.hitRate}, ${lastCallAt}, ${snapshotId}, ${now})`;

      summary.push({ handle: user.handle, score: result.score, change14d: change, tier: result.tier });
    }
  });

  return summary;
}
