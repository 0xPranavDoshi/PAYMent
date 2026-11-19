import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { connect } from "./db/client.js";
import { createPostgresIngestStore } from "./ingest.postgres.js";
import { createTradingNotifier } from "./notify.js";
import { createPostgresStore } from "./store.postgres.js";
import { createWorker } from "./worker.js";
import { createPostgresWorkerStore } from "./worker.postgres.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (see .env.example).");
  process.exit(1);
}

const sql = connect(databaseUrl);
const serviceKey = process.env.SCORING_SERVICE_KEY;
if (!serviceKey) console.warn("SCORING_SERVICE_KEY is not set: POST /v1/posts is switched off.");

const tradingUrl = process.env.TRADING_URL;
const tradingKey = process.env.TRADING_SERVICE_KEY;
if (!tradingUrl || !tradingKey) {
  console.warn("TRADING_URL or TRADING_SERVICE_KEY is not set: new picks will not trigger watches or copy trades.");
}

// The worker rescores users, then drops their cached badges so the next lookup is fresh.
// `app` is created just below; the callback only runs later, once it exists.
const worker = createWorker({
  store: createPostgresWorkerStore(sql),
  evict: (handles) => app.evictBadges(handles),
  intervalMs: Number(process.env.WORKER_INTERVAL_S ?? 300) * 1000,
});

const app = createApp({
  worker,
  store: createPostgresStore(sql),
  ingest: createPostgresIngestStore(sql),
  serviceKey,
  notifyNewCall:
    tradingUrl && tradingKey ? createTradingNotifier({ url: tradingUrl, serviceKey: tradingKey }) : undefined,
});
const port = Number(process.env.PORT ?? 8787);

if (process.env.WORKER_ENABLED === "false") {
  console.log("Scoring worker is off (WORKER_ENABLED=false). POST /v1/worker/run still works.");
} else {
  worker.start();
}

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`coPAYMe API listening on http://localhost:${info.port}`);
});
