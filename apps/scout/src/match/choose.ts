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
  const matches = teamContracts(game.contracts, p.team);
  // none, or more than one at the best rank (ambiguous): no match
  if (matches.length !== 1) return null;
  const contract = matches[0] as GeminiContract;
  return { subEvent: game, contract, side: p.claim === "wins" ? "yes" : "no", detail: `win ${contract.label}` };
}

function opponentOf(game: GeminiEvent, p: Prediction): TeamRef | null {
  if (p.opponent) return p.opponent;
  const participants = game.participants ?? [];
  const own = bestMatches(p.team, participants, (part) => part);
  if (own.length !== 1) return null;
  const other = participants.find((part) => part !== own[0]);
  if (!other) return null;
  // Contracts use short names ("Lakers"), participants full ones ("Los Angeles Lakers"): also try the
  // name's words, minus any the team itself shares (e.g. "Los Angeles" for two LA teams).
  const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const ownWords = new Set([p.team.name, ...p.team.aliases].flatMap(words));
  return { name: other.name, aliases: [other.abbreviation, ...words(other.name).filter((w) => !ownWords.has(w))] };
}

function strikeOf(c: GeminiContract): number | null {
  if (!c.strike) return null;
  const v = Number(c.strike.value);
  return Number.isFinite(v) ? v : null;
}

/** Apply the line rule: "atMost" keeps v <= L and picks the largest; "atLeast" keeps v >= L and picks the smallest. */
function applyLine(
  sub: GeminiEvent,
  contracts: GeminiContract[],
  kind: string,
  mode: "atMost" | "atLeast",
  side: "yes" | "no",
  L: number,
): Choice | null {
  let best: { c: GeminiContract; v: number } | null = null;
  for (const c of contracts) {
    const v = strikeOf(c);
    if (v === null) continue;
    if (mode === "atMost" ? v > L : v < L) continue;
    if (!best || (mode === "atMost" ? v > best.v : v < best.v)) best = { c, v };
  }
  if (!best) return null;
  return {
    subEvent: sub,
    contract: best.c,
    side,
    detail: `${kind} ${best.v} ${mode === "atMost" ? "<=" : ">="} ${L}`,
  };
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

export async function chooseLine(
  sub: GeminiEvent,
  game: GeminiEvent,
  p: Prediction,
  grok: Grok,
): Promise<Choice | null> {
  if (p.line === null || !Number.isFinite(p.line)) return null;
  // A spread line is a size: "-7" and "7" both mean "by 7"; the claim carries the direction.
  const L = p.betType === "spread" ? Math.abs(p.line) : p.line;

  if (p.betType === "total") {
    if (p.claim === "over") return applyLine(sub, sub.contracts, "total", "atMost", "yes", L);
    if (p.claim === "under") return applyLine(sub, sub.contracts, "total", "atLeast", "no", L);
    return null;
  }

  let mode: "atMost" | "atLeast";
  let side: "yes" | "no";
  let team: TeamRef | null = null;
  let player = "";
  let kind: string;

  if (p.betType === "spread") {
    kind = "spread";
    if (p.claim === "covers" || p.claim === "wins" || p.claim === "over") {
      mode = "atMost";
      side = "yes";
      team = p.team;
    } else if (p.claim === "loses") {
      mode = "atLeast";
      side = "no";
      team = opponentOf(game, p);
      if (!team) return null;
    } else return null;
  } else if (p.betType === "player_prop") {
    kind = "prop";
    if (!p.player) return null;
    player = p.player;
    if (p.claim === "over") {
      mode = "atMost";
      side = "yes";
    } else if (p.claim === "under") {
      mode = "atLeast";
      side = "no";
    } else return null;
  } else return null;

  let contracts = team
    ? teamContracts(sub.contracts, team)
    : sub.contracts.filter((c) => contractMatchesPlayer(c, player));
  // the best-rank matches name two different teams (e.g. a rivalry both names contain): ambiguous
  if (team && spansSubjects(contracts)) return null;
  if (contracts.length === 0) contracts = await grokSubject(sub, team ? team.name : player, grok);
  return applyLine(sub, contracts, kind, mode, side, L);
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
