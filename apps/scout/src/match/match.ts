import type { PickMatch, Prediction } from "@copayme/shared";
import type { GeminiClient } from "../gemini/client.js";
import type { Grok } from "../grok/client.js";
import { findGame, geminiLeague } from "./candidates.js";
import { chooseLine, chooseWin, subEventFor, validateChoice } from "./choose.js";

const noMarket = (predictionIndex: number, reason: string): PickMatch => ({
  predictionIndex,
  status: "no_market",
  reason,
  geminiEventTicker: null,
  gameTicker: null,
  instrumentSymbol: null,
  contractLabel: null,
  side: null,
  gameStartTime: null,
  marketStatus: null,
  resolutionSide: null,
});

export const TEAM_TOTAL_REASON = "team totals aren't listed on Gemini";
/** The game came back with no child markets at all; Gemini sometimes omits them, so this is retried. */
export const NO_SUB_MARKETS_REASON = "game returned without sub-markets";
/** No contract at the tweet's line (a whole number may take the half-point line next to it). */
export const NO_LINE_REASON = "no contract at the tweet's line";
/** Fetches of a game (counting findGame's) while it comes back without its child markets, and the wait between. */
const SUB_MARKET_TRIES = 5;
const SUB_MARKET_WAIT_MS = 1_000;

/** College leagues whose teams share a school name, so "Temple -4.5" alone could be either sport. */
const COLLEGE_SIBLINGS: Record<string, string> = { NCAAM: "NCAAF", NCAAF: "NCAAM" };
export const AMBIGUOUS_SPORT_REASON = "ambiguous: the bet is on both the team's football and basketball games";
/** Words and emoji that say which sport a post is about; when present, Grok's league is kept. */
const SPORT_CUE =
  /🏀|🏈|\b(cbb|cfb|ncaab|ncaam|ncaaf|ncaa ?(fb|bb|football|basketball)|college (football|basketball|hoops)|basketball|hoops?|football|gridiron|bowl game|touchdowns?|march madness|final four)\b/i;

/**
 * Map one prediction to a Gemini contract and side. Gemini errors from findGame propagate.
 * `text`: the post (and quoted post). For a college pick whose post doesn't say the sport, Grok's league
 * is a guess (a school plays both), so both college football and basketball are tried: the pick matches
 * only if exactly one of them has the exact bet, and is dropped as ambiguous if both do (team decision,
 * Nov 20, from "take temple -4.5" during Temple's football game, read as basketball).
 */
export async function matchPrediction(
  p: Prediction,
  index: number,
  tweetedAt: Date,
  deps: { gemini: GeminiClient; grok: Grok; sleep?: (ms: number) => Promise<void>; text?: string },
): Promise<PickMatch> {
  const first = await matchInLeague(p, index, tweetedAt, deps);
  if (!checksBothCollegeSports(p, deps.text ?? "")) return first;
  const sibling = COLLEGE_SIBLINGS[geminiLeague(p.league)!]!;
  const other = await matchInLeague({ ...p, league: sibling }, index, tweetedAt, deps);
  if (first.status === "matched" && other.status === "matched") return noMarket(index, AMBIGUOUS_SPORT_REASON);
  if (other.status === "matched") return other;
  // Say that both sports were checked (a stored plain NO_LINE_REASON on such a pick predates this rule).
  return first.reason === NO_LINE_REASON ? { ...first, reason: NO_LINE_BOTH_SPORTS_REASON } : first;
}

export const NO_LINE_BOTH_SPORTS_REASON = "no contract at the tweet's line in football or basketball";

/** True for a college pick whose post doesn't say the sport: it is checked in both college sports. */
export function checksBothCollegeSports(p: Prediction, text: string): boolean {
  const league = geminiLeague(p.league);
  return league !== null && league in COLLEGE_SIBLINGS && !SPORT_CUE.test(`${text} ${p.quote}`);
}

async function matchInLeague(
  p: Prediction,
  index: number,
  tweetedAt: Date,
  deps: { gemini: GeminiClient; grok: Grok; sleep?: (ms: number) => Promise<void> },
): Promise<PickMatch> {
  if (p.betType === "team_total") return noMarket(index, TEAM_TOTAL_REASON);
  const pick = await findGame(p, tweetedAt, deps.gemini);
  if (!pick.game) return noMarket(index, pick.reason);
  let game = pick.game;
  // Gemini often returns a game without its child markets (the same request alternates between with and
  // without: measured Nov 19, up to 3 misses in a row), so ask again a few times before giving up.
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; p.betType !== "win" && !(game.events?.length) && i < SUB_MARKET_TRIES; i++) {
    await sleep(SUB_MARKET_WAIT_MS);
    game = await deps.gemini.getEvent(game.ticker);
  }
  const sub = subEventFor(game, p);
  if (!sub && p.betType !== "win" && (game.events ?? []).length === 0) return noMarket(index, NO_SUB_MARKETS_REASON);
  if (!sub) return noMarket(index, "no sub-event for bet type");
  const choice = p.betType === "win" ? chooseWin(game, p) : await chooseLine(sub, game, p, deps.grok);
  if (!choice) return noMarket(index, NO_LINE_REASON);

  const rejection = validateChoice(game, choice, tweetedAt);
  return {
    predictionIndex: index,
    status: rejection ? "rejected" : "matched",
    reason: rejection ?? choice.detail ?? "matched",
    geminiEventTicker: choice.subEvent.ticker,
    gameTicker: game.ticker,
    instrumentSymbol: choice.contract.instrumentSymbol,
    contractLabel: choice.contract.label,
    side: choice.side,
    gameStartTime: game.startTime ?? null,
    marketStatus: game.status === "settled" ? "settled" : "open",
    resolutionSide: choice.contract.resolutionSide ?? null,
  };
}
