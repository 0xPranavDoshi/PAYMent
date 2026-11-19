import { serve } from "@hono/node-server";
import postgres from "postgres";
import { createApp } from "./app.js";
import { createMemoryStore } from "./store.memory.js";
import { createPostgresStore } from "./store.postgres.js";
import { createPaymentProviderFromEnv } from "./payments.js";
import type { OnchainStore } from "./store.js";

const {
  DATABASE_URL,
  ONCHAIN_SERVICE_KEY,
  ONCHAIN_PORT = "8790",
  STORE = DATABASE_URL ? "postgres" : "memory",
} = process.env;

if (!ONCHAIN_SERVICE_KEY) throw new Error("ONCHAIN_SERVICE_KEY is required (openssl rand -hex 32)");

let store: OnchainStore;
if (STORE === "postgres") {
  if (!DATABASE_URL) throw new Error("STORE=postgres requires DATABASE_URL");
  const ssl = /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : "require";
  store = createPostgresStore(postgres(DATABASE_URL, { max: 10, ssl }));
} else {
  console.warn("[onchain] STORE=memory — data is not durable. Set DATABASE_URL for Postgres.");
  store = createMemoryStore();
}

const payments = await createPaymentProviderFromEnv();

const app = createApp({ store, payments, serviceKey: ONCHAIN_SERVICE_KEY });
const port = parseInt(ONCHAIN_PORT, 10);
serve({ fetch: app.fetch, port }, () =>
  console.log(`coPAYMe on-chain service on http://localhost:${port} (store=${STORE}, payments=${payments.kind})`),
);
