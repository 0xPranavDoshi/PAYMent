import { describe, expect, it, vi } from "vitest";
import candles1m from "../../test/fixtures/kalshi-candles-1m.json" with { type: "json" };
import eventFixture from "../../test/fixtures/kalshi-event.json" with { type: "json" };
import spread from "../../test/fixtures/kalshi-markets-spread.json" with { type: "json" };
import type { GeminiContract, GeminiEvent } from "../gemini/types.js";
import { candlePrice, createKalshiClient, priceAt } from "./client.js";

const TWEET = new Date("2026-11-17T16:09:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const msuGame: GeminiEvent = {
  id: "1",
  ticker: "NCAAM-2611180200-MSU-TENN-M",
  title: "Michigan State vs Tennessee",
  status: "settled",
  template: "sports-game",
  startTime: "2026-11-18T02:00:00.000Z",
  contracts: [],
};
const msuSpread: GeminiEvent = { ...msuGame, id: "2", ticker: "NCAAM-2611180200-MSU-TENN-S", template: "sports-spread" };
const msu35: GeminiContract = {
  instrumentSymbol: "GEMI-NCAAM-2611180200-MSU-TENN-S-MSU3",
  label: "Michigan State wins by more than 3.5 points",
  marketState: "closed",
  strike: { type: "spread", value: "3.5" },
  resolutionSide: "no",
};

/** A Kalshi stub: routes by path; anything unrouted is a 404. */
function kalshi(routes: Record<string, (url: URL) => Response>) {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/trade-api/v2", "");
    for (const [prefix, handler] of Object.entries(routes)) if (path.startsWith(prefix)) return handler(url);
    return json({ error: "not found" }, 404);
  });
  const client = createKalshiClient({ fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} });
  return { client, fetchMock, paths: () => fetchMock.mock.calls.map(([u]) => new URL(String(u)).pathname.replace("/trade-api/v2", "")) };
}

