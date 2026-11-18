import type { Prediction, TeamRef } from "@copayme/shared";
import { z } from "zod";
import type { GeminiContract, GeminiEvent } from "../gemini/types.js";
import { GrokOutputError, type Grok } from "../grok/client.js";
import { aliasesOf, aliasMatches, type Participant } from "./candidates.js";

export interface Choice {
  subEvent: GeminiEvent;
  contract: GeminiContract;
  side: "yes" | "no";
  /** Human-readable line-rule explanation, e.g. "spread 4.5 <= 7". */
  detail?: string;
}

const norm = (s: string) => s.trim().toLowerCase();
const normMetric = (s: string) => norm(s).replace(/s$/, "");

export function subEventFor(game: GeminiEvent, p: Prediction): GeminiEvent | null {
  if (p.betType === "win") return game;
  const children = game.events ?? [];
  if (p.betType === "spread") return children.find((e) => e.template === "sports-spread") ?? null;
  if (p.betType === "total") return children.find((e) => e.template === "sports-total") ?? null;
  if (p.metric === null) return null;
  const metric = normMetric(p.metric);
  return (
    children.find(
      (e) =>
        e.template === "sports-player-props" &&
        e.sportsMarket?.metric !== undefined &&
        normMetric(e.sportsMarket.metric) === metric,
    ) ?? null
  );
}

function contractMatchesTeam(c: GeminiContract, team: TeamRef): boolean {
  const participant: Participant = { name: c.label, abbreviation: c.abbreviatedName ?? "", side: "" };
  return aliasesOf(team).some((a) => aliasMatches(a, participant));
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
  const contract = game.contracts.find((c) => contractMatchesTeam(c, p.team));
  if (!contract) return null;
  return { subEvent: game, contract, side: p.claim === "wins" ? "yes" : "no", detail: `win ${contract.label}` };
}

function opponentOf(game: GeminiEvent, p: Prediction): TeamRef | null {
  if (p.opponent) return p.opponent;
  const teamAliases = aliasesOf(p.team);
  const other = (game.participants ?? []).find((part) => !teamAliases.some((a) => aliasMatches(a, part)));
  if (!other) return null;
  // Contracts use short names ("Lakers"), participants full ones ("Los Angeles Lakers"): also try the
  // name's words, minus any the team itself shares (e.g. "Los Angeles" for two LA teams).
  const words = (s: string) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const own = new Set([p.team.name, ...p.team.aliases].flatMap(words));
  return { name: other.name, aliases: [other.abbreviation, ...words(other.name).filter((w) => !own.has(w))] };
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
  const L = p.line;
  if (L === null || !Number.isFinite(L)) return null;

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

  let contracts = sub.contracts.filter((c) => (team ? contractMatchesTeam(c, team) : contractMatchesPlayer(c, player)));
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
