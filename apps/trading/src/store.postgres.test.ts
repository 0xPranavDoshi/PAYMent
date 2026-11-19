import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresStore } from "./store.postgres.js";
import type { TradingStore } from "./store.js";

// Runs only against a local database: TEST_DATABASE_URL=postgres://postgres@localhost:5432/copayme_test
// It works in its own schema (trading_it), so it cannot disturb other tests on the same database.
const url = process.env.TEST_DATABASE_URL;
const local = url ? ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname) : false;
const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));
const SCHEMA = "trading_it";

describe.skipIf(!url || !local)("trading store against a real Postgres", () => {
  const sql = postgres(url ?? "postgres://unused@localhost/unused", {
    onnotice: () => {},
    connection: { search_path: SCHEMA },
  });
  let store: TradingStore;
  let callId: string;
  let followerA: string;
  let followerB: string;

  beforeAll(async () => {
    const admin = postgres(url!, { onnotice: () => {} });
    await admin.unsafe(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA};`);
    await admin.end();
    for (const file of (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort()) {
      await sql.unsafe(await readFile(MIGRATIONS + file, "utf8"));
    }
    store = createPostgresStore(sql);
  });
  afterAll(async () => {
    await sql.unsafe(`drop schema if exists ${SCHEMA} cascade`);
    await sql.end();
  });

  beforeEach(async () => {
    await sql`truncate tails, calls, posts, markets, users cascade`;
    const ids = await sql<{ id: string }[]>`
      insert into users (x_user_id, x_handle) values ('t', 'trader'), ('a', 'follower_a'), ('b', 'follower_b') returning id`;
    const traderId = ids[0]!.id;
    followerA = ids[1]!.id;
    followerB = ids[2]!.id;
    const [m] = await sql<{ id: string }[]>`
      insert into markets (gemini_market_id, sport, event_name, lock_time)
      values ('M', 'basketball', 'g', now() + interval '1 day') returning id`;
    const [p] = await sql<{ id: string }[]>`
      insert into posts (tweet_id, user_id, tweeted_at, tweet_text) values ('t1', ${traderId}, now() - interval '1 minute', 'x') returning id`;
    const [c] = await sql<{ id: string }[]>`
      insert into calls (post_id, user_id, market_id, picked_outcome, instrument_symbol, side, tweeted_at, odds_at_call, odds_source)
      values (${p!.id}, ${traderId}, ${m!.id}, 'Team', 'GEMI-X', 'yes', now() - interval '1 minute', 0.5, 'snapshot') returning id`;
    callId = c!.id;
  });

  const claim = (followerId: string, source: "watch" | "copy", mode: "paper" | "live" = source === "watch" ? "paper" : "live") =>
    store.claimAutoTail({
      followerId,
      callId,
      mode,
      amountUsdc: 1,
      entryOdds: 0.5,
      geminiOrderId: null,
      status: "open",
      pnlUsdc: null,
      source,
    });

  it("gives an automatic tail to the first claim and nothing to the second", async () => {
    const first = await claim(followerA, "copy");
    expect(first).toMatchObject({ followerId: followerA, source: "copy", status: "open" });
    expect(await claim(followerA, "copy")).toBeNull();
    expect(await sql`select 1 from tails`).toHaveLength(1);
  });

  it("allows one watch and one copy per follower, and separate followers", async () => {
    expect(await claim(followerA, "watch")).not.toBeNull();
    expect(await claim(followerA, "copy")).not.toBeNull();
    expect(await claim(followerB, "copy")).not.toBeNull();
    expect(await claim(followerA, "watch")).toBeNull();
  });

  it("lets exactly one of many concurrent claims win", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => claim(followerA, "copy")));
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await sql`select 1 from tails`).toHaveLength(1);
  });

  it("does not limit manual tails: a user may tail the same call twice", async () => {
    for (let i = 0; i < 2; i++) {
      await store.createTail({
        followerId: followerA,
        callId,
        mode: "paper",
        amountUsdc: 5,
        entryOdds: 0.5,
        geminiOrderId: null,
        status: "open",
        pnlUsdc: null,
      });
    }
    expect(await sql`select 1 from tails where source = 'manual'`).toHaveLength(2);
  });

  it("updates only the fields it is given", async () => {
    const tail = (await claim(followerA, "copy"))!;
    await store.updateTail(tail.id, { geminiOrderId: "ord-1", status: "filled" });
    expect(await store.getTail(tail.id)).toMatchObject({ geminiOrderId: "ord-1", status: "filled", pnlUsdc: null });
    await store.updateTail(tail.id, { pnlUsdc: 2.5 });
    expect(await store.getTail(tail.id)).toMatchObject({ geminiOrderId: "ord-1", status: "filled", pnlUsdc: 2.5 });
    await store.updateTail(tail.id, {}); // no-op, must not throw
  });

  it("does not count a cancelled (failed) copy order as a trade", async () => {
    await store.upsertCopyTrade(followerA, "trader", 10);
    const tail = (await claim(followerA, "copy"))!;
    expect((await store.listCopyTrades(followerA))[0]).toMatchObject({ nTrades: 1 });

    await store.updateTail(tail.id, { status: "cancelled" });
    expect((await store.listCopyTrades(followerA))[0]).toMatchObject({ nTrades: 0 });
    expect(await store.updateCopyTrade(followerA, "trader", { amountUsdc: 20 })).toMatchObject({ nTrades: 0 });
  });
});
