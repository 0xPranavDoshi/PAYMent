import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { GeminiClient } from "./gemini.js";
import type { TradingStore } from "./store.js";

const app = (copyTradeMode?: "paper" | "live") =>
  createApp({ store: {} as TradingStore, gemini: {} as GeminiClient, serviceKey: "k", copyTradeMode });

describe("GET /v1/config", () => {
  it("says copy trades are simulated by default", async () => {
    const res = await app().request("/v1/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copyTradeMode: "paper" });
  });

  it("says so when copy trades are live, so a client can warn about real orders", async () => {
    expect(await (await app("live").request("/v1/config")).json()).toEqual({ copyTradeMode: "live" });
  });
});
