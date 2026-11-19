import type { PickMatch } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "./gemini/client.js";
import type { GeminiEvent } from "./gemini/types.js";
import { refreshMarkets } from "./refresh.js";
import { PIPELINE_VERSION, createMemoryStore, type ScoutPostRow } from "./store.js";

const NOW = new Date("2026-11-19T12:00:00.000Z");
const STARTED = "2026-11-19T02:00:00.000Z";

const spread = (status: string, resolution: "yes" | "no" | null): GeminiEvent => ({
  id: "1",
  ticker: "NBA-X-S",
  title: "Spread",
  status,
  expiryDate: "2026-11-21T02:00:00.000Z",
  contracts: [
    {
      instrumentSymbol: "GEMI-NBA-X-S-BKN2",
      label: "Brooklyn wins by more than 2.5 points",
      marketState: status === "settled" ? "closed" : "open",
      ...(resolution ? { resolutionSide: resolution, resolvedAt: "2026-11-19T05:00:00.000Z" } : {}),
    },
  ],
});

const pick = (ticker: string): PickMatch => ({
  predictionIndex: 0,
  status: "matched",
  reason: "spread 2.5 <= 2.5",
  geminiEventTicker: ticker,
  gameTicker: "NBA-X-M",
  instrumentSymbol: "GEMI-NBA-X-S-BKN2",
  contractLabel: "Brooklyn wins by more than 2.5 points",
  side: "yes",
  gameStartTime: STARTED,
  marketStatus: "open",
  resolutionSide: null,
});

const post = (id: string, matches: PickMatch[]): ScoutPostRow => ({
  tweetId: id,
  handle: "bob",
  xUserId: "u1",
  tweetedAt: new Date("2026-11-18T12:00:00.000Z"),
  text: "nets -2.5",
  isReply: false,
  quotedText: null,
  sentiment: null,
  matches,
  pipelineVersion: PIPELINE_VERSION,
  forwardedAt: new Date("2026-11-18T12:05:00.000Z"),
});

const gemini = (events: Record<string, GeminiEvent>): GeminiClient => ({
  searchGames: vi.fn(),
  getEvent: vi.fn(async (t: string) => {
    const e = events[t];
    if (!e) throw new Error(`no event ${t}`);
    return e;
  }),
});

describe("refreshMarkets", () => {
  it("writes a settled market's per-contract result so the scoring worker can settle the pick", async () => {
    const store = createMemoryStore();
    await store.upsertPosts([post("t1", [pick("NBA-X-S")])]);
    const result = await refreshMarkets({ store, gemini: gemini({ "NBA-X-S": spread("settled", "yes") }), now: () => NOW });
    expect(result).toEqual({ checked: 1, settled: 1, failed: 0 });
    expect(store.markets.get("NBA-X-S")).toMatchObject({
      status: "resolved",
      outcomes: [expect.objectContaining({ instrumentSymbol: "GEMI-NBA-X-S-BKN2", resolutionSide: "yes" })],
      lockTime: new Date("2026-11-21T02:00:00.000Z"),
    });
    // settled now, so the next run has nothing to do
    expect(await refreshMarkets({ store, gemini: gemini({}), now: () => NOW })).toEqual({ checked: 0, settled: 0, failed: 0 });
  });

  it("keeps re-checking a started market until Gemini settles it", async () => {
    const store = createMemoryStore();
    await store.upsertPosts([post("t1", [pick("NBA-X-S")])]);
    const g = gemini({ "NBA-X-S": spread("active", null) });
    expect(await refreshMarkets({ store, gemini: g, now: () => NOW })).toEqual({ checked: 1, settled: 0, failed: 0 });
    expect(store.markets.get("NBA-X-S")?.status).toBe("open");
    expect((await refreshMarkets({ store, gemini: g, now: () => NOW })).checked).toBe(1);
  });

  it("marks a cancelled (invalid) market void", async () => {
    const store = createMemoryStore();
    await store.upsertPosts([post("t1", [pick("NBA-X-S")])]);
    await refreshMarkets({ store, gemini: gemini({ "NBA-X-S": spread("invalid", null) }), now: () => NOW });
    expect(store.markets.get("NBA-X-S")?.status).toBe("void");
  });

  it("logs and skips a market Gemini can't return, and still refreshes the rest", async () => {
    const store = createMemoryStore();
    await store.upsertPosts([post("t1", [pick("GONE-S")]), post("t2", [pick("NBA-X-S")])]);
    const logs: string[] = [];
    const result = await refreshMarkets({
      store,
      gemini: gemini({ "NBA-X-S": spread("settled", "no") }),
      now: () => NOW,
      log: (m) => logs.push(m),
    });
    expect(result).toEqual({ checked: 2, settled: 1, failed: 1 });
    expect(logs.some((l) => l.includes("GONE-S"))).toBe(true);
  });
});
