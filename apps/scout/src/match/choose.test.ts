import type { Prediction } from "@copayme/shared";
import { describe, expect, it, vi } from "vitest";
import type { GeminiContract, GeminiEvent } from "../gemini/types.js";
import { GrokOutputError, type Grok } from "../grok/client.js";
import { chooseLine, chooseWin, subEventFor, validateChoice, type Choice } from "./choose.js";

const TWEET = new Date("2026-11-18T12:00:00.000Z");

const c = (symbol: string, label: string, o: Partial<GeminiContract> = {}): GeminiContract => ({
  instrumentSymbol: symbol,
  label,
  marketState: "open",
  ...o,
});

const spreadC = (team: string, v: string) =>
  c(`SYM-S-${team}-${v}`, `${team} wins by more than ${v} points`, {
    abbreviatedName: team,
    strike: { type: "spread", value: v },
  });
const totalC = (v: string) =>
  c(`SYM-T-${v}`, `More than ${v} points scored`, { strike: { type: "over", value: v } });
const propC = (name: string, v: string) =>
  c(`SYM-P-${name}-${v}`, `${name} ${Math.ceil(Number(v))}+ Points`, {
    target: { name },
    strike: { type: "over", value: v },
  });

const ev = (o: Partial<GeminiEvent> & { ticker: string }): GeminiEvent => ({
  id: o.ticker,
  title: o.ticker,
  status: "active",
  contracts: [],
  ...o,
});

const spreadEv = ev({
  ticker: "S",
  template: "sports-spread",
  contracts: [
    spreadC("Lakers", "1.5"),
    spreadC("Lakers", "4.5"),
    spreadC("Lakers", "7.5"),
    spreadC("Hornets", "1.5"),
    spreadC("Hornets", "4.5"),
    spreadC("Hornets", "7.5"),
  ],
});
const totalEv = ev({
  ticker: "T",
  template: "sports-total",
  contracts: [totalC("134.5"), totalC("140.5"), totalC("143.5"), totalC("215.5"), totalC("219.5"), totalC("224.5")],
});
const propEv = ev({
  ticker: "P",
  template: "sports-player-props",
  sportsMarket: { metric: "points" },
  contracts: [propC("LeBron James", "24.5"), propC("LeBron James", "29.5"), propC("LeBron James", "34.5")],
});
const game = ev({
  ticker: "G",
  template: "sports-game",
  startTime: "2026-11-19T02:00:00.000Z",
  participants: [
    { name: "Los Angeles Lakers", abbreviation: "LAL", side: "home" },
    { name: "Charlotte Hornets", abbreviation: "CHA", side: "away" },
  ],
  contracts: [
    c("SYM-M-LAL", "Lakers", { abbreviatedName: "LAL" }),
    c("SYM-M-CHA", "Hornets", { abbreviatedName: "CHA" }),
  ],
  events: [spreadEv, totalEv, propEv],
});

const team = { name: "Los Angeles Lakers", aliases: ["Lakers", "LAL"] };
const opp = { name: "Charlotte Hornets", aliases: ["Hornets", "CHA"] };
const pred = (o: Partial<Prediction>): Prediction => ({
  betType: "spread",
  league: "NBA",
  team,
  opponent: null,
  player: null,
  metric: null,
  line: null,
  claim: "covers",
  conviction: "strong",
  quote: "q",
  ...o,
});

const noGrok = (): Grok => ({ json: vi.fn(async () => Promise.reject(new Error("grok should not be called"))) });

describe("subEventFor", () => {
  it("maps bet types to sub-events", () => {
    expect(subEventFor(game, pred({ betType: "win" }))).toBe(game);
    expect(subEventFor(game, pred({ betType: "spread" }))).toBe(spreadEv);
    expect(subEventFor(game, pred({ betType: "total" }))).toBe(totalEv);
    expect(subEventFor(game, pred({ betType: "player_prop", metric: "Point" }))).toBe(propEv);
    expect(subEventFor(game, pred({ betType: "player_prop", metric: "assists" }))).toBeNull();
    expect(subEventFor(game, pred({ betType: "player_prop", metric: null }))).toBeNull();
  });
});

