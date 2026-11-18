import postgres from "postgres";
import { resetLocalDatabase } from "./migrate.js";
import { seedDemoData } from "./seed.js";

// Usage: tsx src/db/cli.ts reset seed
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => {} });
try {
  for (const command of process.argv.slice(2)) {
    if (command === "reset") {
      const files = await resetLocalDatabase(sql, url);
      console.log(`reset: applied ${files.join(", ")}`);
    } else if (command === "seed") {
      console.table(await seedDemoData(sql));
    } else {
      throw new Error(`unknown command "${command}" (use reset or seed)`);
    }
  }
} finally {
  await sql.end();
}
