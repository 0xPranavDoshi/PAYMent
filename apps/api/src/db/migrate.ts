import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../supabase/migrations/", import.meta.url),
);

/** Arbitrary constant; whoever holds it is the only one migrating. */
const MIGRATION_LOCK_ID = 7_203_411;

export interface MigrationStatus {
  applied: string[];
  pending: string[];
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function readMigrations(dir: string): Promise<{ name: string; sql: string; checksum: string }[]> {
  const names = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(dir + name, "utf8");
      return { name, sql, checksum: sha256(sql) };
    }),
  );
}

async function ensureTable(sql: postgres.Sql | postgres.TransactionSql) {
  await sql`
    create table if not exists schema_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )`;
  // Same posture as the app tables: only the service role touches it.
  await sql`alter table schema_migrations enable row level security`;
}

/**
 * Applies the migration files that have not been applied yet, in name order,
 * all in one transaction (so a failure leaves nothing half-applied). Safe to run
 * repeatedly and on a shared database. Never drops anything. Refuses to continue
 * if a file that was already applied has been edited since.
 */
export async function migrate(sql: postgres.Sql, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = await readMigrations(dir);
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_ID})`;
    await ensureTable(tx);

    const rows = await tx<{ name: string; checksum: string }[]>`select name, checksum from schema_migrations`;
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    const done: string[] = [];
    for (const file of files) {
      const recorded = applied.get(file.name);
      if (recorded !== undefined) {
        if (recorded !== file.checksum) {
          throw new Error(
            `${file.name} was edited after it was applied. Add a new migration instead of changing an old one.`,
          );
        }
        continue;
      }
      await tx.unsafe(file.sql);
      await tx`insert into schema_migrations (name, checksum) values (${file.name}, ${file.checksum})`;
      done.push(file.name);
    }
    return done;
  });
}

export async function migrationStatus(
  sql: postgres.Sql,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationStatus> {
  const files = await readMigrations(dir);
  const [exists] = await sql<{ present: boolean }[]>`select to_regclass('public.schema_migrations') is not null as present`;
  const applied = exists?.present
    ? (await sql<{ name: string }[]>`select name from schema_migrations order by name`).map((r) => r.name)
    : [];
  return {
    applied,
    pending: files.map((f) => f.name).filter((n) => !applied.includes(n)),
  };
}

export function isLocalDatabase(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/** Drops everything in the public schema and re-applies the migrations. Refuses non-local databases. */
export async function resetLocalDatabase(sql: postgres.Sql, url: string): Promise<string[]> {
  if (!isLocalDatabase(url)) {
    throw new Error("Refusing to reset a database that is not on localhost.");
  }
  await sql.unsafe("drop schema public cascade; create schema public;");
  return migrate(sql);
}
