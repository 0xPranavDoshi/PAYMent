import type { GeminiContract, GeminiEvent } from "../gemini/types.js";

/**
 * Mapping a Gemini contract to its Kalshi twin. Gemini's sports markets mirror Kalshi's (same games,
 * ladders and strikes, verified Nov 18 2026), but the two use different team codes (UConn: UCONN vs
 * CONN), sometimes swap home and away, and spell names differently ("Michigan State" vs "Michigan
 * St."). So we never build Kalshi tickers from Gemini codes: we find the Kalshi event by series, US
 * date and both team names, then the market by team/player name and exact strike. Anything not
 * matching exactly one candidate is left unmatched.
 */

export type KalshiEvent = { event_ticker: string; title?: string | null };
export type KalshiMarket = {
  ticker: string;
  event_ticker?: string;
  yes_sub_title?: string | null;
  floor_strike?: number | null;
  result?: string | null;
  /** When it settled; markets settled before the historical cutoff live under /historical. */
  settlement_ts?: string | null;
};

/** What kind of market a Gemini sub-event is, read from Gemini's own classification. */
export type BetKind =
  | { kind: "win" }
  | { kind: "spread" }
  | { kind: "total" }
  | { kind: "prop"; metric: string };

const SERIES: Record<string, { win?: string; spread?: string; total?: string; props?: Record<string, string> }> = {
  NBA: {
    win: "KXNBAGAME",
    spread: "KXNBASPREAD",
    total: "KXNBATOTAL",
    props: { point: "KXNBAPTS", rebound: "KXNBAREB", assist: "KXNBAAST", three_pointer: "KXNBA3PT" },
  },
  NCAAM: { win: "KXNCAAMBGAME", spread: "KXNCAAMBSPREAD", total: "KXNCAAMBTOTAL" },
  NFL: { win: "KXNFLGAME", spread: "KXNFLSPREAD", total: "KXNFLTOTAL" },
  NCAAF: { win: "KXNCAAFGAME", spread: "KXNCAAFSPREAD", total: "KXNCAAFTOTAL" },
  NHL: { win: "KXNHLGAME", spread: "KXNHLSPREAD", total: "KXNHLTOTAL" },
  EPL: { win: "KXEPLGAME" },
  UCL: { win: "KXUCLGAME" },
  LALIGA: { win: "KXLALIGAGAME" },
  LIGAMX: { win: "KXLIGAMXGAME" },
};

/** The bet kind of `sub` within `game`, or null when it isn't one we can mirror. */
export function betKindOf(game: GeminiEvent, sub: GeminiEvent): BetKind | null {
  if (sub.ticker === game.ticker) return { kind: "win" };
  if (sub.template === "sports-spread") return { kind: "spread" };
  if (sub.template === "sports-total") return { kind: "total" };
  if (sub.template === "sports-player-props" && sub.sportsMarket?.metric) {
    return { kind: "prop", metric: sub.sportsMarket.metric };
  }
  return null;
}

