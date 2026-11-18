import type { Prediction } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";
import { findGame, MATCH_WINDOW_MS, pickGame } from "./candidates.js";

const TWEET = new Date("2026-11-18T12:00:00.000Z");

function game(o: {
  ticker: string;
  startTime?: string;
  home: [string, string];
  away: [string, string];
  template?: string;
}): GeminiEvent {
  return {
    id: o.ticker,
    ticker: o.ticker,
    title: `${o.away[0]} vs ${o.home[0]}`,
    status: "active",
    template: o.template ?? "sports-game",
    ...(o.startTime ? { startTime: o.startTime } : {}),
    participants: [
      { name: o.home[0], abbreviation: o.home[1], side: "home" },
      { name: o.away[0], abbreviation: o.away[1], side: "away" },
    ],
    contracts: [],
  };
}

const lakersGame = (startTime: string | undefined, ticker = "G1") =>
  game({
    ticker,
    ...(startTime ? { startTime } : {}),
    home: ["Los Angeles Lakers", "LAL"],
    away: ["Charlotte Hornets", "CHA"],
  });

const pred = (team: string[], opponent: string[] | null = null): Prediction => ({
  betType: "win",
  league: null,
  team: { name: team[0]!, aliases: team.slice(1) },
  opponent: opponent ? { name: opponent[0]!, aliases: opponent.slice(1) } : null,
  player: null,
  metric: null,
  line: null,
  claim: "wins",
  conviction: "strong",
  quote: "q",
});

const at = (ms: number) => new Date(TWEET.getTime() + ms).toISOString();

describe("pickGame", () => {
  it("excludes a game whose startTime equals tweetedAt", () => {
    expect(pickGame([lakersGame(TWEET.toISOString())], pred(["Lakers"]), TWEET)).toBeNull();
  });

  it("excludes a game that started before the tweet", () => {
    expect(pickGame([lakersGame(at(-60_000))], pred(["Lakers"]), TWEET)).toBeNull();
  });

  it("includes a game exactly 7 days after the tweet; excludes 7 days + 1 ms", () => {
    expect(pickGame([lakersGame(at(MATCH_WINDOW_MS))], pred(["Lakers"]), TWEET)?.ticker).toBe("G1");
    expect(pickGame([lakersGame(at(MATCH_WINDOW_MS + 1))], pred(["Lakers"]), TWEET)).toBeNull();
  });

  it("picks the earliest of two qualifying games with the same teams", () => {
    const later = lakersGame(at(3 * 86_400_000), "LATE");
    const sooner = lakersGame(at(86_400_000), "SOON");
    expect(pickGame([later, sooner], pred(["Lakers"]), TWEET)?.ticker).toBe("SOON");
  });

  it("matches a participant by abbreviation alias, case-insensitively", () => {
    expect(pickGame([lakersGame(at(1000))], pred(["Nobody", " lal "]), TWEET)?.ticker).toBe("G1");
  });

  it("matches a whole word of the participant name, not a substring", () => {
    expect(pickGame([lakersGame(at(1000))], pred(["Los Angeles Lakers"]), TWEET)).not.toBeNull();
    expect(pickGame([lakersGame(at(1000))], pred(["Laker"]), TWEET)).toBeNull();
  });

  it("requires both teams when an opponent is named", () => {
    const g = lakersGame(at(1000));
    expect(pickGame([g], pred(["Lakers"], ["Hornets"]), TWEET)).not.toBeNull();
    expect(pickGame([g], pred(["Lakers"], ["Celtics"]), TWEET)).toBeNull();
    expect(pickGame([g], pred(["Lakers"], ["Lakers"]), TWEET)).toBeNull();
  });

  it("ignores events whose template is not sports-game", () => {
    const e = game({
      ticker: "S",
      startTime: at(1000),
      home: ["Los Angeles Lakers", "LAL"],
      away: ["Charlotte Hornets", "CHA"],
      template: "sports-spread",
    });
    expect(pickGame([e], pred(["Lakers"]), TWEET)).toBeNull();
  });

  it("skips events with no startTime", () => {
    expect(pickGame([lakersGame(undefined)], pred(["Lakers"]), TWEET)).toBeNull();
  });

  it("returns null for a team with no game", () => {
    expect(pickGame([lakersGame(at(1000))], pred(["Celtics"]), TWEET)).toBeNull();
    expect(pickGame([], pred(["Celtics"]), TWEET)).toBeNull();
  });
});

describe("findGame", () => {
  it("searches every alias with active, settled and under_review, dedupes, and returns the full event", async () => {
    const summary = lakersGame(at(1000));
    const full = { ...summary, events: [] };
    const gemini: GeminiClient = {
      searchEvents: vi.fn(async () => [summary]),
      getEvent: vi.fn(async () => full),
    };
    const result = await findGame(pred(["Lakers", "LAL"]), TWEET, gemini);
    expect(result).toBe(full);
    expect(gemini.searchEvents).toHaveBeenCalledTimes(6);
    const statuses = vi.mocked(gemini.searchEvents).mock.calls.map((c) => c[1]);
    expect(new Set(statuses)).toEqual(new Set(["active", "settled", "under_review"]));
    expect(gemini.getEvent).toHaveBeenCalledWith("G1");
  });

  it("returns null without fetching an event when nothing matches", async () => {
    const gemini: GeminiClient = { searchEvents: vi.fn(async () => []), getEvent: vi.fn() };
    expect(await findGame(pred(["Lakers"]), TWEET, gemini)).toBeNull();
    expect(gemini.getEvent).not.toHaveBeenCalled();
  });
});
