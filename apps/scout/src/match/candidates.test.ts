import type { Prediction } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";
import { findGame, geminiLeague, MATCH_WINDOW_MS, pickGame, windowDays } from "./candidates.js";

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
  lineAsWritten: null,
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

  /** A Lakers game whose moneyline settled at `settled` (ISO), e.g. 2.5 h after the start. */
  const settledGame = (startTime: string, settled: string, ticker: string): GeminiEvent => ({
    ...lakersGame(startTime, ticker),
    status: "settled",
    contracts: [
      { instrumentSymbol: `${ticker}-LAL`, label: "Los Angeles L", marketState: "closed", resolutionSide: "yes", resolvedAt: settled },
      { instrumentSymbol: `${ticker}-CHA`, label: "Charlotte", marketState: "closed", resolutionSide: "no", resolvedAt: settled },
    ],
  });

  it("a tweet 1 h into the team's game, not yet settled -> that live game (live picks count until settlement)", () => {
    const live = lakersGame(at(-HOUR), "LIVE");
    const next = lakersGame(at(2 * 86_400_000), "NEXT");
    expect(pickGame([live, next], pred(["Lakers"]), TWEET)).toEqual({ game: live });
  });

  it("a tweet 2.2 h into the game, which settled later -> still the live game", () => {
    // Real case: "Take Spurs ML" tweeted 2.2 h after tip-off; Gemini settles at the final whistle.
    const live = settledGame(at(-2.2 * HOUR), at(0.5 * HOUR), "LIVE");
    expect(pick([live, lakersGame(at(2 * 86_400_000), "NEXT")], pred(["Lakers"]))?.ticker).toBe("LIVE");
  });

  it("a tweet after the team's game settled -> no game, and not the team's next game (a post-game reaction)", () => {
    const over = settledGame(at(-3 * HOUR), at(-0.5 * HOUR), "OVER");
    const next = lakersGame(at(2 * 86_400_000), "NEXT");
    expect(pickGame([over, next], pred(["Lakers"]), TWEET)).toEqual({ game: null, reason: "tweet after the game settled" });
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

  it("includes a game starting exactly at the tweet, or a minute before (live)", () => {
    expect(pick([lakersGame(TWEET.toISOString())], pred(["Lakers"]))?.ticker).toBe("G1");
    expect(pick([lakersGame(at(-60_000))], pred(["Lakers"]))?.ticker).toBe("G1");
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

  it("prefers the game with the named opponent over an earlier one without it", () => {
    const vsCeltics = game({ ticker: "EARLY", startTime: at(100), home: ["Los Angeles Lakers", "LAL"], away: ["Boston Celtics", "BOS"] });
    const vsHornets = lakersGame(at(1000), "LATER");
    expect(pick([vsCeltics, vsHornets], pred(["Lakers"], ["Hornets"]))?.ticker).toBe("LATER");
  });

  it("treats the opponent as a hint: with no game against it, falls back to the team alone (parlay legs)", () => {
    // Grok named another parlay leg's team (Celtics) as the opponent; the Lakers' real game is vs Hornets.
    const g = lakersGame(at(1000));
    expect(pick([g], pred(["Lakers"], ["Celtics"]))?.ticker).toBe("G1");
    expect(pick([g], pred(["Lakers"], ["Lakers"]))?.ticker).toBe("G1");
  });

  it("doesn't fall back when the pick's own words name the opponent (a recap of a game that's over)", () => {
    // "Chargers 23, Ravens 20. Los Angeles gets its first win" (real @Pickswise post): Grok read it as
    // "Chargers win"; the Ravens game is over, and it must not land on the Chargers' next game.
    const next = game({ ticker: "NYJ-LAC", startTime: at(5 * 24 * HOUR), home: ["Los Angeles C", "LAC"], away: ["New York J", "NYJ"] });
    const recap: Prediction = {
      ...pred(["Los Angeles Chargers", "Chargers", "LAC"], ["Baltimore Ravens", "Ravens", "BAL"], "NFL"),
      quote: "Chargers 23, Ravens 20. Los Angeles gets its first win of 2026.",
    };
    expect(pickGame([next], recap, TWEET)).toEqual({ game: null, reason: "no game within 7 days" });
  });

  it("still falls back for a parlay leg whose quote doesn't name the opponent", () => {
    const g = lakersGame(at(1000));
    expect(pick([g], { ...pred(["Lakers"], ["Celtics", "BOS"]), quote: "Lakers ML" })?.ticker).toBe("G1");
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

describe("geminiLeague", () => {
  it("maps league names to Gemini ticker codes", () => {
    expect(geminiLeague("NBA")).toBe("NBA");
    expect(geminiLeague("ncaam")).toBe("NCAAM");
    expect(geminiLeague("NCAAB")).toBe("NCAAM");
    expect(geminiLeague("CBB")).toBe("NCAAM");
    expect(geminiLeague("CFB")).toBe("NCAAF");
    expect(geminiLeague("Liga MX")).toBe("LIGAMX");
    expect(geminiLeague("Premier League")).toBe("EPL");
    expect(geminiLeague("XFL")).toBeNull();
    expect(geminiLeague(null)).toBeNull();
  });
});

describe("windowDays", () => {
  it("covers every UTC day from 6 h before the tweet to 7 days after", () => {
    // 2026-11-18T12:00Z: window is 2026-11-18T06:00Z .. 2026-11-25T12:00Z
    expect(windowDays(TWEET)).toEqual(["261118", "261119", "261120", "261121", "261122", "261123", "261124", "261125"]);
  });
  it("includes the previous UTC day when the tweet is just after midnight", () => {
    expect(windowDays(new Date("2026-11-18T02:00:00Z"))[0]).toBe("261117");
  });
});

describe("findGame", () => {
  const gemini = (byTerm: (term: string) => GeminiEvent[]) => {
    const full = (e: GeminiEvent) => ({ ...e, events: [] });
    return {
      searchGames: vi.fn(async (term: string, _opts?: { sport?: string }) => byTerm(term)),
      getEvent: vi.fn(async (ticker: string) => full({ ...lakersGame(at(1000)), ticker })),
      getYesPriceAt: vi.fn(async () => null),
    } satisfies GeminiClient;
  };

  it("searches league + each window day first, with the league's sport, and returns the full event", async () => {
    const g = gemini((term) => (term === "NBA-261119" ? [lakersGame(at(1000), "NBA-2611191000-CHA-LAL-M")] : []));
    const result = await findGame(pred(["Lakers", "LAL"], null, "NBA"), TWEET, g);
    expect(result.game?.ticker).toBe("NBA-2611191000-CHA-LAL-M");
    const terms = g.searchGames.mock.calls.map((c) => c[0]);
    expect(terms).toEqual(windowDays(TWEET).map((d) => `NBA-${d}`));
    expect(g.searchGames.mock.calls.every((c) => c[1]?.sport === "basketball")).toBe(true);
    expect(g.getEvent).toHaveBeenCalledWith("NBA-2611191000-CHA-LAL-M");
  });

  it("normalizes the league before building day searches (NCAAB -> NCAAM)", async () => {
    const g = gemini(() => []);
    await findGame(pred(["UConn"], null, "NCAAB"), TWEET, g);
    expect(g.searchGames.mock.calls[0]![0]).toBe("NCAAM-261118");
  });

  it("falls back to the ticker team code, then to names, when day searches find nothing", async () => {
    const g = gemini((term) => (term === "lakers" ? [lakersGame(at(1000))] : []));
    const result = await findGame(pred(["Lakers", "LAL"], null, "NBA"), TWEET, g);
    expect(result.game).not.toBeNull();
    const terms = g.searchGames.mock.calls.map((c) => c[0]);
    const days = windowDays(TWEET).length;
    expect(terms.slice(days, days + 1)).toEqual(["-LAL-"]);
    expect(terms.slice(days + 1)).toEqual(["lakers", "lal"]);
  });

  it("skips day searches when the league is unknown", async () => {
    const g = gemini((term) => (term === "-LAL-" ? [lakersGame(at(1000))] : []));
    await findGame(pred(["Lakers", "LAL"]), TWEET, g);
    expect(g.searchGames.mock.calls[0]![0]).toBe("-LAL-");
  });

  it("prefers the exact team over a name that merely contains it (Tennessee vs Tennessee State)", async () => {
    const tnState = game({ ticker: "NCAAM-A", startTime: at(1), home: ["South Florida", "USF"], away: ["Tennessee State", "TNST"] });
    const tennessee = game({ ticker: "NCAAM-B", startTime: at(10), home: ["Tennessee", "TENN"], away: ["Michigan State", "MSST"] });
    const g = gemini((term) => (term.startsWith("NCAAM-26") ? [tnState, tennessee] : []));
    const result = await findGame(pred(["Tennessee", "Tennessee Volunteers", "TENN"], null, "NCAAM"), TWEET, g);
    expect(g.getEvent).toHaveBeenCalledWith("NCAAM-B");
    expect(result.game?.ticker).toBe("NCAAM-B");
  });

  it("stops at the first tier that finds the team's game already settled (post-game tweets aren't pushed to a later tier)", async () => {
    const over: GeminiEvent = {
      ...lakersGame(at(-3 * HOUR), "NBA-OVER"),
      status: "settled",
      contracts: [{ instrumentSymbol: "S-LAL", label: "Los Angeles L", marketState: "closed", resolutionSide: "yes", resolvedAt: at(-HOUR) }],
    };
    const g = gemini((term) => (term.startsWith("NBA-26") ? [over] : [lakersGame(at(1000))]));
    expect(await findGame(pred(["Lakers", "LAL"], null, "NBA"), TWEET, g)).toEqual({ game: null, reason: "tweet after the game settled" });
    expect(g.searchGames.mock.calls.every((c) => (c[0] as string).startsWith("NBA-26"))).toBe(true);
  });

  it("returns the no-game reason without fetching an event when nothing matches", async () => {
    const g = gemini(() => []);
    expect(await findGame(pred(["Lakers"]), TWEET, g)).toEqual({ game: null, reason: "no game within 7 days" });
    expect(g.getEvent).not.toHaveBeenCalled();
  });
});
