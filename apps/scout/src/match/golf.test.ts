import type { Prediction } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";
import type { Grok } from "../grok/client.js";
import { AFTER_GAME_REASON, settledAt } from "./candidates.js";
import {
  NO_GOLF_KIND_REASON,
  NO_GOLFER_REASON,
  NO_TOURNAMENT_REASON,
  golfKind,
  matchGolf,
  pickTournament,
  tickerKind,
  tournamentName,
} from "./golf.js";
import { matchPrediction } from "./match.js";

// Mugdha's tweet, during round 2 of The RSM Classic (started Nov 19 12:00 UTC, expires Nov 23 04:00).
const TWEET = new Date("2026-11-20T08:00:29.858Z");

const golfer = (last: string, label: string, o: Record<string, unknown> = {}) => ({
  instrumentSymbol: `GEMI-GOLF-RSM-WIN-20261122-${last.toUpperCase()}`,
  label,
  marketState: "open",
  ...o,
});

const rsm = (o: Partial<GeminiEvent> = {}): GeminiEvent => ({
  id: "474060",
  ticker: "GOLF-RSM-WIN-20261122",
  title: "The RSM Classic Winner",
  status: "active",
  template: "sports-golf",
  startTime: "2026-11-19T12:00:00.000Z",
  expiryDate: "2026-11-23T04:00:00.000Z",
  participants: [],
  contracts: [
    golfer("Thorbjornsen", "Michael Thorbjornsen"),
    golfer("Mitchell", "Keith Mitchell"),
    golfer("McNealy", "Maverick McNealy"),
  ],
  ...o,
});

const pred = (o: Partial<Prediction> = {}): Prediction => ({
  betType: "win",
  league: "GOLF",
  team: { name: "Michael Thorbjornsen", aliases: ["Michael Thorbjornsen", "Thorbjornsen"] },
  opponent: null,
  player: "Michael Thorbjornsen",
  metric: null,
  line: null,
  lineAsWritten: null,
  claim: "wins",
  conviction: "strong",
  quote: "Winner is Michael Thorbjornsen",
  ...o,
});

const gemini = (events: GeminiEvent[]) => {
  const searchGames = vi.fn(async () => events);
  const getEvent = vi.fn(async (t: string) => events.find((e) => e.ticker === t)!);
  return { client: { searchGames, getEvent } as unknown as GeminiClient, searchGames, getEvent };
};
const grok: Grok = { json: vi.fn() as never };

describe("golfKind", () => {
  it("maps Grok's metric to Gemini's market kind", () => {
    expect(golfKind(null)).toBe("WIN");
    expect(golfKind("winner")).toBe("WIN");
    expect(golfKind("top 10")).toBe("T10");
    expect(golfKind("Top-5 finish")).toBe("T5");
    expect(golfKind("make cut")).toBe("CUT");
    expect(golfKind("round 2 leader")).toBe("R2");
    expect(golfKind("matchup")).toBeNull();
  });
});

describe("tickerKind / tournamentName", () => {
  it("reads the kind from a golf ticker only", () => {
    expect(tickerKind("GOLF-RSM-WIN-20261122")).toBe("WIN");
    expect(tickerKind("GOLF-MAS-T10-20260412")).toBe("T10");
    expect(tickerKind("NBA-2611190200-LAL-CHA-M")).toBeNull();
  });
  it("strips the market part of the title", () => {
    expect(tournamentName("The RSM Classic Winner")).toBe("The RSM Classic");
    expect(tournamentName("RBC Heritage Winner?")).toBe("RBC Heritage");
    expect(tournamentName("Masters Tournament Top 10 Finish")).toBe("Masters Tournament");
    expect(tournamentName("Austin Championship presented by Compliance Solutions Winner")).toBe("Austin Championship");
  });
});

describe("settledAt for golf", () => {
  it("is when a golfer resolved YES, not when one was resolved NO early", () => {
    const early = rsm({
      contracts: [golfer("Mitchell", "Keith Mitchell", { resolutionSide: "no", resolvedAt: "2026-11-20T01:00:00.000Z" }), golfer("McNealy", "Maverick McNealy")],
    });
    expect(settledAt(early)).toBeNull();
    const done = rsm({
      status: "settled",
      contracts: [
        golfer("Mitchell", "Keith Mitchell", { resolutionSide: "no", resolvedAt: "2026-11-22T23:00:00.000Z" }),
        golfer("McNealy", "Maverick McNealy", { resolutionSide: "yes", resolvedAt: "2026-11-22T23:30:00.000Z" }),
      ],
    });
    expect(settledAt(done)).toBe(Date.parse("2026-11-22T23:30:00.000Z"));
  });
});

