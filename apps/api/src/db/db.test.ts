import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLocalDatabase, migrate, migrationStatus, resetLocalDatabase } from "./migrate.js";
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
