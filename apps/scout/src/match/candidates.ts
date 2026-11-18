import type { Prediction, TeamRef } from "@copayme/shared";
import type { GeminiClient } from "../gemini/client.js";
import type { GeminiEvent } from "../gemini/types.js";

export const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type Participant = NonNullable<GeminiEvent["participants"]>[number];

const norm = (s: string) => s.trim().toLowerCase();

function aliasesOf(team: TeamRef): string[] {
  return [...new Set([team.name, ...team.aliases].map(norm).filter((a) => a.length > 0))];
}

function aliasMatches(alias: string, p: Participant): boolean {
  const name = norm(p.name);
  if (alias === norm(p.abbreviation) || alias === name) return true;
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(name);
}

function findParticipants(team: TeamRef, participants: Participant[]): Participant[] {
  const aliases = aliasesOf(team);
  return participants.filter((p) => aliases.some((a) => aliasMatches(a, p)));
}

function matchesTeams(e: GeminiEvent, p: Prediction): boolean {
  const participants = e.participants ?? [];
  const teamMatches = findParticipants(p.team, participants);
  if (teamMatches.length === 0) return false;
  if (!p.opponent) return true;
  const oppMatches = findParticipants(p.opponent, participants);
  // the two teams must be two different participants
  return teamMatches.some((t) => oppMatches.some((o) => o !== t));
}

/** Earliest sports-game that starts after the tweet (strictly) and within 7 days, matching the named teams. */
export function pickGame(events: GeminiEvent[], p: Prediction, tweetedAt: Date): GeminiEvent | null {
  const from = tweetedAt.getTime();
  const to = from + MATCH_WINDOW_MS;
  let best: { event: GeminiEvent; start: number } | null = null;
  for (const e of events) {
    if (e.template !== "sports-game" || !e.startTime) continue;
    const start = Date.parse(e.startTime);
    if (Number.isNaN(start) || start <= from || start > to) continue;
    if (!matchesTeams(e, p)) continue;
    if (!best || start < best.start) best = { event: e, start };
  }
  return best?.event ?? null;
}

export async function findGame(
  p: Prediction,
  tweetedAt: Date,
  gemini: GeminiClient,
): Promise<GeminiEvent | null> {
  const byTicker = new Map<string, GeminiEvent>();
  for (const alias of aliasesOf(p.team)) {
    for (const status of ["active", "settled"] as const) {
      for (const e of await gemini.searchEvents(alias, status)) {
        if (!byTicker.has(e.ticker)) byTicker.set(e.ticker, e);
      }
    }
  }
  const chosen = pickGame([...byTicker.values()], p, tweetedAt);
  return chosen ? gemini.getEvent(chosen.ticker) : null;
}