describe("pickTournament", () => {
  it("takes the tournament under way at the tweet", () => {
    expect(pickTournament([rsm()], pred(), "WIN", TWEET, "")).toEqual({ game: rsm() });
  });

  it("ignores another kind of market and tournaments without the golfer", () => {
    const t10 = rsm({ ticker: "GOLF-RSM-T10-20261122", title: "The RSM Classic Top 10 Finish" });
    expect(pickTournament([t10], pred(), "WIN", TWEET, "").game).toBeNull();
    expect(pickTournament([rsm()], pred({ team: { name: "Scottie Scheffler", aliases: ["Scheffler"] } }), "WIN", TWEET, "")).toEqual({
      game: null,
      reason: NO_TOURNAMENT_REASON,
    });
  });

  it("prefers the live tournament over next week's, and a tournament the post names over both", () => {
    const next = rsm({ id: "2", ticker: "GOLF-HER-WIN-20261129", title: "Hero World Challenge Winner", startTime: "2026-11-26T12:00:00.000Z" });
    expect(pickTournament([next, rsm()], pred(), "WIN", TWEET, "")?.game?.ticker).toBe("GOLF-RSM-WIN-20261122");
    expect(pickTournament([next, rsm()], pred(), "WIN", TWEET, "Thorbjornsen to win the Hero World Challenge")?.game?.ticker).toBe(
      "GOLF-HER-WIN-20261129",
    );
  });

  it("gives no pick when the golfer's only tournament had settled before the tweet", () => {
    const over = rsm({
      status: "settled",
      contracts: [golfer("Thorbjornsen", "Michael Thorbjornsen", { resolutionSide: "yes", resolvedAt: "2026-11-20T07:00:00.000Z" })],
    });
    expect(pickTournament([over], pred(), "WIN", TWEET, "")).toEqual({ game: null, reason: AFTER_GAME_REASON });
  });
});

describe("matchGolf / matchPrediction", () => {
  it("matches Mugdha's RSM Classic tweet to the golfer's YES contract, searching golf markets of that kind", async () => {
    const g = gemini([rsm()]);
    const m = await matchPrediction(pred(), 0, TWEET, { gemini: g.client, grok, text: "golf the RSM Classic Winner is Michael Thorbjornsen" });
    expect(m).toMatchObject({
      status: "matched",
      reason: "golf WIN Michael Thorbjornsen",
      geminiEventTicker: "GOLF-RSM-WIN-20261122",
      gameTicker: "GOLF-RSM-WIN-20261122",
      instrumentSymbol: "GEMI-GOLF-RSM-WIN-20261122-THORBJORNSEN",
      contractLabel: "Michael Thorbjornsen",
      side: "yes",
      gameStartTime: "2026-11-19T12:00:00.000Z",
      marketStatus: "open",
    });
    expect(g.searchGames).toHaveBeenCalledWith("-WIN-", { sport: "golf", allMarkets: true });
  });

  it("matches a golfer given by last name only, and 'loses' as NO", async () => {
    const m = await matchGolf(pred({ team: { name: "Mitchell", aliases: [] }, claim: "loses" }), 0, TWEET, { gemini: gemini([rsm()]).client });
    expect(m).toMatchObject({ status: "matched", instrumentSymbol: "GEMI-GOLF-RSM-WIN-20261122-MITCHELL", side: "no" });
  });

  it("drops a golfer two contracts could be", async () => {
    const twoMitchells = rsm({ contracts: [golfer("Mitchell", "Keith Mitchell"), golfer("Mitchell2", "Andrew Mitchell")] });
    const m = await matchGolf(pred({ team: { name: "Mitchell", aliases: [] } }), 0, TWEET, { gemini: gemini([twoMitchells]).client });
    expect(m).toMatchObject({ status: "no_market", reason: NO_TOURNAMENT_REASON });
  });

  it("rejects a golfer already resolved NO when the tweet was sent (e.g. withdrew)", async () => {
    const out = rsm({ contracts: [golfer("Thorbjornsen", "Michael Thorbjornsen", { resolutionSide: "no", resolvedAt: "2026-11-20T01:00:00.000Z" })] });
    const m = await matchGolf(pred(), 0, TWEET, { gemini: gemini([out]).client });
    expect(m).toMatchObject({ status: "rejected", reason: "game settled before the tweet" });
  });

  it("gives no market for a golf bet Gemini doesn't list, without searching", async () => {
    const g = gemini([rsm()]);
    const m = await matchGolf(pred({ metric: "matchup" }), 0, TWEET, { gemini: g.client });
    expect(m).toMatchObject({ status: "no_market", reason: NO_GOLF_KIND_REASON });
    expect(g.searchGames).not.toHaveBeenCalled();
  });

  it("gives no market when the found tournament's full event lacks the golfer", async () => {
    const listed = rsm();
    const g = gemini([listed]);
    g.getEvent.mockImplementation(async () => rsm({ contracts: [golfer("McNealy", "Maverick McNealy")] }));
    const m = await matchGolf(pred(), 0, TWEET, { gemini: g.client });
    expect(m).toMatchObject({ status: "no_market", reason: NO_GOLFER_REASON });
  });
});