/** The Kalshi series for a Gemini game ticker's league and the bet kind, or null when Kalshi has none. */
export function kalshiSeriesFor(gameTicker: string, bet: BetKind): string | null {
  const league = gameTicker.split("-")[0] ?? "";
  const s = SERIES[league];
  if (!s) return null;
  if (bet.kind === "prop") {
    const metric = bet.metric.toLowerCase().replace(/s$/, "").replace(/[^a-z_]/g, "_");
    return s.props?.[metric] ?? null;
  }
  return s[bet.kind] ?? null;
}

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Kalshi's date code (YYMONDD) for a game start, in US Eastern time: 02:00Z on Nov 18 is "26NOV17". */
export function kalshiDateCode(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "2-digit", month: "numeric", day: "2-digit" })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${MON[Number(parts.month) - 1]}${parts.day}`;
}

/** The date code inside a Kalshi event ticker ("KXNBAGAME-26NOV17NYKTOR" -> "26NOV17"). */
export function eventDateCode(eventTicker: string): string | null {
  return /-(\d{2}[A-Z]{3}\d{2})/.exec(eventTicker)?.[1] ?? null;
}

/** Names compared across the two exchanges: "Michigan State" and "Michigan St." both become "michigan st". */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/&/g, " and ")
    .replace(/\bstate\b/g, "st")
    .replace(/\bsaint\b/g, "st")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The two team names of a title like "UConn vs Arizona" or "Michigan St. vs Tennessee: Spread", sorted. */
export function teamPair(title: string): [string, string] | null {
  const core = title.split(":")[0] ?? "";
  const sides = core.split(/\s+(?:vs\.?|v|at|@)\s+/i);
  if (sides.length !== 2) return null;
  const pair = sides.map(normName).sort() as [string, string];
  return pair[0] && pair[1] ? pair : null;
}

/**
 * The Kalshi event for a Gemini game: same series (the caller lists that series), same US date as
 * the game start, and the same two teams. Exactly one, or null.
 */
export function findKalshiEvent(events: KalshiEvent[], game: GeminiEvent): KalshiEvent | null {
  if (!game.startTime) return null;
  const want = teamPair(game.title);
  if (!want) return null;
  const date = kalshiDateCode(game.startTime);
  const hits = events.filter((e) => {
    if (eventDateCode(e.event_ticker) !== date) return false;
    const pair = e.title ? teamPair(e.title) : null;
    return pair !== null && pair[0] === want[0] && pair[1] === want[1];
  });
  return hits.length === 1 ? (hits[0] as KalshiEvent) : null;
}

const strikeOf = (c: GeminiContract): number | null => {
  const v = c.strike ? Number(c.strike.value) : NaN;
  return Number.isFinite(v) ? v : null;
};

/** "Arizona wins by more than 3.5 points" (Gemini) / "Arizona wins by over 3.5 points" (Kalshi) -> "arizona". */
const spreadTeam = (label: string): string | null => {
  const m = /^(.*?)\s+wins by (?:more than|over)\s+[\d.]+/i.exec(label.trim());
  return m?.[1] ? normName(m[1]) : null;
};

/** "Bam Adebayo 15+ Points" (Gemini) / "Bam Adebayo: 15+" (Kalshi) -> "bam adebayo". */
const propPlayer = (label: string): string | null => {
  const m = /^(.*?)(?::|\s+)\s*\d+\+/.exec(label.trim());
  return m?.[1] ? normName(m[1]) : null;
};

/**
 * The Kalshi market mirroring a Gemini contract: same team or player and the same strike, exactly
 * one. A market whose settled result disagrees with Gemini's is treated as a mismatch.
 */
export function findKalshiMarket(
  markets: KalshiMarket[],
  contract: GeminiContract,
  bet: BetKind,
): { market: KalshiMarket } | { market: null; reason: string } {
  const strike = strikeOf(contract);
  const sameStrike = (m: KalshiMarket) => strike !== null && Number(m.floor_strike) === strike;
  const sub = (m: KalshiMarket) => m.yes_sub_title ?? "";

  let hits: KalshiMarket[];
  if (bet.kind === "win") {
    hits = markets.filter((m) => normName(sub(m)) === normName(contract.label));
  } else if (bet.kind === "spread") {
    const team = spreadTeam(contract.label);
    hits = team ? markets.filter((m) => sameStrike(m) && spreadTeam(sub(m)) === team) : [];
  } else if (bet.kind === "total") {
    hits = /^more than\b/i.test(contract.label) ? markets.filter((m) => sameStrike(m) && /^over\b/i.test(sub(m))) : [];
  } else {
    const player = contract.target?.name ? normName(contract.target.name) : propPlayer(contract.label);
    hits = player ? markets.filter((m) => sameStrike(m) && propPlayer(sub(m)) === player) : [];
  }
  if (hits.length !== 1) return { market: null, reason: `${hits.length} candidate markets` };
  const market = hits[0] as KalshiMarket;
  const kalshiResult = market.result === "yes" || market.result === "no" ? market.result : null;
  if (contract.resolutionSide && kalshiResult && kalshiResult !== contract.resolutionSide) {
    return { market: null, reason: `results disagree (gemini ${contract.resolutionSide}, kalshi ${kalshiResult})` };
  }
  return { market };
}
