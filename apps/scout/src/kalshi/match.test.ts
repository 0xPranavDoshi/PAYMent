import { describe, expect, it } from "vitest";
import props from "../../test/fixtures/kalshi-markets-props.json" with { type: "json" };
import spread from "../../test/fixtures/kalshi-markets-spread.json" with { type: "json" };
import type { GeminiContract, GeminiEvent } from "../gemini/types.js";
import {
  betKindOf,
  eventDateCode,
  findKalshiEvent,
  findKalshiMarket,
  kalshiDateCode,
  kalshiSeriesFor,
  normName,
  teamPair,
  type KalshiMarket,
} from "./match.js";

const game = (o: Partial<GeminiEvent> & { ticker: string; title: string }): GeminiEvent => ({
  id: o.ticker,
  status: "settled",
  template: "sports-game",
  startTime: "2026-11-18T02:00:00.000Z",
  contracts: [],
  ...o,
});
const contract = (label: string, o: Partial<GeminiContract> = {}): GeminiContract => ({
  instrumentSymbol: `GEMI-${label}`,
  label,
  marketState: "closed",
  ...o,
});
const spreadMarkets = spread.markets as KalshiMarket[];
const propMarkets = props.markets as KalshiMarket[];

describe("names, titles and dates", () => {
  it("normalizes the two exchanges' spellings to the same name", () => {
    expect(normName("Michigan State")).toBe(normName("Michigan St."));
    expect(normName("Saint Mary's")).toBe(normName("St. Mary's"));
    expect(normName("Texas A&M")).toBe("texas a and m");
    expect(normName("Miami (FL)")).toBe("miami");
  });

  it("reads a title's two teams order-insensitively, ignoring the market suffix", () => {
    expect(teamPair("Florida vs Notre Dame: Spread")).toEqual(teamPair("Notre Dame vs Florida"));
    expect(teamPair("Michigan St. vs Tennessee: Spread")).toEqual(["michigan st", "tennessee"]);
    expect(teamPair("Bucks at Heat")).toEqual(["bucks", "heat"]);
    expect(teamPair("Super Bowl Champion")).toBeNull();
  });

  it("uses the US Eastern date of the game start, like Kalshi tickers", () => {
    expect(kalshiDateCode("2026-11-18T02:00:00.000Z")).toBe("26NOV17"); // 9 pm ET on the 17th
    expect(kalshiDateCode("2026-11-18T17:00:00.000Z")).toBe("26NOV18");
    expect(eventDateCode("KXNCAAMBSPREAD-26NOV17MSUTENN")).toBe("26NOV17");
  });

  it("maps Gemini leagues and bet kinds to Kalshi series", () => {
    expect(kalshiSeriesFor("NCAAM-2611180200-MSU-TENN-M", { kind: "spread" })).toBe("KXNCAAMBSPREAD");
    expect(kalshiSeriesFor("NBA-2611180030-NYK-TOR-M", { kind: "win" })).toBe("KXNBAGAME");
    expect(kalshiSeriesFor("NFL-2611170115-LAC-BAL-M", { kind: "total" })).toBe("KXNFLTOTAL");
    expect(kalshiSeriesFor("NBA-X-M", { kind: "prop", metric: "points" })).toBe("KXNBAPTS");
    expect(kalshiSeriesFor("NBA-X-M", { kind: "prop", metric: "assists" })).toBe("KXNBAAST");
    expect(kalshiSeriesFor("NHL-X-M", { kind: "prop", metric: "goals" })).toBeNull();
    expect(kalshiSeriesFor("GOLF-X", { kind: "win" })).toBeNull();
  });

  it("reads the bet kind from Gemini's own classification", () => {
    const g = game({ ticker: "G-M", title: "A vs B" });
    expect(betKindOf(g, g)).toEqual({ kind: "win" });
    expect(betKindOf(g, { ...g, ticker: "G-S", template: "sports-spread" })).toEqual({ kind: "spread" });
    expect(betKindOf(g, { ...g, ticker: "G-T", template: "sports-total" })).toEqual({ kind: "total" });
    expect(betKindOf(g, { ...g, ticker: "G-P", template: "sports-player-props", sportsMarket: { metric: "points" } })).toEqual({
      kind: "prop",
      metric: "points",
    });
  });
});

