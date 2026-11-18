import { serve } from "@hono/node-server";
import postgres from "postgres";
import { createApp } from "./app.js";
import { createForwarder, noopForwarder } from "./forward.js";
import { createGeminiClient } from "./gemini/client.js";
import { createGrok } from "./grok/client.js";
import { createApifySource } from "./posts/apify.js";
import { runScan, type ScanDeps } from "./scan.js";
import { createPostgresStore } from "./store.postgres.js";

const env = process.env;
const missing = ["DATABASE_URL", "APIFY_TOKEN", "XAI_API_KEY"].filter((k) => !env[k]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")} (see .env.example).`);
  process.exit(1);
}

const store = createPostgresStore(postgres(env.DATABASE_URL as string));
const gemini = createGeminiClient();
const model = env.XAI_MODEL || "grok-4-1-fast-reasoning";

let forwarder = noopForwarder;
if (env.SCOUT_FORWARD_ENABLED === "true") {
  if (!env.INGEST_URL || !env.INGEST_SERVICE_KEY) {
    console.error("SCOUT_FORWARD_ENABLED=true requires INGEST_URL and INGEST_SERVICE_KEY.");
    process.exit(1);
  }
  forwarder = createForwarder({ url: env.INGEST_URL, serviceKey: env.INGEST_SERVICE_KEY, store, gemini });
}

const scanDeps: ScanDeps = {
  store,
  source: createApifySource({
    token: env.APIFY_TOKEN as string,
    ...(env.APIFY_ACTOR_ID ? { actorId: env.APIFY_ACTOR_ID } : {}),
  }),
  grok: createGrok({ apiKey: env.XAI_API_KEY as string, model }),
  gemini,
  forwarder,
  model,
};

const app = createApp({
  store,
  startScan: (handle) => {
    void runScan(handle, scanDeps).catch((e) => console.error(`[scout] scan crashed for ${handle}:`, e));
  },
  dailyNewHandles: Number(env.SCOUT_DAILY_NEW_HANDLES ?? 30),
  ...(env.SCOUT_ALLOWED_ORIGIN ? { allowedOrigin: env.SCOUT_ALLOWED_ORIGIN } : {}),
});

serve({ fetch: app.fetch, port: Number(env.SCOUT_PORT ?? 8789) }, (info) => {
  console.log(`coPAYMe scout listening on http://localhost:${info.port}`);
});
