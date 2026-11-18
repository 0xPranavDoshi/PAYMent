import type { Prediction } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";
import type { Grok } from "../grok/client.js";
import { matchPrediction } from "./match.js";

const TWEET = new Date("2026-11-18T12:00:00.000Z");

const game = (o: Partial<GeminiEvent> = {}): GeminiEvent => ({
  id: "1",
  ticker: "G",
  title: "g",
  status: "active",
  template: "sports-game",
  startTime: "2026-11-19T02:00:00.000Z",
  participants: [
    { name: "Los Angeles Lakers", abbreviation: "LAL", side: "home" },
    { name: "Charlotte Hornets", abbreviation: "CHA", side: "away" },
  ],
  contracts: [
    { instrumentSymbol: "SYM-LAL", label: "Lakers", abbreviatedName: "LAL", marketState: "open" },
    { instrumentSymbol: "SYM-CHA", label: "Hornets", abbreviatedName: "CHA", marketState: "open" },
  ],
  ...o,
});

const gemini = (g: GeminiEvent | null): GeminiClient =>
  ({
    searchEvents: vi.fn(async () => (g ? [g] : [])),
    getEvent: vi.fn(async () => g),
  }) as unknown as GeminiClient;
const grok: Grok = { json: vi.fn() as never };

const pred = (o: Partial<Prediction> = {}): Prediction => ({
  betType: "win",
  league: null,
  team: { name: "Los Angeles Lakers", aliases: ["Lakers", "LAL"] },
  opponent: null,
  player: null,
  metric: null,
  line: null,
  claim: "wins",
  conviction: "strong",
  quote: "q",
  ...o,
});

describe("matchPrediction", () => {
  it("no game -> no_market", async () => {
    const r = await matchPrediction(pred(), 3, TWEET, { gemini: gemini(null), grok });
    expect(r).toMatchObject({ predictionIndex: 3, status: "no_market", reason: "no game within 7 days" });
  });

  it("tweet during the team's game -> no_market 'tweet during game'", async () => {
    const live = game({ startTime: "2026-11-18T11:00:00.000Z" });
    const r = await matchPrediction(pred(), 0, TWEET, { gemini: gemini(live), grok });
    expect(r).toMatchObject({ status: "no_market", reason: "tweet during game" });
  });

  it("no sub-event -> no_market", async () => {
    const r = await matchPrediction(pred({ betType: "total", claim: "over", line: 200 }), 0, TWEET, {
      gemini: gemini(game()),
      grok,
    });
    expect(r).toMatchObject({ status: "no_market", reason: "no sub-event for bet type" });
  });

  it("no guaranteed contract -> no_market", async () => {
    const g = game({
      events: [
        {
          id: "2",
          ticker: "S",
          title: "s",
          status: "active",
          template: "sports-spread",
          contracts: [
            {
              instrumentSymbol: "SYM-S1",
              label: "Lakers wins by more than 9.5 points",
              abbreviatedName: "Lakers",
              marketState: "open",
              strike: { type: "spread", value: "9.5" },
            },
          ],
        },
      ],
    });
    const r = await matchPrediction(pred({ betType: "spread", claim: "covers", line: 5 }), 0, TWEET, {
      gemini: gemini(g),
      grok,
    });
    expect(r).toMatchObject({ status: "no_market", reason: "no contract guaranteed by the claim" });
  });

  it("valid win -> matched with fields filled, settled resolutionSide from the contract", async () => {
    const g = game({
      status: "settled",
      contracts: [
        {
          instrumentSymbol: "SYM-LAL",
          label: "Lakers",
          abbreviatedName: "LAL",
          marketState: "settled",
          resolutionSide: "yes",
        },
      ],
    });
    const r = await matchPrediction(pred(), 1, TWEET, { gemini: gemini(g), grok });
    expect(r).toEqual({
      predictionIndex: 1,
      status: "matched",
      reason: expect.any(String),
      geminiEventTicker: "G",
      gameTicker: "G",
      instrumentSymbol: "SYM-LAL",
      contractLabel: "Lakers",
      side: "yes",
      gameStartTime: "2026-11-19T02:00:00.000Z",
      marketStatus: "settled",
      resolutionSide: "yes",
    });
  });

  it("spread match reports the line reason", async () => {
    const g = game({
      events: [
        {
          id: "2",
          ticker: "S",
          title: "s",
          status: "active",
          template: "sports-spread",
          contracts: [
            {
              instrumentSymbol: "SYM-S1",
              label: "Lakers wins by more than 4.5 points",
              abbreviatedName: "Lakers",
              marketState: "open",
              strike: { type: "spread", value: "4.5" },
            },
          ],
        },
      ],
    });
    const r = await matchPrediction(pred({ betType: "spread", claim: "covers", line: 7 }), 0, TWEET, {
      gemini: gemini(g),
      grok,
    });
    expect(r).toMatchObject({
      status: "matched",
      reason: "spread 4.5 <= 7",
      geminiEventTicker: "S",
      gameTicker: "G",
      marketStatus: "open",
      resolutionSide: null,
    });
  });

  it("failed validation -> rejected with the reason", async () => {
    // findGame filters by window, so return a game whose start is after the tweet but validate with a later tweet
    const g = game();
    const g2 = gemini(g);
    const r = await matchPrediction(pred(), 0, new Date("2026-11-18T12:00:00.000Z"), { gemini: g2, grok });
    expect(r.status).toBe("matched");
    // simulate a game that slips past findGame: getEvent returns a different, already-started event
    const started = game({ startTime: "2026-11-18T11:00:00.000Z" });
    const stub = {
      searchEvents: vi.fn(async () => [g]),
      getEvent: vi.fn(async () => started),
    } as unknown as GeminiClient;
    const r2 = await matchPrediction(pred(), 0, TWEET, { gemini: stub, grok });
    expect(r2).toMatchObject({ status: "rejected", reason: expect.stringMatching(/starts/) });
  });

  it("findGame errors propagate", async () => {
    const boom = { searchEvents: vi.fn(async () => Promise.reject(new Error("boom"))) } as unknown as GeminiClient;
    await expect(matchPrediction(pred(), 0, TWEET, { gemini: boom, grok })).rejects.toThrow("boom");
  });
});
