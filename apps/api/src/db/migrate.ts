import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));

/** Applies every supabase/migrations/*.sql file in name order. Only meant for a fresh database. */
export async function applyMigrations(sql: postgres.Sql): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await sql.unsafe(await readFile(MIGRATIONS_DIR + file, "utf8"));
  }
  return files;
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
  return applyMigrations(sql);
}
