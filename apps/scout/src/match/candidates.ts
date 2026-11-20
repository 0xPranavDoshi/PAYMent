import type { Prediction, TeamRef } from "@copayme/shared";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";

export const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Games that started up to this long before the tweet are looked at: one still live at the tweet is the
 * pick's game; one that had already settled means the tweet came after it.
 */
export const IN_GAME_MS = 6 * 60 * 60 * 1000;

export const NO_GAME_REASON = "no game within 7 days";
export const AFTER_GAME_REASON = "tweet after the game settled";

export type Participant = NonNullable<GeminiEvent["participants"]>[number];

export type GamePick = { game: GeminiEvent } | { game: null; reason: string };

const norm = (s: string) => s.trim().toLowerCase();

export function aliasesOf(team: TeamRef): string[] {
  return [...new Set([team.name, ...team.aliases].map(norm).filter((a) => a.length > 0))];
}

/** 2 = exact (alias equals name or abbreviation), 1 = whole word(s) of the name, 0 = no match. */
export function aliasRank(alias: string, p: Participant): number {
  const name = norm(p.name);
  if (alias === norm(p.abbreviation) || alias === name) return 2;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(name) ? 1 : 0;
}

/** True when one of the team's names (3+ characters) appears as whole words in the text, ignoring case. */
export function namedIn(team: TeamRef, text: string): boolean {
  const t = norm(text);
  return aliasesOf(team).some((a) => {
    if (a.length < 3) return false;
    const escaped = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(t);
  });
}

/** The best rank any of the team's aliases reaches on this participant. */
export function teamRank(team: TeamRef, p: Participant): number {
  return Math.max(0, ...aliasesOf(team).map((a) => aliasRank(a, p)));
}

/**
 * The items matching the team at the best rank found among them: an exact match anywhere means
 * containment matches are ignored. Empty when nothing matches.
 */
export function bestMatches<T>(team: TeamRef, items: T[], toParticipant: (t: T) => Participant): T[] {
  const ranks = items.map((t) => teamRank(team, toParticipant(t)));
  const best = Math.max(0, ...ranks);
  return best === 0 ? [] : items.filter((_, i) => ranks[i] === best);
}

/**
 * Events whose participants include the team (and the opponent, when named) as exactly one participant
 * each, at the best rank found across all the events.
 */
function matchingEvents(events: GeminiEvent[], p: Prediction): GeminiEvent[] {
  const all = events.flatMap((e) => e.participants ?? []);
  const bestRank = (team: TeamRef) => Math.max(0, ...all.map((x) => teamRank(team, x)));
  const teamBest = bestRank(p.team);
  const oppBest = p.opponent ? bestRank(p.opponent) : 0;
  if (teamBest === 0 || (p.opponent && oppBest === 0)) return [];
  return events.filter((e) => {
    const parts = e.participants ?? [];
    const own = parts.filter((x) => teamRank(p.team, x) === teamBest);
    // more than one participant at the best rank (e.g. a rivalry both names contain) is ambiguous
    if (own.length !== 1) return false;
    if (!p.opponent) return true;
    const opponent = p.opponent;
    const opp = parts.filter((x) => teamRank(opponent, x) === oppBest);
    return opp.length === 1 && opp[0] !== own[0];
  });
}

/**
 * The game a pick is about, matching the named teams: one live at the tweet (started, not yet settled), else
 * the earliest that starts after the tweet, within 7 days. A tweet sent after the team's game settled (within
 * 6 h of its start) gets no game.
 */
export function pickGame(events: GeminiEvent[], p: Prediction, tweetedAt: Date): GamePick {
  const from = tweetedAt.getTime();
  const to = from + MATCH_WINDOW_MS;
  const startOf = (e: GeminiEvent) => Date.parse(e.startTime as string);
  let games = events.filter((e) => {
    if (e.template !== "sports-game" || !e.startTime) return false;
    const start = startOf(e);
    return !Number.isNaN(start) && start > from - IN_GAME_MS && start <= to;
  });
  if (p.league) {
    const prefix = `${p.league.trim().toUpperCase()}-`;
    if (games.some((e) => e.ticker.startsWith(prefix))) games = games.filter((e) => e.ticker.startsWith(prefix));
  }

  // A named opponent narrows the search, but Grok sometimes names another parlay leg's team: when no
  // game has both, fall back to the team alone. Not when the pick's own words name the opponent, though:
  // then that game is the one meant, and it isn't ahead (e.g. a recap, "Chargers 23, Ravens 20"), so
  // the team's next game would be a pick nobody made.
  let matches = matchingEvents(games, p);
  if (matches.length === 0 && p.opponent) {
    if (namedIn(p.opponent, p.quote)) return { game: null, reason: NO_GAME_REASON };
    matches = matchingEvents(games, { ...p, opponent: null });
  }

  // A game already under way when the tweet was sent counts while it hadn't settled (team decision,
  // Nov 19: live picks count; the cutoff is settlement, which Gemini does at the final whistle, 2.5-3.8 h
  // after the start. expiryDate is start + 36 h, not the end). A game that had already settled means the
  // tweet came after it ended: no game, so a post-game reaction can't land on the team's next game.
  let best: { event: GeminiEvent; start: number } | null = null;
  for (const e of matches) {
    const start = startOf(e);
    if (start <= from) {
      const settled = settledAt(e);
      if (settled !== null && settled <= from) return { game: null, reason: AFTER_GAME_REASON };
      return { game: e }; // live at the tweet
    }
    if (!best || start < best.start) best = { event: e, start };
  }
  return best ? { game: best.event } : { game: null, reason: NO_GAME_REASON };
}

