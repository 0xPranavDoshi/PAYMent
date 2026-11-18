import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { connect } from "./db/client.js";
import { createPostgresStore } from "./store.postgres.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const app = createApp({ store: createPostgresStore(connect(databaseUrl)) });
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`coPAYMe API listening on http://localhost:${info.port}`);
});
