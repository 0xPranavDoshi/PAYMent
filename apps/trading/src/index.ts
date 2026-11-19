import { serve } from "@hono/node-server";
import postgres from "postgres";
import { createApp } from "./app.js";
import { createPostgresStore } from "./store.postgres.js";
import { GeminiClient } from "./gemini.js";

const {
  DATABASE_URL,
  GEMINI_API_KEY,
  GEMINI_API_SECRET,
  GEMINI_READ_BASE_URL = "https://api.gemini.com",
  GEMINI_ORDER_BASE_URL = "https://api.sandbox.gemini.com",
  TRADING_SERVICE_KEY,
  TRADING_PORT = "8788",
} = process.env;

if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
if (!GEMINI_API_SECRET) throw new Error("GEMINI_API_SECRET is required");
if (!TRADING_SERVICE_KEY) throw new Error("TRADING_SERVICE_KEY is required");

const sql = postgres(DATABASE_URL, { max: 10 });
const store = createPostgresStore(sql);
const gemini = new GeminiClient({
  apiKey: GEMINI_API_KEY,
  apiSecret: GEMINI_API_SECRET,
  readBaseUrl: GEMINI_READ_BASE_URL,
  orderBaseUrl: GEMINI_ORDER_BASE_URL,
});

const app = createApp({ store, gemini, serviceKey: TRADING_SERVICE_KEY });

const port = parseInt(TRADING_PORT, 10);
console.log(`trading service listening on :${port}`);
serve({ fetch: app.fetch, port });
