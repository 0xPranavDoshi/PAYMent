import { serve } from "@hono/node-server";
import postgres from "postgres";
import { createApp } from "./app.js";
import { positiveIntOr } from "./env.js";
import { createForwarder, noopForwarder } from "./forward.js";
import { createGeminiClient } from "./gemini/client.js";
import { createGrok } from "./grok/client.js";
import { createKalshiClient } from "./kalshi/client.js";
import { createApifySource } from "./posts/apify.js";
import { refreshMarkets } from "./refresh.js";
import { runScan, type ScanDeps } from "./scan.js";
import { createPostgresStore } from "./store.postgres.js";
import { dbPoolMax } from "@copayme/shared";

const env = process.env;
const missing = ["DATABASE_URL", "APIFY_TOKEN", "XAI_API_KEY"].filter((k) => !env[k]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")} (see .env.example).`);
  process.exit(1);
}

const store = createPostgresStore(postgres(env.DATABASE_URL as string, { max: dbPoolMax(env.DB_POOL_MAX) }));
const gemini = createGeminiClient();
const model = env.XAI_MODEL || "grok-4-1-fast-reasoning";

let forwarder = noopForwarder;
if (env.SCOUT_FORWARD_ENABLED === "true") {
  if (!env.INGEST_URL || !env.INGEST_SERVICE_KEY) {
    console.error("SCOUT_FORWARD_ENABLED=true requires INGEST_URL and INGEST_SERVICE_KEY.");
    process.exit(1);
  }
  // Price picks Gemini has no trades for from the Kalshi market Gemini mirrors (SCOUT_KALSHI_PRICING=false turns it off).
  const kalshi = env.SCOUT_KALSHI_PRICING === "false" ? undefined : createKalshiClient();
  forwarder = createForwarder({ url: env.INGEST_URL, serviceKey: env.INGEST_SERVICE_KEY, store, gemini, kalshi, log: console.warn });
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
  startScan: (handle, opts) => {
    void runScan(handle, scanDeps, opts).catch((e) => console.error(`[scout] scan crashed for ${handle}:`, e));
  },
  dailyNewHandles: positiveIntOr(env.SCOUT_DAILY_NEW_HANDLES, 30),
  ...(env.SCOUT_ALLOWED_ORIGIN ? { allowedOrigin: env.SCOUT_ALLOWED_ORIGIN } : {}),
});

serve({ fetch: app.fetch, port: positiveIntOr(env.SCOUT_PORT, 8789) }, (info) => {
  console.log(`coPAYMe scout listening on http://localhost:${info.port}`);
});

// Keep the markets behind forwarded picks current so the scoring worker can settle them.
if (env.SCOUT_FORWARD_ENABLED === "true") {
  const everyMs = positiveIntOr(env.SCOUT_MARKET_REFRESH_S, 600) * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await refreshMarkets({ store, gemini, log: console.log });
    } finally {
      running = false;
    }
  };
  setInterval(() => void tick(), everyMs).unref();
  void tick();
}
