/**
 * How many database connections one service may open. Supabase's session pooler allows 15 for the
 * whole project, shared by every service every teammate runs, so each service keeps a small pool
 * (override with DB_POOL_MAX). postgres.js opens connections only when needed.
 */
export const DEFAULT_DB_POOL_MAX = 3;

/** Reads a DB_POOL_MAX value: a positive whole number, else the default. */
export function dbPoolMax(raw: string | undefined, fallback: number = DEFAULT_DB_POOL_MAX): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw.trim());
  return n >= 1 ? n : fallback;
}
