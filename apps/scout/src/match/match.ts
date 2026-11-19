import type { PickMatch, Prediction } from "@copayme/shared";
import type { GeminiClient } from "../gemini/client.js";
import type { Grok } from "../grok/client.js";
import { findGame } from "./candidates.js";
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

/** Map one prediction to a Gemini contract and side. Gemini errors from findGame propagate. */
export async function matchPrediction(
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
