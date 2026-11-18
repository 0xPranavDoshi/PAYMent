import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { copyFile, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS_DIR, isLocalDatabase, migrate, migrationStatus, resetLocalDatabase } from "./migrate.js";
import { DEMO_USERS, seedDemoData } from "./seed.js";
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
