import type { PickMatch, Prediction } from "@copayme/shared";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";
import { AFTER_GAME_REASON, MATCH_WINDOW_MS, bestMatches, namedIn, settledAt, type GamePick } from "./candidates.js";
import { chooseWin, validateChoice } from "./choose.js";

/**
 * Golf (added Nov 20 2026). Gemini lists golf per tournament, not per game: one market per kind, with a
 * contract per golfer, ticker GOLF-<code>-<kind>-<end date> ("GOLF-RSM-WIN-20261122"). Kinds seen: WIN
 * (winner), T5/T10/T20 (top-N finish), CUT (makes the cut), R1-R3 (leader after a round). The kind is
 * read from the ticker because the template varies (sports-golf, binary, categorical).
 */
export const GOLF_LEAGUE = "GOLF";
export const NO_GOLF_KIND_REASON = "golf market type not listed on Gemini";
export const NO_TOURNAMENT_REASON = "no golf tournament with this golfer within 7 days";
export const NO_GOLFER_REASON = "golfer not in the tournament's market";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The Gemini market kind a golf pick is on, from Grok's `metric`: null/"win" is the winner, "top 10" a
 * top-10 finish, "make cut", "round 2 leader". Null when Gemini has no such kind (e.g. head-to-head matchups).
 */
export function golfKind(metric: string | null): string | null {
  const m = norm(metric ?? "");
  if (m === "" || /^(to )?(win|wins|winner|outright( winner)?|tournament winner)$/.test(m)) return "WIN";
  const top = m.match(/^top[\s-]*(\d+)( finish)?$/);
  if (top) return `T${top[1]}`;
  if (/^(to )?make[s]? (the )?cut$/.test(m) || m === "cut") return "CUT";
  const round = m.match(/^(round|r)\s*([1-3]) lead(er)?$/);
  if (round) return `R${round[2]}`;
  return null;
}

/** The kind segment of a golf ticker (GOLF-RSM-WIN-20261122 -> WIN), or null for another sport. */
export function tickerKind(ticker: string): string | null {
  const parts = ticker.split("-");
  return parts.length >= 4 && parts[0] === "GOLF" ? parts[2]! : null;
}

/** The tournament's own name from a market title: "The RSM Classic Winner" -> "The RSM Classic". */
export function tournamentName(title: string): string {
  return title
    .replace(/\?$/, "")
    .replace(/\s+(winner|top \d+ finish(er)?|make the cut|end of round \d leader)$/i, "")
    .replace(/\s+presented by .*$/i, "")
    .trim();
}

const golferContracts = (e: GeminiEvent, p: Prediction) =>
  bestMatches(p.team, e.contracts, (c) => ({ name: c.label, abbreviation: c.abbreviatedName ?? "", side: "" }));

/**
 * The tournament a golf pick is about: markets of the pick's kind with exactly one contract for the golfer,
 * starting within 7 days after the tweet (or already under way). A tournament the post names is preferred.
 * Then one live at the tweet (started, not settled), else the earliest to start. Only tournaments that had
 * settled before the tweet: the tweet came after it (no pick).
 */
export function pickTournament(events: GeminiEvent[], p: Prediction, kind: string, tweetedAt: Date, text: string): GamePick {
  const t = tweetedAt.getTime();
  const startOf = (e: GeminiEvent) => Date.parse(e.startTime ?? "");
  let found = events.filter((e) => {
    const start = startOf(e);
    return (
      tickerKind(e.ticker) === kind &&
      !Number.isNaN(start) &&
      start <= t + MATCH_WINDOW_MS &&
      start > t - MATCH_WINDOW_MS &&
      golferContracts(e, p).length === 1
    );
  });
  if (found.length === 0) return { game: null, reason: NO_TOURNAMENT_REASON };

  const open = found.filter((e) => {
    const settled = settledAt(e);
    return settled === null || settled > t;
  });
  if (open.length === 0) return { game: null, reason: AFTER_GAME_REASON };
  found = open;

  const named = found.filter((e) => {
    const name = tournamentName(e.title);
    return namedIn({ name, aliases: [name.replace(/^the\s+/i, "")] }, text);
  });
  if (named.length > 0) found = named;

  const live = found.filter((e) => startOf(e) <= t).sort((a, b) => startOf(b) - startOf(a));
  if (live.length > 0) return { game: live[0]! };
  return { game: [...found].sort((a, b) => startOf(a) - startOf(b))[0]! };
}

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

/**
 * Map a golf prediction (the golfer in `team`, the market kind in `metric`) to the golfer's contract in
 * the tournament's market: YES for "wins" (backs the golfer to do it), NO for "loses".
 */
export async function matchGolf(
  p: Prediction,
  index: number,
  tweetedAt: Date,
  deps: { gemini: GeminiClient; text?: string },
): Promise<PickMatch> {
  const kind = golfKind(p.metric);
  if (!kind) return noMarket(index, NO_GOLF_KIND_REASON);
  // Tickers carry the kind ("-WIN-"), and Gemini's search matches tickers: one search finds every
  // tournament of this kind, past and upcoming (about one a week).
  const events = await deps.gemini.searchGames(`-${kind}-`, { sport: "golf", allMarkets: true });
  const pick = pickTournament(events, p, kind, tweetedAt, `${deps.text ?? ""} ${p.quote}`);
  if (!pick.game) return noMarket(index, pick.reason);
  const game = await deps.gemini.getEvent(pick.game.ticker);
  const choice = chooseWin(game, p);
  if (!choice) return noMarket(index, NO_GOLFER_REASON);
  const rejection = validateChoice(game, choice, tweetedAt);
  return {
    predictionIndex: index,
    status: rejection ? "rejected" : "matched",
    reason: rejection ?? `golf ${kind} ${choice.contract.label}`,
    geminiEventTicker: game.ticker,
    gameTicker: game.ticker,
    instrumentSymbol: choice.contract.instrumentSymbol,
    contractLabel: choice.contract.label,
    side: choice.side,
    gameStartTime: game.startTime ?? null,
    marketStatus: game.status === "settled" ? "settled" : "open",
    resolutionSide: choice.contract.resolutionSide ?? null,
  };
}
