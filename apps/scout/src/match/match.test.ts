import type { Prediction } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";
import type { Grok } from "../grok/client.js";
import { matchPrediction, NO_SUB_MARKETS_REASON, TEAM_TOTAL_REASON } from "./match.js";

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
    searchGames: vi.fn(async () => (g ? [g] : [])),
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
  lineAsWritten: null,
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

  it("game returned with no sub-markets at all, every time -> retryable no_market after 5 fetches", async () => {
    const g = gemini(game());
    const r = await matchPrediction(pred({ betType: "total", claim: "over", line: 200 }), 0, TWEET, {
      gemini: g,
      grok,
      sleep: async () => {},
    });
    expect(r).toMatchObject({ status: "no_market", reason: NO_SUB_MARKETS_REASON });
    expect(g.getEvent).toHaveBeenCalledTimes(5);
  });

  it("keeps asking while Gemini returns the game without its sub-markets (it alternates), then matches", async () => {
    const total = {
      id: "3",
      ticker: "T",
      title: "t",
      status: "active",
      template: "sports-total",
      contracts: [{ instrumentSymbol: "SYM-O200", label: "Over 200.5", marketState: "open", strike: { type: "over", value: "200.5" } }],
    };
    const bare = game();
    const full = game({ events: [total] as never });
    const g = {
      searchGames: vi.fn(async () => [bare]),
      getEvent: vi.fn().mockResolvedValueOnce(bare).mockResolvedValueOnce(bare).mockResolvedValue(full),
    } as unknown as GeminiClient;
    const waits: number[] = [];
    const r = await matchPrediction(pred({ betType: "total", claim: "over", line: 200.5 }), 0, TWEET, {
      gemini: g,
      grok,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(r).toMatchObject({ status: "matched", instrumentSymbol: "SYM-O200" });
    expect(g.getEvent).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([1000, 1000]);
  });

  it("game has sub-markets but none for this bet type -> no_market", async () => {
    const spreadOnly = game({
      events: [{ id: "2", ticker: "G-S", title: "s", status: "active", template: "sports-spread", contracts: [] }],
    });
    const r = await matchPrediction(pred({ betType: "total", claim: "over", line: 200 }), 0, TWEET, {
      gemini: gemini(spreadOnly),
      grok,
    });
    expect(r).toMatchObject({ status: "no_market", reason: "no sub-event for bet type" });
  });

  it("team totals -> no_market without any Gemini lookup", async () => {
    const g = gemini(game());
    const r = await matchPrediction(pred({ betType: "team_total", claim: "under", line: 17.5 }), 0, TWEET, { gemini: g, grok });
    expect(r).toMatchObject({ status: "no_market", reason: TEAM_TOTAL_REASON });
    expect(g.searchGames).not.toHaveBeenCalled();
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
    expect(r).toMatchObject({ status: "no_market", reason: "no contract at the tweet's line" });
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
    const r = await matchPrediction(pred({ betType: "spread", claim: "covers", line: 4.5 }), 0, TWEET, {
      gemini: gemini(g),
      grok,
    });
    expect(r).toMatchObject({
      status: "matched",
      reason: "spread 4.5",
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
      searchGames: vi.fn(async () => [g]),
      getEvent: vi.fn(async () => started),
    } as unknown as GeminiClient;
    const r2 = await matchPrediction(pred(), 0, TWEET, { gemini: stub, grok });
    expect(r2).toMatchObject({ status: "rejected", reason: expect.stringMatching(/starts/) });
  });

  it("findGame errors propagate", async () => {
    const boom = { searchGames: vi.fn(async () => Promise.reject(new Error("boom"))) } as unknown as GeminiClient;
    await expect(matchPrediction(pred(), 0, TWEET, { gemini: boom, grok })).rejects.toThrow("boom");
  });
});
