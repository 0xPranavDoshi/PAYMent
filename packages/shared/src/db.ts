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

/**
 * Seconds a connection may sit unused before the service closes it. The database library's own default
 * is never, so every service kept its whole pool open all day. Closed connections reopen on the next
 * query, so this only gives slots back while a service is quiet.
 */
export const DEFAULT_DB_IDLE_TIMEOUT_S = 30;

/** Reads a DB_IDLE_TIMEOUT_S value: whole seconds, 0 to never close idle connections, else the default. */
export function dbIdleTimeout(raw: string | undefined, fallback: number = DEFAULT_DB_IDLE_TIMEOUT_S): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return fallback;
  return Number(raw.trim());
}