describe("findKalshiEvent", () => {
  const events = [
    { event_ticker: "KXNCAAMBSPREAD-26NOV17FLAND", title: "Florida vs Notre Dame: Spread" },
    { event_ticker: "KXNCAAMBSPREAD-26NOV18CONNARIZ", title: "UConn vs Arizona: Spread" },
    { event_ticker: "KXNCAAMBSPREAD-26NOV17MSUTENN", title: "Michigan St. vs Tennessee: Spread" },
    { event_ticker: "KXNCAAMBSPREAD-26NOV21MSUTENN", title: "Michigan St. vs Tennessee: Spread" }, // rematch, other day
  ];

  it("finds the event despite swapped home/away and different team codes", () => {
    const nd = game({ ticker: "NCAAM-2611172130-ND-FLA-M", title: "Notre Dame vs Florida", startTime: "2026-11-17T21:30:00.000Z" });
    expect(findKalshiEvent(events, nd)?.event_ticker).toBe("KXNCAAMBSPREAD-26NOV17FLAND");
    const uconn = game({ ticker: "NCAAM-2611190200-UCONN-ARI-M", title: "UConn vs Arizona", startTime: "2026-11-19T02:00:00.000Z" });
    expect(findKalshiEvent(events, uconn)?.event_ticker).toBe("KXNCAAMBSPREAD-26NOV18CONNARIZ");
  });

  it("uses the date to pick the right game between the same two teams", () => {
    const msu = game({ ticker: "NCAAM-2611180200-MSU-TENN-M", title: "Michigan State vs Tennessee" });
    expect(findKalshiEvent(events, msu)?.event_ticker).toBe("KXNCAAMBSPREAD-26NOV17MSUTENN");
  });

  it("returns null for a different date, different teams, or an ambiguous pair", () => {
    expect(findKalshiEvent(events, game({ ticker: "X", title: "Michigan State vs Tennessee", startTime: "2026-11-20T02:00:00Z" }))).toBeNull();
    expect(findKalshiEvent(events, game({ ticker: "X", title: "Duke vs Illinois" }))).toBeNull();
    const twice = [...events, { event_ticker: "KXNCAAMBSPREAD-26NOV17MSUTENN2", title: "Michigan St. vs Tennessee: Spread" }];
    expect(findKalshiEvent(twice, game({ ticker: "X", title: "Michigan State vs Tennessee" }))).toBeNull();
  });
});

describe("findKalshiMarket", () => {
  it("matches a spread by team and exact strike, not a neighbouring line", () => {
    const gc = contract("Michigan State wins by more than 3.5 points", { strike: { type: "spread", value: "3.5" }, resolutionSide: "no" });
    const r = findKalshiMarket(spreadMarkets, gc, { kind: "spread" });
    expect(r.market?.ticker).toBe("KXNCAAMBSPREAD-26NOV17MSUTENN-MSU4");
    const other = contract("Tennessee wins by more than 4.5 points", { strike: { type: "spread", value: "4.5" } });
    expect(findKalshiMarket(spreadMarkets, other, { kind: "spread" }).market?.ticker).toBe("KXNCAAMBSPREAD-26NOV17MSUTENN-TENN5");
  });

  it("matches a player prop by player and threshold", () => {
    const gc = contract("Bam Adebayo 15+ Points", { strike: { type: "over", value: "14.5" }, target: { name: "Bam Adebayo" } });
    expect(findKalshiMarket(propMarkets, gc, { kind: "prop", metric: "points" }).market?.ticker).toBe(
      "KXNBAPTS-26NOV18MILMIA-MIABADEBAYO13-15",
    );
  });

  it("matches game winners by team and totals by strike", () => {
    const winners = [
      { ticker: "K-TOR", yes_sub_title: "Toronto", result: "no" },
      { ticker: "K-NYK", yes_sub_title: "New York", result: "yes" },
    ];
    expect(findKalshiMarket(winners, contract("Toronto", { resolutionSide: "no" }), { kind: "win" }).market?.ticker).toBe("K-TOR");
    const totals = [
      { ticker: "K-40", yes_sub_title: "Over 39.5 points", floor_strike: 39.5, result: "yes" },
      { ticker: "K-42", yes_sub_title: "Over 41.5 points", floor_strike: 41.5, result: "no" },
    ];
    const gc = contract("More than 39.5 points scored", { strike: { type: "over", value: "39.5" }, resolutionSide: "yes" });
    expect(findKalshiMarket(totals, gc, { kind: "total" }).market?.ticker).toBe("K-40");
  });

  it("rejects a match whose settled result disagrees with Gemini's", () => {
    const gc = contract("Michigan State wins by more than 3.5 points", { strike: { type: "spread", value: "3.5" }, resolutionSide: "yes" });
    const r = findKalshiMarket(spreadMarkets, gc, { kind: "spread" });
    expect(r.market).toBeNull();
    expect(r).toMatchObject({ reason: "results disagree (gemini yes, kalshi no)" });
  });

  it("returns no market for an unknown team, a strike Kalshi doesn't list, or duplicates", () => {
    const none = contract("Duke wins by more than 3.5 points", { strike: { type: "spread", value: "3.5" } });
    expect(findKalshiMarket(spreadMarkets, none, { kind: "spread" })).toMatchObject({ market: null, reason: "0 candidate markets" });
    const odd = contract("Michigan State wins by more than 9.5 points", { strike: { type: "spread", value: "9.5" } });
    expect(findKalshiMarket(spreadMarkets, odd, { kind: "spread" }).market).toBeNull();
    const dup = [
      { ticker: "A", yes_sub_title: "Toronto" },
      { ticker: "B", yes_sub_title: "Toronto" },
    ];
    expect(findKalshiMarket(dup, contract("Toronto"), { kind: "win" }).market).toBeNull();
  });
});