/** When the game settled (its first contract's resolvedAt), or null if it hasn't. */
export function settledAt(game: GeminiEvent): number | null {
  const times = game.contracts.map((c) => (c.resolvedAt ? Date.parse(c.resolvedAt) : NaN)).filter((t) => !Number.isNaN(t));
  return times.length > 0 ? Math.min(...times) : null;
}

/** Gemini's ticker league codes (verified Nov 18 2026) and the `sport` filter value for each. */
export const LEAGUE_SPORT: Record<string, string> = {
  NBA: "basketball",
  WNBA: "basketball",
  NCAAM: "basketball",
  NCAAW: "basketball",
  NFL: "american_football",
  NCAAF: "american_football",
  NHL: "hockey",
  MLB: "baseball",
  EPL: "soccer",
  LALIGA: "soccer",
  UCL: "soccer",
  LIGAMX: "soccer",
  MLS: "soccer",
};

/** Common names for the same leagues that bettors (and Grok) use. */
const LEAGUE_SYNONYMS: Record<string, string> = {
  NCAAB: "NCAAM",
  CBB: "NCAAM",
  CFB: "NCAAF",
  PREMIERLEAGUE: "EPL",
  CHAMPIONSLEAGUE: "UCL",
};

/** Gemini's ticker code for a league name, or null when it isn't a league Gemini lists. */
export function geminiLeague(league: string | null): string | null {
  if (!league) return null;
  const key = league.toUpperCase().replace(/[^A-Z]/g, "");
  const code = LEAGUE_SYNONYMS[key] ?? key;
  return code in LEAGUE_SPORT ? code : null;
}

/** UTC days (YYMMDD, as tickers encode them) that a matching game could start on. */
export function windowDays(tweetedAt: Date): string[] {
  const yymmdd = (ms: number) => new Date(ms).toISOString().slice(2, 10).replace(/-/g, "");
  const from = tweetedAt.getTime() - IN_GAME_MS;
  const to = tweetedAt.getTime() + MATCH_WINDOW_MS;
  const days = new Set<string>();
  for (let t = from; t < to; t += 24 * 60 * 60 * 1000) days.add(yymmdd(t));
  days.add(yymmdd(to));
  return [...days];
}

/** Aliases written as ticker team codes ("LAL", "UCONN"): 2-6 capital letters, as Grok gives abbreviations. */
const teamCodes = (team: TeamRef) =>
  [...new Set([team.name, ...team.aliases].map((a) => a.trim()))].filter((a) => /^[A-Z]{2,6}$/.test(a));

/**
 * Finds the game a prediction refers to. Gemini can't filter by date or team, but its search also
 * matches tickers (`NCAAM-2611190200-UCONN-ARI-M`), so we search, in order, until a tier decides:
 *   1. league + each UTC day in the window (`NCAAM-261119`): small, exact date filter;
 *   2. the team's ticker code (`-UCONN-`);
 *   3. the team's names in titles (also covers older tickers without dates).
 * Teams and the time window are then matched in code against the returned games.
 */
export async function findGame(p: Prediction, tweetedAt: Date, gemini: GeminiClient): Promise<GamePick> {
  const league = geminiLeague(p.league);
  const sport = league ? LEAGUE_SPORT[league] : undefined;
  const prediction = { ...p, league };
  const tiers: string[][] = [
    league ? windowDays(tweetedAt).map((d) => `${league}-${d}`) : [],
    teamCodes(p.team).map((c) => `-${c}-`),
    aliasesOf(p.team),
  ];
  let last: GamePick = { game: null, reason: NO_GAME_REASON };
  for (const terms of tiers) {
    if (terms.length === 0) continue;
    const results = await Promise.all(terms.map((t) => gemini.searchGames(t, sport ? { sport } : {})));
    const byTicker = new Map<string, GeminiEvent>();
    for (const e of results.flat()) if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, e);
    last = pickGame([...byTicker.values()], prediction, tweetedAt);
    if (last.game) return { game: await gemini.getEvent(last.game.ticker) };
    if (last.reason === AFTER_GAME_REASON) return last;
  }
  return last;
}
