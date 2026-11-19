import type { Prediction, TeamRef } from "@copayme/shared";
import { z } from "zod";
import type { GeminiContract, GeminiEvent } from "../gemini/types.js";
import { GrokOutputError, type Grok } from "../grok/client.js";
import { bestMatches, type Participant } from "./candidates.js";

export interface Choice {
  subEvent: GeminiEvent;
  contract: GeminiContract;
  side: "yes" | "no";
  /** Human-readable line-rule explanation, e.g. "spread 4.5 <= 7". */
  detail?: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const normMetric = (s: string) => norm(s).replace(/s$/, "");

/** Full-game children only: "half" (e.g. -1HS, -1HT) and other scopes are rejected; no scope is accepted. */
const isFullContest = (e: GeminiEvent): boolean => {
  const scope = e.sportsMarket?.scope?.type;
  return scope === undefined || scope === "full_contest";
};

export function subEventFor(game: GeminiEvent, p: Prediction): GeminiEvent | null {
  if (p.betType === "win") return game;
  const children = (game.events ?? []).filter(isFullContest);
  if (p.betType === "spread") return children.find((e) => e.template === "sports-spread") ?? null;
  if (p.betType === "total") return children.find((e) => e.template === "sports-total") ?? null;
  if (p.metric === null) return null;
  const metric = normMetric(p.metric);
  const props = children.filter(
    (e) =>
      e.template === "sports-player-props" &&
      e.sportsMarket?.metric !== undefined &&
      normMetric(e.sportsMarket.metric) === metric,
  );
  const player = p.player;
  const withPlayer = player ? props.find((e) => e.contracts.some((c) => contractMatchesPlayer(c, player))) : undefined;
  return withPlayer ?? props[0] ?? null;
}

const contractAsParticipant = (c: GeminiContract): Participant => ({
  name: c.label,
  abbreviation: c.abbreviatedName ?? "",
  side: "",
});

/** The team's contracts at the best match rank (exact beats containment). */
function teamContracts(contracts: GeminiContract[], team: TeamRef): GeminiContract[] {
  return bestMatches(team, contracts, contractAsParticipant);
}

/** The game participant that is this team, when exactly one matches. */
function participantFor(game: GeminiEvent, team: TeamRef): Participant | null {
  const own = bestMatches(team, game.participants ?? [], (part) => part);
  return own.length === 1 ? (own[0] as Participant) : null;
}

/**
 * Gemini's short name for a participant, from the game title "Away vs Home" ("San Antonio",
 * "Los Angeles L"). Contracts are labelled with these short names, which Grok's aliases often miss.
 */
function titleName(game: GeminiEvent, part: Participant): string | null {
  const sides = game.title.split(/\s+vs\.?\s+/i);
  if (sides.length !== 2) return null;
  const name = part.side === "away" ? sides[0] : part.side === "home" ? sides[1] : undefined;
  return name?.trim() || null;
}

/** The team plus the game's own names for it (participant name, abbreviation, title short name). */
function withGameNames(game: GeminiEvent, team: TeamRef): TeamRef {
  const part = participantFor(game, team);
  if (!part) return team;
  const short = titleName(game, part);
  return { name: team.name, aliases: [...team.aliases, part.name, part.abbreviation, ...(short ? [short] : [])] };
}

/** True when the contracts name more than one team or player (judged by abbreviatedName / target.name when present). */
function spansSubjects(contracts: GeminiContract[]): boolean {
  const distinct = (vals: (string | undefined)[]) =>
    new Set(vals.filter((v): v is string => !!v).map(norm)).size > 1;
  return distinct(contracts.map((c) => c.abbreviatedName)) || distinct(contracts.map((c) => c.target?.name));
}

function contractMatchesPlayer(c: GeminiContract, player: string): boolean {
  const name = norm(player);
  if (name.length === 0) return false;
  if (c.target && norm(c.target.name) === name) return true;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(norm(c.label));
}

export function chooseWin(game: GeminiEvent, p: Prediction): Choice | null {
  if (p.claim !== "wins" && p.claim !== "loses") return null;
  const matches = teamContracts(game.contracts, withGameNames(game, p.team));
  // none, or more than one at the best rank (ambiguous): no match
  if (matches.length !== 1) return null;
  const contract = matches[0] as GeminiContract;
  return { subEvent: game, contract, side: p.claim === "wins" ? "yes" : "no", detail: `win ${contract.label}` };
}

function opponentOf(game: GeminiEvent, p: Prediction): TeamRef | null {
  const participants = game.participants ?? [];
  // A named opponent is only a hint: Grok sometimes names another parlay leg's team. Use it only when
  // it really is in this game.
  if (p.opponent && participantFor(game, p.opponent)) return withGameNames(game, p.opponent);
  const own = participantFor(game, p.team);
  if (!own) return null;
  const other = participants.find((part) => part !== own);
  if (!other) return null;
  // Contracts use short names ("Lakers"), participants full ones ("Los Angeles Lakers"): also try the
  // title's short name and the name's words, minus any the team itself shares (e.g. "Los Angeles").
  const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const ownWords = new Set([p.team.name, ...p.team.aliases].flatMap(words));
  const short = titleName(game, other);
  return {
    name: other.name,
    aliases: [other.abbreviation, ...(short ? [short] : []), ...words(other.name).filter((w) => !ownWords.has(w))],
  };
}

/** The strike value, or null when missing, non-numeric, or not of the expected strike type. */
function strikeOf(c: GeminiContract, type: string): number | null {
  if (!c.strike || c.strike.type !== type) return null;
  const v = Number(c.strike.value);
  return Number.isFinite(v) ? v : null;
}

/**
 * The line rule: only the contract at exactly the tweet's line, since any other line is a different bet
 * (team decision, Nov 19: +37.5 must not become +40.5). No such contract: no match. Spreads use only
 * "spread" strikes; totals and props only "over" strikes.
 */
function applyLine(
  sub: GeminiEvent,
  contracts: GeminiContract[],
  kind: "spread" | "total" | "prop",
  side: "yes" | "no",
  L: number,
): Choice | null {
  const strikeType = kind === "spread" ? "spread" : "over";
  const exact = contracts.filter((c) => {
    const v = strikeOf(c, strikeType);
    return v !== null && Math.abs(v - L) < 1e-9;
  });
  // two contracts at one line would be ambiguous
  if (exact.length !== 1) return null;
  return { subEvent: sub, contract: exact[0]!, side, detail: `${kind} ${L}` };
}

async function grokSubject(sub: GeminiEvent, subject: string, grok: Grok): Promise<GeminiContract[]> {
  if (sub.contracts.length === 0) return [];
  const symbols = sub.contracts.map((c) => c.instrumentSymbol);
  const schema = z.object({ instrumentSymbols: z.array(z.enum(symbols as [string, ...string[]])) });
  try {
    const out = await grok.json({
      name: "subject_contracts",
      schema,
      system:
        "You pick which prediction-market contracts belong to a named team or player. Return only instrumentSymbols from the allowed list.",
      user: JSON.stringify({
        subject,
        contracts: sub.contracts.map((c) => ({
          instrumentSymbol: c.instrumentSymbol,
          label: c.label,
          abbreviatedName: c.abbreviatedName ?? null,
          target: c.target?.name ?? null,
        })),
      }),
    });
    const wanted = new Set(out.instrumentSymbols);
    return sub.contracts.filter((c) => wanted.has(c.instrumentSymbol));
  } catch (e) {
    if (e instanceof GrokOutputError) return [];
    throw e;
  }
}

/**
 * Direction of a spread pick. The sign Grok copied from the post decides: "+" means the team is the
 * underdog ("loses" by less than L), "-" means the favourite ("covers"). Bettors say "cover" for both
 * sides, so Grok's `claim` is used only when the post writes no sign ("by 7", "to cover").
 */
export function spreadClaim(p: Prediction): Prediction["claim"] {
  const written = (p.lineAsWritten ?? "").trim();
  if (/^\+/.test(written)) return "loses";
  if (/^[-−–]/.test(written)) return "covers";
  return p.claim;
}

export async function chooseLine(
  sub: GeminiEvent,
  game: GeminiEvent,
  p: Prediction,
  grok: Grok,
): Promise<Choice | null> {
  if (p.line === null || !Number.isFinite(p.line)) return null;
  // A spread line is a size: "-7" and "7" both mean "by 7"; the claim carries the direction.
  let L = p.betType === "spread" ? Math.abs(p.line) : p.line;
  // "30+" means at least 30, which for a stat counted in whole numbers is exactly "over 29.5", the same
  // bet. A plain "over 30" is not (it pushes at 30), so only the written "N+" form is converted.
  if (p.betType !== "spread" && /^\s*\d+\s*\+\s*$/.test(p.lineAsWritten ?? "") && Number.isInteger(L)) L -= 0.5;

  if (p.betType === "total") {
    if (p.claim === "over") return applyLine(sub, sub.contracts, "total", "yes", L);
    if (p.claim === "under") return applyLine(sub, sub.contracts, "total", "no", L);
    return null;
  }

  let side: "yes" | "no";
  let team: TeamRef | null = null;
  let player = "";
  let kind: "spread" | "prop";

  if (p.betType === "spread") {
    kind = "spread";
    const claim = spreadClaim(p);
    if (claim === "covers" || claim === "wins" || claim === "over") {
      side = "yes";
      team = withGameNames(game, p.team);
    } else if (claim === "loses") {
      side = "no";
      team = opponentOf(game, p);
      if (!team) return null;
    } else return null;
  } else if (p.betType === "player_prop") {
    kind = "prop";
    if (!p.player) return null;
    player = p.player;
    if (p.claim === "over") {
      side = "yes";
    } else if (p.claim === "under") {
      side = "no";
    } else return null;
  } else return null;

  let contracts = team
    ? teamContracts(sub.contracts, team)
    : sub.contracts.filter((c) => contractMatchesPlayer(c, player));
  // the best-rank matches name two different teams (e.g. a rivalry both names contain): ambiguous
  if (team && spansSubjects(contracts)) return null;
  if (contracts.length > 0) return applyLine(sub, contracts, kind, side, L);

  // Fallback: ask Grok which contracts are the subject's; refuse an answer that spans subjects.
  contracts = await grokSubject(sub, team ? team.name : player, grok);
  if (spansSubjects(contracts)) return null;
  const choice = applyLine(sub, contracts, kind, side, L);
  return choice ? { ...choice, detail: `${choice.detail} (via grok)` } : null;
}

export function validateChoice(game: GeminiEvent, choice: Choice, tweetedAt: Date): string | null {
  const children = game.events ?? [];
  const symbols = new Set(
    [...game.contracts, ...children.flatMap((e) => e.contracts)].map((c) => c.instrumentSymbol),
  );
  if (!symbols.has(choice.contract.instrumentSymbol)) return "contract does not belong to the game";
  if (choice.subEvent !== game && !children.includes(choice.subEvent)) {
    return "sub-event does not belong to the game";
  }
  if (!game.startTime || !(Date.parse(game.startTime) > tweetedAt.getTime())) {
    return "game starts at or before the tweet";
  }
  return null;
}