describe("findMarket", () => {
  it("finds the event by Gemini's codes when they match, confirmed by the title's teams", async () => {
    const { client, paths } = kalshi({
      "/events/KXNCAAMBSPREAD-26NOV17MSUTENN": () => json(eventFixture),
      "/markets": () => json(spread),
    });
    const r = await client.findMarket(msuGame, msuSpread, msu35);
    expect(r).toMatchObject({ series: "KXNCAAMBSPREAD", market: { ticker: "KXNCAAMBSPREAD-26NOV17MSUTENN-MSU4" } });
    expect(paths()).toEqual(["/events/KXNCAAMBSPREAD-26NOV17MSUTENN", "/markets"]);
  });

  it("falls back to listing the series (paging) when the codes differ, filtered by min_close_ts", async () => {
    const uconnGame: GeminiEvent = { ...msuGame, ticker: "NCAAM-2611190200-UCONN-ARI-M", title: "UConn vs Arizona", startTime: "2026-11-19T02:00:00.000Z" };
    const uconnSpread: GeminiEvent = { ...uconnGame, ticker: "NCAAM-2611190200-UCONN-ARI-S", template: "sports-spread" };
    const ari35: GeminiContract = { ...msu35, label: "Arizona wins by more than 3.5 points", resolutionSide: undefined };
    const listed: URL[] = [];
    const { client } = kalshi({
      "/events": (url) => {
        if (url.pathname.endsWith("/events/KXNCAAMBSPREAD-26NOV18UCONNARI")) return json({ error: "not found" }, 404); // the guess
        listed.push(url);
        return url.searchParams.get("cursor")
          ? json({ events: [{ event_ticker: "KXNCAAMBSPREAD-26NOV18CONNARIZ", title: "UConn vs Arizona: Spread" }], cursor: "" })
          : json({ events: [{ event_ticker: "KXNCAAMBSPREAD-26NOV18DUKEILL", title: "Duke vs Illinois: Spread" }], cursor: "p2" });
      },
      "/markets": () =>
        json({ markets: [{ ticker: "KXNCAAMBSPREAD-26NOV18CONNARIZ-ARIZ4", yes_sub_title: "Arizona wins by over 3.5 points", floor_strike: 3.5 }] }),
    });
    const r = await client.findMarket(uconnGame, uconnSpread, ari35);
    expect(r).toMatchObject({ market: { ticker: "KXNCAAMBSPREAD-26NOV18CONNARIZ-ARIZ4" } });
    expect(listed).toHaveLength(2);
    expect(listed[0]!.searchParams.get("series_ticker")).toBe("KXNCAAMBSPREAD");
    expect(Number(listed[0]!.searchParams.get("min_close_ts"))).toBeLessThanOrEqual(Date.parse(uconnGame.startTime!) / 1000);
  });

  it("doesn't trust a guessed event whose teams differ", async () => {
    const { client } = kalshi({
      "/events/KXNCAAMBSPREAD-26NOV17MSUTENN": () => json({ event: { event_ticker: "KXNCAAMBSPREAD-26NOV17MSUTENN", title: "Mississippi St. vs Tennessee Tech: Spread" } }),
      "/events": () => json({ events: [], cursor: "" }),
    });
    expect(await client.findMarket(msuGame, msuSpread, msu35)).toMatchObject({ series: null });
  });

  it("caches events and markets across picks on the same game", async () => {
    const { client, fetchMock } = kalshi({
      "/events/KXNCAAMBSPREAD-26NOV17MSUTENN": () => json(eventFixture),
      "/markets": () => json(spread),
    });
    await client.findMarket(msuGame, msuSpread, msu35);
    await client.findMarket(msuGame, msuSpread, { ...msu35, label: "Tennessee wins by more than 4.5 points", strike: { type: "spread", value: "4.5" }, resolutionSide: "yes" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains why when there's no series for the bet", async () => {
    const golf = { ...msuGame, ticker: "GOLF-MAS-WIN" };
    expect(await createKalshiClient({ fetch: vi.fn() as never }).findMarket(golf, golf, msu35)).toEqual({
      series: null,
      reason: "no Kalshi series for this league/bet",
    });
  });

  it("retries a 429 and then succeeds", async () => {
    let calls = 0;
    const { client } = kalshi({
      "/events/KXNCAAMBSPREAD-26NOV17MSUTENN": () => (calls++ === 0 ? json({ error: "too_many_requests" }, 429) : json(eventFixture)),
      "/markets": () => json(spread),
    });
    expect((await client.findMarket(msuGame, msuSpread, msu35)).series).toBe("KXNCAAMBSPREAD");
    expect(calls).toBe(2);
  });
});

describe("getYesPriceAt", () => {
  const msu4 = { ticker: "KXNCAAMBSPREAD-26NOV17MSUTENN-MSU4", settlement_ts: "2026-11-18T04:25:09Z" };

  it("prices from the bid/ask midpoint of the last 1-minute candle at or before the tweet (real candles)", async () => {
    const { client, fetchMock } = kalshi({
      "/historical/cutoff": () => json({ market_settled_ts: "2026-09-19T00:00:00Z" }),
      "/series/KXNCAAMBSPREAD/markets/KXNCAAMBSPREAD-26NOV17MSUTENN-MSU4/candlesticks": () => json(candles1m),
    });
    expect(await client.getYesPriceAt("KXNCAAMBSPREAD", msu4, TWEET)).toBe(0.465);
    const url = new URL(String(fetchMock.mock.calls.at(-1)![0]));
    expect(url.searchParams.get("period_interval")).toBe("1");
    expect(Number(url.searchParams.get("end_ts"))).toBe(TWEET.getTime() / 1000);
  });

  it("falls back to hourly candles when there are no minute candles in the hour before", async () => {
    const { client } = kalshi({
      "/historical/cutoff": () => json({ market_settled_ts: "2026-09-19T00:00:00Z" }),
      "/series/": (url) =>
        url.searchParams.get("period_interval") === "1"
          ? json({ candlesticks: [] })
          : json({ candlesticks: [{ end_period_ts: TWEET.getTime() / 1000 - 1800, yes_bid: { close_dollars: "0.40" }, yes_ask: { close_dollars: "0.44" } }] }),
    });
    expect(await client.getYesPriceAt("KXNCAAMBSPREAD", msu4, TWEET)).toBe(0.42);
  });

  it("reads markets settled before the historical cutoff from /historical", async () => {
    const { client, paths } = kalshi({
      "/historical/cutoff": () => json({ market_settled_ts: "2026-12-01T00:00:00Z" }),
      "/historical/markets/": () => json(candles1m),
    });
    expect(await client.getYesPriceAt("KXNCAAMBSPREAD", msu4, TWEET)).toBe(0.465);
    expect(paths()).toContain("/historical/markets/KXNCAAMBSPREAD-26NOV17MSUTENN-MSU4/candlesticks");
  });
});

describe("candlePrice / priceAt", () => {
  const c = (end: number, bid: string | null, ask: string | null, trade: string | null = null) => ({
    end_period_ts: end,
    yes_bid: { close_dollars: bid },
    yes_ask: { close_dollars: ask },
    price: { close_dollars: trade },
  });

  it("uses the midpoint of a tight quote, else the trade, else nothing", () => {
    expect(candlePrice(c(1, "0.46", "0.47"))).toBe(0.465);
    expect(candlePrice(c(1, "0.20", "0.60", "0.41"))).toBe(0.41); // too wide to trust
    expect(candlePrice(c(1, "0.20", "0.60"))).toBeNull();
    expect(candlePrice(c(1, "0.00", "0.02"))).toBeNull(); // no real bid
  });

  it("never looks past the tweet", () => {
    const rows = [c(100, "0.30", "0.32"), c(200, "0.50", "0.52"), c(300, "0.90", "0.92")];
    expect(priceAt(rows, 250)).toBe(0.51);
    expect(priceAt(rows, 99)).toBeNull();
  });
});
