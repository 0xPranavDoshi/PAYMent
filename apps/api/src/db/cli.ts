import { connect, describeHost } from "./client.js";
import { isLocalDatabase, migrate, migrationStatus, resetLocalDatabase } from "./migrate.js";
import { seedDemoData } from "./seed.js";

// Usage: tsx src/db/cli.ts <migrate | status | reset | seed [--allow-remote]> ...
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const args = process.argv.slice(2);
const allowRemote = args.includes("--allow-remote");
const sql = connect(url, { onnotice: () => {} });

try {
  console.log(`database: ${describeHost(url)}${isLocalDatabase(url) ? " (local)" : ""}`);
  for (const command of args.filter((a) => !a.startsWith("--"))) {
    if (command === "migrate") {
      const done = await migrate(sql);
      console.log(done.length ? `applied: ${done.join(", ")}` : "up to date, nothing to apply");
    } else if (command === "status") {
      const { applied, pending } = await migrationStatus(sql);
      console.log(`applied: ${applied.join(", ") || "(none)"}`);
      console.log(`pending: ${pending.join(", ") || "(none)"}`);
    } else if (command === "reset") {
      const files = await resetLocalDatabase(sql, url);
      console.log(`reset: applied ${files.join(", ")}`);
    } else if (command === "seed") {
      if (!isLocalDatabase(url) && !allowRemote) {
        throw new Error("seed on a remote database needs --allow-remote (it replaces the demo_ users).");
      }
      console.table(await seedDemoData(sql));
    } else {
      throw new Error(`unknown command "${command}" (use migrate, status, reset or seed)`);
    }
  }
} finally {
  await sql.end();
}
