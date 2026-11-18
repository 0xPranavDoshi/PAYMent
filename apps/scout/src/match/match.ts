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

/** Map one prediction to a Gemini contract and side. Gemini errors from findGame propagate. */
export async function matchPrediction(
  p: Prediction,
  index: number,
  tweetedAt: Date,
  deps: { gemini: GeminiClient; grok: Grok },
): Promise<PickMatch> {
  const game = await findGame(p, tweetedAt, deps.gemini);
  if (!game) return noMarket(index, "no game within 7 days");
  const sub = subEventFor(game, p);
  if (!sub) return noMarket(index, "no sub-event for bet type");
  const choice = p.betType === "win" ? chooseWin(game, p) : await chooseLine(sub, game, p, deps.grok);
  if (!choice) return noMarket(index, "no contract guaranteed by the claim");

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