describe("chooseLine", () => {
  it("Lakers by 7 -> 4.5 yes (largest v <= 7)", async () => {
    const r = await chooseLine(spreadEv, game, pred({ line: 7 }), noGrok());
    expect(r?.contract.strike?.value).toBe("4.5");
    expect(r?.contract.label).toContain("Lakers");
    expect(r?.side).toBe("yes");
  });

  it("covers 5.5 with a 5.5 line includes equality", async () => {
    const sub = ev({ ticker: "S2", contracts: [spreadC("Lakers", "3.5"), spreadC("Lakers", "5.5")] });
    const r = await chooseLine(sub, game, pred({ line: 5.5 }), noGrok());
    expect(r?.contract.strike?.value).toBe("5.5");
    expect(r?.side).toBe("yes");
  });

  it("over 220 on totals -> 219.5 yes", async () => {
    const sub = ev({
      ticker: "T2",
      contracts: [totalC("215.5"), totalC("219.5"), totalC("224.5")],
    });
    const r = await chooseLine(sub, game, pred({ betType: "total", claim: "over", line: 220 }), noGrok());
    expect(r?.contract.strike?.value).toBe("219.5");
    expect(r?.side).toBe("yes");
  });

  it("under 140 on totals -> 140.5 no", async () => {
    const sub = ev({
      ticker: "T3",
      contracts: [totalC("134.5"), totalC("140.5"), totalC("143.5")],
    });
    const r = await chooseLine(sub, game, pred({ betType: "total", claim: "under", line: 140 }), noGrok());
    expect(r?.contract.strike?.value).toBe("140.5");
    expect(r?.side).toBe("no");
  });

  it("LeBron 30+ -> 29.5 yes", async () => {
    const r = await chooseLine(
      propEv,
      game,
      pred({ betType: "player_prop", player: "lebron james", metric: "points", claim: "over", line: 30 }),
      noGrok(),
    );
    expect(r?.contract.strike?.value).toBe("29.5");
    expect(r?.side).toBe("yes");
  });

  it("underdog +4.5 (loses) uses the opponent's 4.5 spread, no", async () => {
    const r = await chooseLine(spreadEv, game, pred({ team: opp, opponent: null, claim: "loses", line: 4.5 }), noGrok());
    expect(r?.contract.label).toContain("Lakers");
    expect(r?.contract.strike?.value).toBe("4.5");
    expect(r?.side).toBe("no");
  });

  it("uses p.opponent when given for the underdog rule", async () => {
    const r = await chooseLine(spreadEv, game, pred({ team: opp, opponent: team, claim: "loses", line: 4.5 }), noGrok());
    expect(r?.contract.label).toContain("Lakers");
  });

  it("a line below every contract -> null", async () => {
    expect(await chooseLine(spreadEv, game, pred({ line: 1 }), noGrok())).toBeNull();
  });

  it("line null -> null", async () => {
    expect(await chooseLine(spreadEv, game, pred({ line: null }), noGrok())).toBeNull();
  });

  it("falls back to grok once when the player is not found, then applies the line rule", async () => {
    const sub = ev({
      ticker: "P2",
      contracts: [
        c("GEMI-X-1", "J. Smith 24+ Points", { strike: { type: "over", value: "23.5" } }),
        c("GEMI-X-2", "J. Smith 29+ Points", { strike: { type: "over", value: "28.5" } }),
      ],
    });
    const grok: Grok = { json: vi.fn(async () => ({ instrumentSymbols: ["GEMI-X-2", "GEMI-X-1"] }) as never) };
    const r = await chooseLine(
      sub,
      game,
      pred({ betType: "player_prop", player: "Jaylen Smith", metric: "points", claim: "over", line: 30 }),
      grok,
    );
    expect(grok.json).toHaveBeenCalledTimes(1);
    expect(r?.contract.instrumentSymbol).toBe("GEMI-X-2");
  });

  it("grok fallback symbol outside the list -> null (schema is an enum of the sub-event symbols)", async () => {
    const sub = ev({
      ticker: "P3",
      contracts: [c("GEMI-X-1", "J. Smith 24+ Points", { strike: { type: "over", value: "23.5" } })],
    });
    const grok: Grok = {
      json: vi.fn(async ({ schema }) => {
        const parsed = schema.safeParse({ instrumentSymbols: ["GEMI-BOGUS"] });
        if (!parsed.success) throw new GrokOutputError("invalid");
        return parsed.data;
      }),
    };
    const r = await chooseLine(
      sub,
      game,
      pred({ betType: "player_prop", player: "Jaylen Smith", metric: "points", claim: "over", line: 30 }),
      grok,
    );
    expect(r).toBeNull();
  });

  it("does not call grok for an empty sub-event or for totals", async () => {
    const grok = noGrok();
    const empty = ev({ ticker: "E", contracts: [] });
    expect(
      await chooseLine(empty, game, pred({ betType: "player_prop", player: "X Y", claim: "over", line: 5 }), grok),
    ).toBeNull();
    expect(await chooseLine(empty, game, pred({ betType: "total", claim: "over", line: 5 }), grok)).toBeNull();
    expect(grok.json).not.toHaveBeenCalled();
  });
});

describe("chooseWin", () => {
  it("wins -> team contract, yes; loses -> same contract, no", () => {
    const w = chooseWin(game, pred({ betType: "win", claim: "wins" }));
    expect(w?.contract.instrumentSymbol).toBe("SYM-M-LAL");
    expect(w?.side).toBe("yes");
    const l = chooseWin(game, pred({ betType: "win", claim: "loses" }));
    expect(l?.contract.instrumentSymbol).toBe("SYM-M-LAL");
    expect(l?.side).toBe("no");
  });

  it("other claims -> null; unknown team -> null", () => {
    expect(chooseWin(game, pred({ betType: "win", claim: "covers" }))).toBeNull();
    expect(chooseWin(game, pred({ betType: "win", team: { name: "Celtics", aliases: [] } }))).toBeNull();
  });
});

describe("validateChoice", () => {
  const ok: Choice = { subEvent: spreadEv, contract: spreadEv.contracts[0] as GeminiContract, side: "yes" };

  it("accepts a contract from the game tree", () => {
    expect(validateChoice(game, ok, TWEET)).toBeNull();
  });

  it("rejects a contract outside the tree", () => {
    const bad: Choice = { ...ok, contract: c("OTHER", "x") };
    expect(validateChoice(game, bad, TWEET)).toMatch(/contract/);
  });

  it("rejects a sub-event outside the tree", () => {
    expect(validateChoice(game, { ...ok, subEvent: ev({ ticker: "Z" }) }, TWEET)).toMatch(/sub-event/);
  });

  it("rejects a game that starts at or before the tweet", () => {
    expect(validateChoice(game, ok, new Date(game.startTime as string))).toMatch(/starts/);
    expect(validateChoice(game, ok, new Date("2026-11-20T00:00:00Z"))).toMatch(/starts/);
  });
});
