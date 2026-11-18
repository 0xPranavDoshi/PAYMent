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

const pred = (team: string[], opponent: string[] | null = null, league: string | null = null): Prediction => ({
  betType: "win",
  league,
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
const HOUR = 3_600_000;

const pick = (events: GeminiEvent[], p: Prediction, tweetedAt = TWEET) => pickGame(events, p, tweetedAt).game;

describe("pickGame", () => {
  it("reports no game within 7 days as the reason when nothing qualifies", () => {
    expect(pickGame([], pred(["Lakers"]), TWEET)).toEqual({ game: null, reason: "no game within 7 days" });
  });

  it("a tweet 1 h after the team's game started -> no game, 'tweet during game'", () => {
    const live = lakersGame(at(-HOUR), "LIVE");
    const next = lakersGame(at(2 * 86_400_000), "NEXT");
    expect(pickGame([live, next], pred(["Lakers"]), TWEET)).toEqual({ game: null, reason: "tweet during game" });
  });

  it("a tweet 7 h after the team's game started -> the next game is eligible", () => {
    const earlier = lakersGame(at(-7 * HOUR), "EARLIER");
    const next = lakersGame(at(2 * 86_400_000), "NEXT");
    expect(pick([earlier, next], pred(["Lakers"]))?.ticker).toBe("NEXT");
  });

  it("an in-progress game of other teams does not block the pick", () => {
    const other = game({ ticker: "O", startTime: at(-HOUR), home: ["Boston Celtics", "BOS"], away: ["Miami Heat", "MIA"] });
    expect(pick([other, lakersGame(at(1000))], pred(["Lakers"]))?.ticker).toBe("G1");
  });

  it("an exact alias match beats an earlier whole-word containment match", () => {
    const asu = game({
      ticker: "ASU",
      startTime: at(HOUR),
      home: ["Arizona State Sun Devils", "ASU"],
      away: ["Utah Utes", "UTAH"],
    });
    const wildcats = game({
      ticker: "ARI",
      startTime: at(5 * HOUR),
      home: ["Arizona Wildcats", "ARI"],
      away: ["UConn Huskies", "UCONN"],
    });
    expect(pick([asu, wildcats], pred(["Arizona Wildcats", "Arizona", "ARI"]))?.ticker).toBe("ARI");
    // with no exact alias anywhere, containment still applies (earliest wins)
    expect(pick([asu, wildcats], pred(["Arizona"]))?.ticker).toBe("ASU");
  });

  it("a rivalry game where both participants contain the alias -> no match", () => {
    const rivalry = game({
      ticker: "RIV",
      startTime: at(HOUR),
      home: ["Arizona Wildcats", "ARIZ"],
      away: ["Arizona State Sun Devils", "ASU"],
    });
    expect(pick([rivalry], pred(["Arizona"]))).toBeNull();
    expect(pick([rivalry], pred(["Arizona Wildcats", "Arizona"]))?.ticker).toBe("RIV");
  });

  it("league restricts candidates to that league's tickers when any exist", () => {
    const ncaa = game({ ticker: "NCAAM-1-X", startTime: at(HOUR), home: ["Los Angeles Lakers", "LAL"], away: ["Y", "Y"] });
    const nba = game({ ticker: "NBA-2-X", startTime: at(5 * HOUR), home: ["Los Angeles Lakers", "LAL"], away: ["Z", "Z"] });
    expect(pick([ncaa, nba], pred(["Lakers"], null, "nba"))?.ticker).toBe("NBA-2-X");
    expect(pick([ncaa, nba], pred(["Lakers"]))?.ticker).toBe("NCAAM-1-X");
    // no ticker carries the league prefix: don't filter
    expect(pick([ncaa], pred(["Lakers"], null, "NFL"))?.ticker).toBe("NCAAM-1-X");
  });

  it("excludes a game whose startTime equals tweetedAt", () => {
    expect(pick([lakersGame(TWEET.toISOString())], pred(["Lakers"]))).toBeNull();
  });

  it("excludes a game that started before the tweet", () => {
    expect(pick([lakersGame(at(-60_000))], pred(["Lakers"]))).toBeNull();
  });

  it("includes a game exactly 7 days after the tweet; excludes 7 days + 1 ms", () => {
    expect(pick([lakersGame(at(MATCH_WINDOW_MS))], pred(["Lakers"]))?.ticker).toBe("G1");
    expect(pick([lakersGame(at(MATCH_WINDOW_MS + 1))], pred(["Lakers"]))).toBeNull();
  });

  it("picks the earliest of two qualifying games with the same teams", () => {
    const later = lakersGame(at(3 * 86_400_000), "LATE");
    const sooner = lakersGame(at(86_400_000), "SOON");
    expect(pick([later, sooner], pred(["Lakers"]))?.ticker).toBe("SOON");
  });

  it("matches a participant by abbreviation alias, case-insensitively", () => {
    expect(pick([lakersGame(at(1000))], pred(["Nobody", " lal "]))?.ticker).toBe("G1");
  });

  it("matches a whole word of the participant name, not a substring", () => {
    expect(pick([lakersGame(at(1000))], pred(["Los Angeles Lakers"]))).not.toBeNull();
    expect(pick([lakersGame(at(1000))], pred(["Laker"]))).toBeNull();
  });

  it("requires both teams when an opponent is named", () => {
    const g = lakersGame(at(1000));
    expect(pick([g], pred(["Lakers"], ["Hornets"]))).not.toBeNull();
    expect(pick([g], pred(["Lakers"], ["Celtics"]))).toBeNull();
    expect(pick([g], pred(["Lakers"], ["Lakers"]))).toBeNull();
  });

  it("ignores events whose template is not sports-game", () => {
    const e = game({
      ticker: "S",
      startTime: at(1000),
      home: ["Los Angeles Lakers", "LAL"],
      away: ["Charlotte Hornets", "CHA"],
      template: "sports-spread",
    });
    expect(pick([e], pred(["Lakers"]))).toBeNull();
  });

  it("skips events with no startTime", () => {
    expect(pick([lakersGame(undefined)], pred(["Lakers"]))).toBeNull();
  });

  it("returns null for a team with no game", () => {
    expect(pick([lakersGame(at(1000))], pred(["Celtics"]))).toBeNull();
    expect(pick([], pred(["Celtics"]))).toBeNull();
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
    expect(result).toEqual({ game: full });
    expect(gemini.searchEvents).toHaveBeenCalledTimes(6);
    const statuses = vi.mocked(gemini.searchEvents).mock.calls.map((c) => c[1]);
    expect(new Set(statuses)).toEqual(new Set(["active", "settled", "under_review"]));
    expect(gemini.getEvent).toHaveBeenCalledWith("G1");
  });

  it("returns the no-game reason without fetching an event when nothing matches", async () => {
    const gemini: GeminiClient = { searchEvents: vi.fn(async () => []), getEvent: vi.fn() };
    expect(await findGame(pred(["Lakers"]), TWEET, gemini)).toEqual({ game: null, reason: "no game within 7 days" });
    expect(gemini.getEvent).not.toHaveBeenCalled();
  });
});
