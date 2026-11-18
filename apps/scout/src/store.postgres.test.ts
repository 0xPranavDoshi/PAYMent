import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isLocalDatabase, resetLocalDatabase } from "../test/db.js";
import { describeStore } from "../test/store-suite.js";
import { createPostgresStore } from "./store.postgres.js";

// Runs only against a local database: TEST_DATABASE_URL=postgres://postgres@localhost:5432/copayme_test
// It wipes the public schema, so it refuses anything that is not on localhost.
const url = process.env.TEST_DATABASE_URL;

describe("isLocalDatabase", () => {
  it("only accepts localhost", () => {
    expect(isLocalDatabase("postgres://u:p@localhost:5432/db")).toBe(true);
    expect(isLocalDatabase("postgres://u:p@db.abcd.supabase.co:5432/postgres")).toBe(false);
  });
});

describe.skipIf(!url)("postgres store", () => {
  const sql = postgres(url ?? "postgres://unused@localhost/unused", { onnotice: () => {} });

  beforeAll(() => resetLocalDatabase(sql, url!));
  beforeEach(async () => {
    await sql`truncate scout_handles, scout_posts`;
    await sql`delete from markets`;
  });
  afterAll(() => sql.end());

  describeStore(() => createPostgresStore(sql));

  it("upsertMarket leaves one row with the latest status", async () => {
    const store = createPostgresStore(sql);
    const base = {
      geminiMarketId: "474538",
      sport: "basketball",
      eventName: "A vs B",
      outcomes: [{ label: "A", instrumentSymbol: "GEMI-A", currentOdds: 0.5 }],
      lockTime: new Date("2026-11-20T00:00:00Z"),
    };
    const resolvedAt = new Date("2026-11-21T00:00:00Z");
    await store.upsertMarket({ ...base, status: "open", winningOutcome: null, resolvedAt: null });
    await store.upsertMarket({ ...base, status: "resolved", winningOutcome: "A", resolvedAt });
    const rows = await sql`select * from markets`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      gemini_market_id: "474538",
      sport: "basketball",
      event_name: "A vs B",
      status: "resolved",
      winning_outcome: "A",
      outcomes: base.outcomes,
    });
    expect(rows[0]?.resolved_at).toEqual(resolvedAt);
  });
});
