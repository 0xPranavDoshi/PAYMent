import { serve } from "@hono/node-server";
import postgres from "postgres";
import { createApp } from "./app.js";
import { createPostgresStore } from "./store.postgres.js";
import { GeminiClient } from "./gemini.js";
import { syncMarkets } from "./sync.js";

const {
  DATABASE_URL,
  GEMINI_API_KEY,
  GEMINI_API_SECRET,
  GEMINI_READ_BASE_URL = "https://api.gemini.com",
  GEMINI_ORDER_BASE_URL = "https://api.sandbox.gemini.com",
  TRADING_SERVICE_KEY,
  TRADING_PORT = "8788",
  // "paper" (default) simulates copy trades; "live" places real orders (only where the
  // order venue has the market — the Gemini sandbox has no sports, so keep this "paper").
  COPY_TRADE_MODE = "paper",
} = process.env;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
if (!GEMINI_API_SECRET) throw new Error("GEMINI_API_SECRET is required");
if (!TRADING_SERVICE_KEY) throw new Error("TRADING_SERVICE_KEY is required");
if (COPY_TRADE_MODE !== "paper" && COPY_TRADE_MODE !== "live") {
  throw new Error(`COPY_TRADE_MODE must be "paper" or "live", got "${COPY_TRADE_MODE}"`);
}

const sql = postgres(DATABASE_URL, { max: 10 });
const store = createPostgresStore(sql);
const gemini = new GeminiClient({
  apiKey: GEMINI_API_KEY,
  apiSecret: GEMINI_API_SECRET,
  readBaseUrl: GEMINI_READ_BASE_URL,
  orderBaseUrl: GEMINI_ORDER_BASE_URL,
});

const app = createApp({
  store,
  gemini,
  serviceKey: TRADING_SERVICE_KEY,
  copyTradeMode: COPY_TRADE_MODE,
});

const SYNC_INTERVAL_MS = 5 * 60 * 1000;

async function runSync() {
  console.log("[sync] starting market sync");
  try {
    const result = await syncMarkets(gemini, store);
    console.log(`[sync] upserted ${result.upserted} markets, ${result.errors.length} errors`);
    if (result.errors.length > 0) console.warn("[sync] errors:", result.errors);
  } catch (err) {
    console.error("[sync] market sync crashed:", err);
  }
}

setTimeout(() => {
  void runSync();
  setInterval(() => {
    void runSync();
  }, SYNC_INTERVAL_MS);
}, 15_000);

const port = parseInt(TRADING_PORT, 10);
console.log(`trading service listening on :${port}`);
serve({ fetch: app.fetch, port });
