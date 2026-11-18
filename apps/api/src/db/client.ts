import postgres from "postgres";
import { isLocalDatabase } from "./migrate.js";

/** Connects to DATABASE_URL, requiring TLS for anything that is not localhost (Supabase). */
export function connect(url: string, options: postgres.Options<{}> = {}): postgres.Sql {
  return postgres(url, { ssl: isLocalDatabase(url) ? false : "require", ...options });
}

/** Host only, for logs. Never print the full URL: it contains the password. */
export function describeHost(url: string): string {
  const u = new URL(url);
  return `${u.hostname}:${u.port || "5432"}`;
}
