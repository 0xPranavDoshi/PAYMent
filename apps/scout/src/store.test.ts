import { describe, expect, it } from "vitest";
import { describeStore } from "../test/store-suite.js";
import { createMemoryStore } from "./store.js";

describe("memory store", () => {
  describeStore(createMemoryStore);

  it("upsertMarket keeps one row per market", async () => {
    const store = createMemoryStore();
    const base = {
      geminiMarketId: "474538",
      sport: "basketball",
      eventName: "A vs B",
      outcomes: [{ label: "A", instrumentSymbol: "GEMI-A", currentOdds: 0.5, noOdds: 0.5, resolutionSide: null }],
      lockTime: new Date("2026-11-20T00:00:00Z"),
    };
    await store.upsertMarket({ ...base, status: "open", winningOutcome: null, resolvedAt: null });
    await store.upsertMarket({ ...base, status: "resolved", winningOutcome: "A", resolvedAt: new Date() });
    expect(store.markets.size).toBe(1);
    expect(store.markets.get("474538")).toMatchObject({ status: "resolved", winningOutcome: "A" });
  });
});
