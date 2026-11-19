import { computeUserScore, type NewPost, type Pick } from "@copayme/shared";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { ingestPosts } from "../ingest.js";
import { inputsHash, runWorker, type WorkerStore } from "../worker.js";
import { createPostgresWorkerStore } from "../worker.postgres.js";
import { createPostgresIngestStore } from "../ingest.postgres.js";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS_DIR, isLocalDatabase, migrate, migrationStatus, resetLocalDatabase } from "./migrate.js";
import { DEMO_USERS, seedDemoData } from "./seed.js";
import { createPostgresCallsStore } from "../calls.postgres.js";
import { createPostgresHistoryStore } from "../history.postgres.js";
import { createPostgresStore } from "../store.postgres.js";

// Runs only against a local database: TEST_DATABASE_URL=postgres://postgres@localhost:5432/copayme_test
// It wipes the public schema, so it refuses anything that is not on localhost.
const url = process.env.TEST_DATABASE_URL;

describe("isLocalDatabase", () => {
  it("only accepts localhost", () => {
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@127.0.0.1/db")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@db.abcd.supabase.co:5432/postgres")).toBe(false);
  });
});

describe.skipIf(!url)("against a real Postgres", () => {
  const sql = postgres(url ?? "postgres://unused@localhost/unused", { onnotice: () => {} });
  const now = new Date("2026-11-17T12:00:00Z");

  beforeAll(async () => {
    await resetLocalDatabase(sql, url!);
    await seedDemoData(sql, now);
  });
  afterAll(() => sql.end());

  it("serves seeded badges through the API", async () => {
    const app = createApp({ store: createPostgresStore(sql) });
    const handles = DEMO_USERS.map((u) => u.handle).join(",");
    const res = await app.request(`/v1/badges?handles=${handles},DEMO_Sharp,nobody`);
    const body = await res.json();

    expect(Object.keys(body)).toHaveLength(DEMO_USERS.length + 1);
    expect(body.nobody).toBeNull();
    expect(body.demo_rookie).toMatchObject({ tier: "new", nResolved: 3, change14d: null });
    expect(body.demo_sharp.tier).toBe("scored");
    expect(body.demo_sharp.score).toBeGreaterThan(60);
    expect(body.demo_sharp.change14d).toBe(body.demo_sharp.score - 66);
    expect(body.demo_slump.score).toBeLessThan(40);
    expect(body.demo_slump.change14d).toBeLessThan(0);
  });

  it("serves the profile with the latest snapshot hash", async () => {
    const app = createApp({ store: createPostgresStore(sql) });
    const profile = await (await app.request("/v1/users/demo_sharp")).json();
    expect(profile.latestSnapshot.inputsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(profile.latestSnapshot.computedAt).toBe(now.toISOString());
  });

  it("ranks scored users best first and leaves out users still on the New badge", async () => {
    const app = createApp({ store: createPostgresStore(sql) });
    const board = await (await app.request("/v1/leaderboard")).json();
    expect(board.map((e: { handle: string }) => e.handle)).toEqual([
      "demo_sharp", // 82
      "demo_steady", // 50
      "demo_chalk", // 44
      "demo_slump", // 10
    ]); // demo_rookie (3 resolved picks, score 63) is not listed
    expect(board[0]).toMatchObject({ handle: "demo_sharp", score: 82, change14d: 16, tier: "scored" });

    const top2 = await (await app.request("/v1/leaderboard?limit=2")).json();
    expect(top2.map((e: { handle: string }) => e.handle)).toEqual(["demo_sharp", "demo_steady"]);
  });

  it("breaks leaderboard ties on more resolved picks, then handle", async () => {
    const mk = async (handle: string, xId: string, n: number) => {
      const [u] = await sql<{ id: string }[]>`insert into users (x_user_id, x_handle) values (${xId}, ${handle}) returning id`;
      await sql`insert into user_scores (user_id, score, skill, n_resolved, n_wins) values (${u!.id}, 50, 0, ${n}, 0)`;
    };
    await mk("zeta_tie", "demo-t1", 40); // same score as demo_steady (50) but more resolved picks
    await mk("alpha_tie", "demo-t2", 30); // same score and picks as demo_steady
    const app = createApp({ store: createPostgresStore(sql) });
    const order = (await (await app.request("/v1/leaderboard")).json()).map((e: { handle: string }) => e.handle);
    expect(order.slice(1, 4)).toEqual(["zeta_tie", "alpha_tie", "demo_steady"]);
    await sql`delete from users where x_user_id in ('demo-t1','demo-t2')`;
  });

  it("gives a user's score as of a past moment, from the latest snapshot at or before it", async () => {
    const app = createApp({ store: createPostgresStore(sql), history: createPostgresHistoryStore(sql) });
    const at = async (handle: string, when: string) => (await app.request(`/v1/users/${handle}/score-at?at=${when}`)).json();
    // demo_sharp has a snapshot 20 days before the seed time (score 66) and one at the seed time (score 82)
    expect(await at("demo_sharp", "2026-11-10T00:00:00Z")).toMatchObject({ score: 66 });
    expect(await at("DEMO_Sharp", "2026-11-20T00:00:00Z")).toMatchObject({ score: 82 });
    expect(await at("demo_sharp", "2026-10-01T00:00:00Z")).toEqual({ score: null, computedAt: null }); // before any snapshot
    expect((await app.request("/v1/users/nobody/score-at?at=2026-11-10T00:00:00Z")).status).toBe(404);
  });

  it("can be re-seeded without duplicating users", async () => {
    await seedDemoData(sql, now);
    const [row] = await sql<{ count: string }[]>`select count(*) from users`;
    expect(Number(row!.count)).toBe(DEMO_USERS.length);
  });

  it("refuses to reset a non-local database", async () => {
    await expect(
      resetLocalDatabase(sql, "postgres://u:p@db.abcd.supabase.co:5432/postgres"),
    ).rejects.toThrow(/localhost/);
  });

  describe("calls rules", () => {
    const LOCK = "2026-11-20T02:00:00Z";
    const BEFORE = "2026-11-19T12:00:00Z";
    let userId: string;

    beforeAll(async () => {
      await resetLocalDatabase(sql, url!);
    });
    beforeEach(async () => {
      await sql`truncate calls, posts, markets, tails, users cascade`;
      const [u] = await sql<{ id: string }[]>`
        insert into users (x_user_id, x_handle) values ('1', 'tipster') returning id`;
      userId = u!.id;
    });

    async function market(ticker: string, lock = LOCK) {
      const [m] = await sql<{ id: string }[]>`
        insert into markets (gemini_market_id, sport, event_name, lock_time)
        values (${ticker}, 'basketball', ${ticker}, ${lock}) returning id`;
      return m!.id;
    }
    async function post(tweetId: string, at = BEFORE) {
      const [p] = await sql<{ id: string }[]>`
        insert into posts (tweet_id, user_id, tweeted_at, tweet_text)
        values (${tweetId}, ${userId}, ${at}, 'pick') returning id`;
      return p!.id;
    }
    async function call(o: {
      postId: string;
      marketId: string;
      at?: string;
      odds?: number | null;
      source?: string;
      side?: string | null;
      symbol?: string | null;
    }) {
      const odds = "odds" in o ? o.odds : 0.4;
      const side = "side" in o ? o.side : "yes";
      const symbol = "symbol" in o ? o.symbol : "GEMI-X";
      return sql`
        insert into calls (post_id, user_id, market_id, picked_outcome, instrument_symbol, side,
                           tweeted_at, odds_at_call, odds_source)
        values (${o.postId}, ${userId}, ${o.marketId}, 'Team', ${symbol ?? null}, ${side ?? null},
                ${o.at ?? BEFORE}, ${odds ?? null}, ${o.source ?? "snapshot"})`;
    }

    it("accepts a pick tweeted before the lock and rejects one at or after it", async () => {
      const m = await market("A");
      const p = await post("t1");
      await call({ postId: p, marketId: m, at: "2026-11-20T01:59:59Z" });

      const m2 = await market("B");
      await expect(call({ postId: p, marketId: m2, at: LOCK })).rejects.toThrow(/not before the market lock/);
      await expect(call({ postId: p, marketId: m2, at: "2026-11-21T00:00:00Z" })).rejects.toThrow(
        /not before the market lock/,
      );
    });

    it("also checks when the tweet time or market of an existing call changes", async () => {
      const m = await market("A");
      const p = await post("t1");
      await call({ postId: p, marketId: m });
      await expect(sql`update calls set tweeted_at = ${LOCK}`).rejects.toThrow(/not before the market lock/);

      const early = await market("EARLY", "2026-11-19T06:00:00Z");
      await expect(sql`update calls set market_id = ${early}`).rejects.toThrow(/not before the market lock/);
    });

    it("lets one post hold several picks, but only one pick per user and market", async () => {
      const winner = await market("WINNER");
      const total = await market("TOTAL");
      const p = await post("t1");
      await call({ postId: p, marketId: winner });
      await call({ postId: p, marketId: total, side: "no" });

      const p2 = await post("t2");
      await expect(call({ postId: p2, marketId: winner, side: "no" })).rejects.toThrow(/calls_one_per_user_market/);
    });

    it("allows an unpriced pick only when the source is none, and the reverse", async () => {
      const m = await market("A");
      const p = await post("t1");
      await call({ postId: p, marketId: m, odds: null, source: "none" });

      const m2 = await market("B");
      await expect(call({ postId: p, marketId: m2, odds: null, source: "snapshot" })).rejects.toThrow(
        /calls_odds_present_iff_priced/,
      );
      await expect(call({ postId: p, marketId: m2, odds: 0.5, source: "none" })).rejects.toThrow(
        /calls_odds_present_iff_priced/,
      );
      await expect(call({ postId: p, marketId: m2, odds: 1.2, source: "history" })).rejects.toThrow();
    });

    it("needs a side and its contract together, and the side must be yes or no", async () => {
      const m = await market("A");
      const p = await post("t1");
      await expect(call({ postId: p, marketId: m, side: "yes", symbol: null })).rejects.toThrow(
        /calls_side_with_instrument/,
      );
      await expect(call({ postId: p, marketId: m, side: null, symbol: "GEMI-X" })).rejects.toThrow(
        /calls_side_with_instrument/,
      );
      await expect(call({ postId: p, marketId: m, side: "maybe" })).rejects.toThrow();
      await call({ postId: p, marketId: m, side: null, symbol: null }); // legacy shape still valid
    });

    it("has the indexes the worker and cascades rely on", async () => {
      const rows = await sql<{ indexname: string }[]>`
        select indexname from pg_indexes where tablename = 'calls'`;
      const names = rows.map((r) => r.indexname);
      expect(names).toContain("calls_post_idx");
      expect(names).toContain("calls_pending_market_idx");
    });

    it("upgrades a database that already has calls", async () => {
      const dir = (await mkdtemp(join(tmpdir(), "upgrade-"))) + "/";
      try {
        const all = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
        const latest = all.at(-1)!;
        for (const f of all.slice(0, -1)) await copyFile(MIGRATIONS_DIR + f, dir + f);

        await sql.unsafe("drop schema public cascade; create schema public;");
        await migrate(sql, dir); // everything but the newest migration
        const [u] = await sql<{ id: string }[]>`insert into users (x_user_id, x_handle) values ('9', 'old') returning id`;
        const [m] = await sql<{ id: string }[]>`
          insert into markets (gemini_market_id, sport, event_name, lock_time) values ('OLD', 's', 'old', ${LOCK}) returning id`;
        const [p] = await sql<{ id: string }[]>`
          insert into posts (tweet_id, user_id, tweeted_at, tweet_text) values ('old', ${u!.id}, ${BEFORE}, 'x') returning id`;
        await sql`
          insert into calls (post_id, user_id, market_id, picked_outcome, tweeted_at, odds_at_call, odds_source)
          values (${p!.id}, ${u!.id}, ${m!.id}, 'Team', ${BEFORE}, 0.4, 'snapshot')`;

        await copyFile(MIGRATIONS_DIR + latest, dir + latest);
        expect(await migrate(sql, dir)).toEqual([latest]);
        const [row] = await sql<{ count: string }[]>`select count(*) from calls`;
        expect(Number(row!.count)).toBe(1);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("post ingest", () => {
    const TICKER = "NCAAM-UCONN-ARI-M";
    const SYNCED = "2026-11-19T12:00:00Z";
    const LOCK = "2026-11-20T02:00:00Z";
    const now = new Date("2026-11-19T12:10:00Z");
    const store = () => createPostgresIngestStore(sql);

    const pick = (over: Partial<Pick> = {}): Pick => ({
      geminiEventTicker: TICKER,
      instrumentSymbol: "GEMI-UCONN",
      side: "yes",
      gameStartTime: LOCK,
      resolutionSide: null,
      resolvedAt: null,
      oddsAtTweet: null,
      ...over,
    });
    const post = (over: Partial<NewPost> = {}): NewPost => ({
      tweetId: "t1",
      xUserId: "u1",
      xHandle: "@Tipster",
      tweetedAt: "2026-11-19T12:03:00Z",
      tweetText: "UConn wins",
      sentiment: { isPrediction: true, confidence: 0.9 },
      picks: [pick()],
      ...over,
    });
    const run = (posts: NewPost[]) => ingestPosts(store(), posts, now);
    const outcomes = (r: { picks: { status: string; reason?: string }[] }) => r.picks.map((p) => p.reason ?? p.status);

    async function addMarket(ticker: string, over: { status?: string; lock?: string; synced?: string } = {}) {
      const outcomesJson = [
        { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.62, noOdds: 0.4, resolutionSide: null },
        { label: "Arizona", instrumentSymbol: "GEMI-ARI", currentOdds: 0.38, noOdds: null, resolutionSide: null },
      ];
      await sql`
        insert into markets (gemini_market_id, sport, event_name, outcomes, lock_time, status, synced_at)
        values (${ticker}, 'basketball', 'UConn vs Arizona', ${sql.json(outcomesJson)},
                ${over.lock ?? LOCK}, ${over.status ?? "open"}, ${over.synced ?? SYNCED})`;
    }
    const allCalls = () =>
      sql<{ side: string; instrument_symbol: string; odds_at_call: number | null; odds_source: string; status: string; post: string; ingest_lag_s: number }[]>`
        select c.side, c.instrument_symbol, c.odds_at_call, c.odds_source, c.status, p.tweet_id as post, c.ingest_lag_s
        from calls c join posts p on p.id = c.post_id order by c.tweeted_at`;

    beforeAll(async () => {
      await resetLocalDatabase(sql, url!);
    });
    beforeEach(async () => {
      await sql`truncate calls, posts, markets, tails, users cascade`;
      await addMarket(TICKER);
    });

    it("creates the user, the post and a priced call, and prices each side correctly", async () => {
      await addMarket("OTHER");
      const [r] = await run([
        post({
          picks: [
            pick({ side: "yes" }),
            pick({ geminiEventTicker: "OTHER", side: "no" }), // noOdds 0.4
          ],
        }),
      ]);
      expect(outcomes(r!)).toEqual(["created", "created"]);

      const calls = await allCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toMatchObject({ side: "yes", odds_at_call: 0.62, odds_source: "snapshot", status: "pending", ingest_lag_s: 420 });
      expect(calls[1]).toMatchObject({ side: "no", odds_at_call: 0.4 });

      const [u] = await sql`select x_user_id, x_handle from users`;
      expect(u).toMatchObject({ x_user_id: "u1", x_handle: "Tipster" });
      const [p] = await sql`select sentiment from posts`;
      expect(p!.sentiment).toEqual({ isPrediction: true, confidence: 0.9 });
    });

    it("derives the NO price from YES when the contract has no noOdds", async () => {
      await run([post({ picks: [pick({ instrumentSymbol: "GEMI-ARI", side: "no" })] })]);
      const [c] = await allCalls();
      expect(c!.odds_at_call).toBeCloseTo(0.62);
    });

    it("stores the call unpriced when the sync was long before the tweet, or uses a supplied price", async () => {
      await run([post({ tweetedAt: "2026-11-19T13:00:00Z" })]);
      expect((await allCalls())[0]).toMatchObject({ odds_at_call: null, odds_source: "none" });

      await sql`truncate calls, posts cascade`;
      await run([post({ tweetedAt: "2026-11-19T13:00:00Z", picks: [pick({ oddsAtTweet: 0.55 })] })]);
      expect((await allCalls())[0]).toMatchObject({ odds_at_call: 0.55, odds_source: "history" });
    });

    it("reports picks it cannot place, and stores the post regardless", async () => {
      await addMarket("VOID", { status: "void" });
      await addMarket("LOCKED", { lock: "2026-11-19T12:03:00Z" });
      const [r] = await run([
        post({
          picks: [
            pick({ geminiEventTicker: "MISSING" }),
            pick({ geminiEventTicker: "VOID" }),
            pick({ instrumentSymbol: "GEMI-NOPE" }),
            pick({ geminiEventTicker: "LOCKED" }),
          ],
        }),
      ]);
      expect(outcomes(r!)).toEqual(["no_market", "market_void", "unknown_contract", "after_lock"]);
      expect(await allCalls()).toHaveLength(0);
      expect(await sql`select 1 from posts`).toHaveLength(1);
    });

    it("is safe to re-send: same post updates its call instead of adding one", async () => {
      await run([post()]);
      const [again] = await run([post()]);
      expect(outcomes(again!)).toEqual(["updated"]);
      expect(await allCalls()).toHaveLength(1);

      // A corrected parse of the same tweet replaces the pick.
      const [fixed] = await run([post({ picks: [pick({ instrumentSymbol: "GEMI-ARI", side: "yes" })] })]);
      expect(outcomes(fixed!)).toEqual(["updated"]);
      expect((await allCalls())[0]).toMatchObject({ instrument_symbol: "GEMI-ARI", post: "t1" });
      expect(await sql`select 1 from posts`).toHaveLength(1);
    });

    it("keeps the earliest tweet: an earlier one replaces a later pending pick, a later one is a duplicate", async () => {
      await run([post({ tweetId: "late", tweetedAt: "2026-11-19T12:08:00Z" })]);
      const [early] = await run([post({ tweetId: "early", tweetedAt: "2026-11-19T12:01:00Z", picks: [pick({ side: "no" })] })]);
      expect(outcomes(early!)).toEqual(["updated"]);
      expect(await allCalls()).toMatchObject([{ post: "early", side: "no" }]);

      const [later] = await run([post({ tweetId: "later", tweetedAt: "2026-11-19T12:09:00Z" })]);
      expect(outcomes(later!)).toEqual(["skipped"].map(() => "duplicate_pick"));
      expect(await allCalls()).toMatchObject([{ post: "early" }]);
    });

    it("never changes a call that has already been scored", async () => {
      await run([post({ tweetId: "first", tweetedAt: "2026-11-19T12:05:00Z" })]);
      await sql`update calls set status = 'scored'`;
      const [r] = await run([post({ tweetId: "earlier", tweetedAt: "2026-11-19T12:01:00Z" })]);
      expect(outcomes(r!)).toEqual(["duplicate_pick"]);
      expect(await allCalls()).toMatchObject([{ post: "first", status: "scored" }]);
    });

    it("gives the same result when two requests race for the same market", async () => {
      const results = await Promise.all([
        run([post({ tweetId: "late", tweetedAt: "2026-11-19T12:08:00Z" })]),
        run([post({ tweetId: "early", tweetedAt: "2026-11-19T12:01:00Z" })]),
      ]);
      expect(results.flat().every((r) => !r.error)).toBe(true);
      expect(await allCalls()).toMatchObject([{ post: "early" }]); // exactly one call, the earlier tweet
    });

    it("refuses a tweet id that belongs to another user and leaves that user's data alone", async () => {
      await run([post()]);
      const [r] = await run([post({ xUserId: "u2", xHandle: "impostor" })]);
      expect(r).toMatchObject({ postId: null, error: expect.stringContaining("another user") });
      expect((await allCalls())[0]).toMatchObject({ post: "t1" });
    });

    it("follows a handle change, and rolls back a post that fails without affecting the others", async () => {
      await run([post()]);
      await run([post({ tweetId: "t2", xHandle: "Renamed" })]);
      expect(await sql`select x_handle from users where x_user_id = 'u1'`).toMatchObject([{ x_handle: "Renamed" }]);

      // u3 tries to take a handle that u1 owns: unique violation, so that whole post rolls back.
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const results = await ingestPosts(store(), [
        post({ tweetId: "t3", xUserId: "u3", xHandle: "renamed" }),
        post({ tweetId: "t4", xUserId: "u4", xHandle: "Fine", picks: [] }),
      ], now, () => {});
      errors.mockRestore();
      expect(results[0]).toMatchObject({ postId: null, error: "could not store post" });
      expect(results[1]!.error).toBeUndefined();
      expect(await sql`select 1 from users where x_user_id = 'u3'`).toHaveLength(0);
      expect(await sql`select 1 from posts where tweet_id = 't3'`).toHaveLength(0);
    });
  });

  describe("scoring worker", () => {
    const LOCK = "2026-11-20T02:00:00Z";
    const SYNCED = "2026-11-19T12:00:00Z";
    const TWEET = "2026-11-19T12:03:00Z";
    const INGEST_NOW = new Date("2026-11-19T12:10:00Z");
    const WORKER_NOW = new Date("2026-11-21T00:00:00Z");
    const workerStore = () => createPostgresWorkerStore(sql);
    const run = (now: Date = WORKER_NOW) => runWorker(workerStore(), now);
    const later = (minutes: number) => new Date(WORKER_NOW.getTime() + minutes * 60_000);

    const contracts = (result: "yes" | "no" | null) => [
      { label: "UConn", instrumentSymbol: "GEMI-UCONN", currentOdds: 0.6, noOdds: 0.4, resolutionSide: result },
    ];

    async function market(ticker: string, status = "open") {
      await sql`
        insert into markets (gemini_market_id, sport, event_name, outcomes, lock_time, status, synced_at)
        values (${ticker}, 'basketball', ${ticker}, ${sql.json(contracts(null))}, ${LOCK}, ${status}, ${SYNCED})`;
    }
    /** The market finishes: the contract resolves yes or no (null leaves its result unknown). */
    const finish = (ticker: string, result: "yes" | "no" | null, status = "resolved") =>
      sql`update markets set status = ${status}, outcomes = ${sql.json(contracts(result))} where gemini_market_id = ${ticker}`;

    /** A user picks one market through the real ingest path. */
    async function pick(user: string, tweetId: string, ticker: string, side: "yes" | "no", over: Partial<Pick> = {}) {
      const [r] = await ingestPosts(createPostgresIngestStore(sql), [{
        tweetId,
        xUserId: `x-${user}`,
        xHandle: user,
        tweetedAt: TWEET,
        tweetText: "pick",
        sentiment: null,
        picks: [{
          geminiEventTicker: ticker,
          instrumentSymbol: "GEMI-UCONN",
          side,
          gameStartTime: LOCK,
          resolutionSide: null,
          resolvedAt: null,
          oddsAtTweet: null,
          ...over,
        }],
      }], INGEST_NOW);
      expect(r!.picks[0]!.status).toBe("created");
    }

    beforeAll(async () => {
      await resetLocalDatabase(sql, url!);
    });
    beforeEach(async () => {
      await sql`truncate calls, posts, markets, tails, user_scores, score_snapshots, users cascade`;
    });

    it("settles real ingested picks and scores the user exactly as the shared library does", async () => {
      // yes/yes win, yes/no loss, no/no win, no/yes loss, yes/yes win, yes/no loss
      const plan: [string, "yes" | "no", "yes" | "no"][] = [
        ["M1", "yes", "yes"], ["M2", "yes", "no"], ["M3", "no", "no"],
        ["M4", "no", "yes"], ["M5", "yes", "yes"], ["M6", "yes", "no"],
      ];
      for (const [i, [ticker, side]] of plan.entries()) {
        await market(ticker);
        await pick("Tipster", `t${i}`, ticker, side);
      }
      for (const [ticker, , result] of plan) await finish(ticker, result);

      const summary = await run();
      expect(summary).toEqual({ settled: 6, voided: 0, unsettleable: 0, usersUpdated: 1, handles: ["tipster"] });

      const calls = await sql<{ side: string; status: string; points: number }[]>`select side, status, points from calls order by tweeted_at, id`;
      expect(calls.every((c) => c.status === "scored")).toBe(true);
      expect(calls.map((c) => Math.round(c.points * 100) / 100).sort((x, y) => x - y)).toEqual([-0.6, -0.6, -0.4, 0.4, 0.4, 0.6]);

      const expected = computeUserScore([
        { oddsAtCall: 0.6, won: true }, { oddsAtCall: 0.6, won: false }, { oddsAtCall: 0.4, won: true },
        { oddsAtCall: 0.4, won: false }, { oddsAtCall: 0.6, won: true }, { oddsAtCall: 0.6, won: false },
      ]);
      const [row] = await sql`select * from user_scores`;
      expect(row).toMatchObject({ score: expected.score, n_resolved: 6, n_wins: 3, hit_rate: 0.5, score_change_14d: null });
      expect(row!.skill).toBeCloseTo(expected.skill);

      // The snapshot is what the on-chain badge will read: its hash must match its calls.
      const [snap] = await sql<{ id: string; score: number; call_ids: string[]; inputs_hash: string }[]>`select * from score_snapshots`;
      expect(snap).toMatchObject({ score: expected.score });
      expect(row!.snapshot_id).toBe(snap!.id);
      const scored = await sql<{ id: string; points: number }[]>`select id, points from calls where id = any(${snap!.call_ids}::uuid[])`;
      expect(scored).toHaveLength(6);
      expect(snap!.inputs_hash).toBe(inputsHash(scored));
    });

    it("shows the new score through the API, and a settled user appears on the leaderboard", async () => {
      for (let i = 1; i <= 5; i++) {
        await market(`W${i}`);
        await pick("Winner", `w${i}`, `W${i}`, "yes");
        await finish(`W${i}`, "yes");
      }
      await run();
      const app = createApp({ store: createPostgresStore(sql) });
      const badge = (await (await app.request("/v1/badges?handles=winner")).json()).winner;
      expect(badge).toMatchObject({ tier: "scored", nResolved: 5, hitRate: 1 });
      expect(badge.score).toBeGreaterThan(50);
      const board = await (await app.request("/v1/leaderboard")).json();
      expect(board.map((e: { handle: string }) => e.handle)).toEqual(["winner"]);
    });

    it("scores unpriced calls without points and keeps them out of the score", async () => {
      await market("PRICED");
      await market("UNPRICED");
      await pick("mix", "p1", "PRICED", "yes");
      await pick("mix", "p2", "UNPRICED", "yes", { oddsAtTweet: null });
      await sql`update calls set odds_at_call = null, odds_source = 'none' where picked_outcome = 'UConn' and market_id = (select id from markets where gemini_market_id = 'UNPRICED')`;
      await finish("PRICED", "yes");
      await finish("UNPRICED", "yes");

      await run();
      const calls = await sql<{ market: string; status: string; points: number | null }[]>`
        select m.gemini_market_id as market, c.status, c.points from calls c join markets m on m.id = c.market_id order by 1`;
      expect(calls).toMatchObject([{ market: "PRICED", status: "scored", points: 0.4 }, { market: "UNPRICED", status: "scored", points: null }]);
      expect((await sql`select n_resolved, n_wins from user_scores`)[0]).toMatchObject({ n_resolved: 1, n_wins: 1 });
    });

    it("gives a user with only unpriced picks a New-badge row at score 50", async () => {
      await market("U");
      await pick("backfill", "b1", "U", "yes");
      await sql`update calls set odds_at_call = null, odds_source = 'none'`;
      await finish("U", "yes");
      await run();
      expect((await sql`select score, n_resolved, hit_rate from user_scores`)[0]).toMatchObject({ score: 50, n_resolved: 0, hit_rate: null });
      const app = createApp({ store: createPostgresStore(sql) });
      expect((await (await app.request("/v1/badges?handles=backfill")).json()).backfill).toMatchObject({ tier: "new" });
    });

    it("voids calls on a void market and leaves calls it cannot judge pending", async () => {
      await market("VOID");
      await market("NORESULT");
      await market("STILLOPEN");
      await pick("u", "v1", "VOID", "yes");
      await pick("u2", "n1", "NORESULT", "yes");
      await pick("u3", "o1", "STILLOPEN", "yes");
      await finish("VOID", null, "void");
      await finish("NORESULT", null); // resolved, but the contract has no result stored
      const summary = await run();
      expect(summary).toMatchObject({ settled: 0, voided: 1, unsettleable: 1, usersUpdated: 0 });
      const statuses = await sql<{ m: string; status: string }[]>`select m.gemini_market_id as m, c.status from calls c join markets m on m.id = c.market_id order by 1`;
      expect(statuses).toEqual([
        { m: "NORESULT", status: "pending" },
        { m: "STILLOPEN", status: "pending" },
        { m: "VOID", status: "void" },
      ]);
      expect(await sql`select 1 from user_scores`).toHaveLength(0);

      // Once the result arrives, the next run settles it.
      await finish("NORESULT", "yes");
      expect(await run()).toMatchObject({ settled: 1, unsettleable: 0 });
    });

    it("serves the call ledger: every kind of call, newest first, with results and links", async () => {
      // A market for each situation. Tweets are a minute apart: the order is clear, and every
      // one stays within the 10-minute window in which a pick can be priced from the synced market.
      const at = (n: number) => new Date(Date.parse(TWEET) + n * 60_000).toISOString();
      for (const t of ["WON", "LOST", "VOIDED", "WAITING", "NOPRICE"]) await market(t);
      const ingest = async (n: number, ticker: string, side: "yes" | "no") => {
        const [r] = await ingestPosts(createPostgresIngestStore(sql), [{
          tweetId: `led${n}`, xUserId: "x-led", xHandle: "Ledger", tweetedAt: at(n), tweetText: "pick", sentiment: null,
          picks: [{ geminiEventTicker: ticker, instrumentSymbol: "GEMI-UCONN", side, gameStartTime: LOCK, resolutionSide: null, resolvedAt: null, oddsAtTweet: null }],
        }], new Date(at(n)));
        expect(r!.picks[0]!.status).toBe("created");
      };
      await ingest(0, "WON", "yes");
      await ingest(1, "LOST", "yes");
      await ingest(2, "VOIDED", "yes");
      await ingest(3, "WAITING", "yes");
      await ingest(4, "NOPRICE", "no");
      await sql`update calls set odds_at_call = null, odds_source = 'none'
                where market_id = (select id from markets where gemini_market_id = 'NOPRICE')`;
      await finish("WON", "yes");
      await finish("LOST", "no");
      await finish("VOIDED", null, "void");
      await finish("NOPRICE", "no");
      await run();

      const app = createApp({ store: createPostgresStore(sql), calls: createPostgresCallsStore(sql) });
      const ledger = await (await app.request("/v1/users/ledger/calls")).json();
      expect(ledger.map((c: { eventName: string }) => c.eventName)).toEqual(["NOPRICE", "WAITING", "VOIDED", "LOST", "WON"]); // newest first
      const by = Object.fromEntries(ledger.map((c: { eventName: string }) => [c.eventName, c]));
      expect(by.WON).toMatchObject({ status: "scored", result: "won", oddsAtCall: 0.6, oddsSource: "snapshot", tweetId: "led0", tweetText: "pick", side: "yes", pickLabel: "UConn" });
      expect(by.WON.points).toBeCloseTo(0.4);
      expect(by.LOST).toMatchObject({ status: "scored", result: "lost" });
      expect(by.LOST.points).toBeCloseTo(-0.6);
      expect(by.VOIDED).toMatchObject({ status: "void", result: null, points: null });
      expect(by.WAITING).toMatchObject({ status: "pending", result: null, points: null });
      expect(by.NOPRICE).toMatchObject({ status: "scored", result: "won", oddsAtCall: null, oddsSource: "none", points: null, side: "no" });

      // limit and status filters, and an unknown user
      expect((await (await app.request("/v1/users/ledger/calls?limit=2")).json()).map((c: { eventName: string }) => c.eventName)).toEqual(["NOPRICE", "WAITING"]);
      const pending = await (await app.request("/v1/users/ledger/calls?status=pending,void")).json();
      expect(pending.map((c: { eventName: string }) => c.eventName)).toEqual(["WAITING", "VOIDED"]);
      expect((await app.request("/v1/users/nobody/calls")).status).toBe(404);
      expect(await (await app.request("/v1/users/LEDGER/calls?limit=1")).json()).toHaveLength(1); // case-insensitive
    });

    it("settles a pick that was ingested after its market had already resolved (a backfill)", async () => {
      await market("DONE", "resolved");
      await finish("DONE", "yes"); // resolved long before the pick arrives
      await pick("late", "l1", "DONE", "yes");
      expect((await sql`select odds_source, status from calls`)[0]).toMatchObject({ odds_source: "none", status: "pending" });

      expect(await run()).toMatchObject({ settled: 1, usersUpdated: 1, handles: ["late"] });
      expect((await sql`select status, points from calls`)[0]).toMatchObject({ status: "scored", points: null });
    });

    it("does nothing the second time, and adds a snapshot only when something new settled", async () => {
      await market("A");
      await pick("u", "a1", "A", "yes");
      await finish("A", "yes");
      await run();
      expect(await run()).toEqual({ settled: 0, voided: 0, unsettleable: 0, usersUpdated: 0, handles: [] });
      expect(await sql`select 1 from score_snapshots`).toHaveLength(1);

      await market("B");
      await pick("u", "b1", "B", "yes");
      await finish("B", "no");
      expect(await run(later(5))).toMatchObject({ settled: 1, usersUpdated: 1 }); // the next scheduled run
      expect(await sql`select 1 from score_snapshots`).toHaveLength(2);
      const [row] = await sql<{ n_resolved: number; snapshot_id: string }[]>`select n_resolved, snapshot_id from user_scores`;
      expect(row!.n_resolved).toBe(2);
      const [latest] = await sql<{ id: string }[]>`select id from score_snapshots order by computed_at desc, id limit 1`;
      expect(row!.snapshot_id).toBe(latest!.id);
    });

    it("measures the 14-day change from an older snapshot", async () => {
      await market("A");
      await pick("u", "a1", "A", "yes");
      const [u] = await sql<{ id: string }[]>`select id from users where x_handle = 'u'`;
      const id = u!.id;
      await sql`insert into score_snapshots (user_id, score, inputs_hash, computed_at) values (${id}, 40, repeat('0', 64), '2026-11-01T00:00:00Z')`;
      await finish("A", "yes");
      await run();
      const [row] = await sql<{ score: number; score_change_14d: number }[]>`select score, score_change_14d from user_scores`;
      expect(row!.score_change_14d).toBe(row!.score - 40);
    });

    it("scores each call once when two runs overlap", async () => {
      for (let i = 1; i <= 4; i++) {
        await market(`C${i}`);
        await pick(`user${i}`, `c${i}`, `C${i}`, "yes");
        await finish(`C${i}`, "yes");
      }
      const results = await Promise.all([run(), run(), run()]);
      expect(results.reduce((n, r) => n + (r?.settled ?? 0), 0)).toBe(4);
      expect(await sql`select 1 from score_snapshots`).toHaveLength(4); // one per user, not one per run
      expect(await sql`select 1 from user_scores`).toHaveLength(4);
      expect(await sql`select 1 from calls where status = 'scored'`).toHaveLength(4);
    });

    it("rolls everything back if a run fails partway", async () => {
      await market("A");
      await pick("u", "a1", "A", "yes");
      await finish("A", "yes");
      const failing: WorkerStore = {
        transaction: (fn) =>
          workerStore().transaction(async (db) =>
            fn({ ...db, upsertUserScore: async () => { throw new Error("boom"); } }),
          ),
      };
      await expect(runWorker(failing, WORKER_NOW)).rejects.toThrow("boom");
      expect((await sql`select status from calls`)[0]).toMatchObject({ status: "pending" });
      expect(await sql`select 1 from score_snapshots`).toHaveLength(0);
      expect(await run()).toMatchObject({ settled: 1 }); // and a later run succeeds
    });
  });

  describe("migrate", () => {
    let dir: string;
    const file = (name: string, body: string) => writeFile(join(dir, name), body);

    beforeEach(async () => {
      dir = (await mkdtemp(join(tmpdir(), "migrations-"))) + "/";
      await sql.unsafe("drop schema public cascade; create schema public;");
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("applies files in order, once, and records them", async () => {
      await file("002_b.sql", "create table b (id int primary key);");
      await file("001_a.sql", "create table a (id int primary key);");

      expect((await migrationStatus(sql, dir)).pending).toEqual(["001_a.sql", "002_b.sql"]);
      expect(await migrate(sql, dir)).toEqual(["001_a.sql", "002_b.sql"]);
      expect(await migrate(sql, dir)).toEqual([]); // second run is a no-op
      expect(await migrationStatus(sql, dir)).toEqual({
        applied: ["001_a.sql", "002_b.sql"],
        pending: [],
      });
    });

    it("applies only new files after earlier ones are in", async () => {
      await file("001_a.sql", "create table a (id int primary key);");
      await migrate(sql, dir);
      await file("002_b.sql", "create table b (id int primary key);");
      expect(await migrate(sql, dir)).toEqual(["002_b.sql"]);
    });

    it("refuses when an applied file was edited", async () => {
      await file("001_a.sql", "create table a (id int primary key);");
      await migrate(sql, dir);
      await file("001_a.sql", "create table a (id int primary key, extra text);");
      await expect(migrate(sql, dir)).rejects.toThrow(/edited after it was applied/);
    });

    it("rolls everything back when a file fails", async () => {
      await file("001_a.sql", "create table a (id int primary key);");
      await file("002_bad.sql", "create table b (id int primary key); select * from missing_table;");
      await expect(migrate(sql, dir)).rejects.toThrow();
      const [row] = await sql<{ a: boolean; b: boolean }[]>`
        select to_regclass('public.a') is not null as a, to_regclass('public.b') is not null as b`;
      expect(row).toEqual({ a: false, b: false });
      expect((await migrationStatus(sql, dir)).applied).toEqual([]);
    });

    it("serialises two runs at once", async () => {
      await file("001_a.sql", "create table a (id int primary key);");
      const results = await Promise.all([migrate(sql, dir), migrate(sql, dir)]);
      expect(results.flat()).toEqual(["001_a.sql"]); // exactly one of them applied it
    });
  });
});
