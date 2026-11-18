import type { Prediction, TeamRef } from "@copayme/shared";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";

export const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** A tweet this soon after a game involving the team started is a live reaction, not a prediction. */
export const IN_GAME_MS = 6 * 60 * 60 * 1000;

export const NO_GAME_REASON = "no game within 7 days";
export const IN_GAME_REASON = "tweet during game";

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
 * Earliest sports-game that starts after the tweet (strictly) and within 7 days, matching the named teams.
 * A tweet sent while a game involving the team is in progress (within 6 h of its start) gets no game.
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

  let best: { event: GeminiEvent; start: number } | null = null;
  for (const e of matchingEvents(games, p)) {
    const start = startOf(e);
    if (start <= from) return { game: null, reason: IN_GAME_REASON };
    if (!best || start < best.start) best = { event: e, start };
  }
  return best ? { game: best.event } : { game: null, reason: NO_GAME_REASON };
}

export async function findGame(p: Prediction, tweetedAt: Date, gemini: GeminiClient): Promise<GamePick> {
  const byTicker = new Map<string, GeminiEvent>();
  for (const alias of aliasesOf(p.team)) {
    for (const status of ["active", "settled", "under_review"] as const) {
      for (const e of await gemini.searchEvents(alias, status)) {
        if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, e);
      }
    }
  }
  const pick = pickGame([...byTicker.values()], p, tweetedAt);
  return pick.game ? { game: await gemini.getEvent(pick.game.ticker) } : pick;
}
