import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { connect } from "./db/client.js";
import { createPostgresIngestStore } from "./ingest.postgres.js";
import { createPostgresStore } from "./store.postgres.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const sql = connect(databaseUrl);
const serviceKey = process.env.SCORING_SERVICE_KEY;
if (!serviceKey) console.warn("SCORING_SERVICE_KEY is not set: POST /v1/posts is switched off.");

const app = createApp({
  store: createPostgresStore(sql),
  ingest: createPostgresIngestStore(sql),
  serviceKey,
});
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`coPAYMe API listening on http://localhost:${info.port}`);
});
