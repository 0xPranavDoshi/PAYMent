import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GeminiClient,
  askPrice,
  contractToOutcome,
  decimalPlaces,
  formatToIncrement,
  snapDown,
  type GeminiContract,
} from "./gemini.js";

const CFG = {
  apiKey: "test-key",
  apiSecret: "test-secret",
  readBaseUrl: "https://read.example",
  orderBaseUrl: "https://order.example",
};

function contract(overrides: Partial<GeminiContract> = {}): GeminiContract {
  return {
    id: "c1",
    label: "Chiefs -3.5",
    instrumentSymbol: "GEMI-NFL-KC",
    status: "active",
    marketState: "open",
    prices: {
      buy: { yes: "0.54", no: "0.47" },
      sell: { yes: "0.52", no: "0.45" },
      bestBid: "0.52",
      bestAsk: "0.55",
      lastTradePrice: "0.53",
    },
    expiryDate: null,
    resolutionSide: null,
    resolvedAt: null,
    priceIncrement: "0.01",
    quantityIncrement: "0.01",
    quantityMinimum: "0.01",
    ...overrides,
  };
}

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => "" };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listSportsEvents envelope parsing", () => {
  it("reads the real { data: [...] } envelope", async () => {
    const events = [{ id: "1", ticker: "NFL-KC-PHI" }];
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ data: events, pagination: {} })));
    const client = new GeminiClient(CFG);
    expect(await client.listSportsEvents({ sport: "american_football" })).toEqual(events);
  });

  it("still tolerates a bare array and the legacy { events } key", async () => {
    const events = [{ id: "2" }];
    vi.stubGlobal("fetch", vi.fn(async () => okJson(events)));
    expect(await new GeminiClient(CFG).listSportsEvents()).toEqual(events);

    vi.stubGlobal("fetch", vi.fn(async () => okJson({ events })));
    expect(await new GeminiClient(CFG).listSportsEvents()).toEqual(events);
  });

  it("returns [] for an unknown shape instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ nope: true })));
    expect(await new GeminiClient(CFG).listSportsEvents()).toEqual([]);
  });

  it("reads from the production read base url", async () => {
    const fetchMock = vi.fn(async (_url: string) => okJson({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiClient(CFG).listSportsEvents({ sport: "basketball" });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("https://read.example");
  });
});

describe("placeOrder request signing", () => {
  async function capturePlaceOrder() {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      okJson({ orderId: 1, filledQuantity: "0", avgExecutionPrice: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await new GeminiClient(CFG).placeOrder({
      symbol: "GEMI-NFL-KC",
      side: "buy",
      outcome: "yes",
      quantity: "10",
      price: "0.54",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    return { url, init, headers: init.headers as Record<string, string> };
  }

  it("sends an empty body with the payload in the header", async () => {
    const { url, init, headers } = await capturePlaceOrder();
    expect(String(url)).toBe("https://order.example/v1/prediction-markets/order");
    expect(init.body).toBeUndefined();
    expect(headers["Content-Length"]).toBe("0");
    expect(headers["X-GEMINI-APIKEY"]).toBe("test-key");
    expect(headers["X-GEMINI-PAYLOAD"]).toBeTruthy();
  });

  it("signs the exact base64 payload with HMAC-SHA384 hex", async () => {
    const { headers } = await capturePlaceOrder();
    const expected = crypto
      .createHmac("sha384", CFG.apiSecret)
      .update(headers["X-GEMINI-PAYLOAD"]!)
      .digest("hex");
    expect(headers["X-GEMINI-SIGNATURE"]).toBe(expected);
  });

  it("uses strictly increasing nonces across concurrent orders", async () => {
    const payloads: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      payloads.push((init.headers as Record<string, string>)["X-GEMINI-PAYLOAD"]!);
      return okJson({ orderId: 1, filledQuantity: "0", avgExecutionPrice: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new GeminiClient(CFG);
    const one = () =>
      client.placeOrder({ symbol: "s", side: "buy", outcome: "yes", quantity: "1", price: "0.5" });
    await Promise.all([one(), one(), one(), one(), one()]);

    const nonces = payloads.map(
      (p) => JSON.parse(Buffer.from(p, "base64").toString()).nonce as number,
    );
    expect(new Set(nonces).size).toBe(nonces.length); // all unique
    for (let i = 1; i < nonces.length; i++) {
      expect(nonces[i]!).toBeGreaterThan(nonces[i - 1]!);
    }
  });
});

describe("askPrice", () => {
  it("reads the buy price for the requested side", () => {
    expect(askPrice(contract(), "yes")).toBe(0.54);
    expect(askPrice(contract(), "no")).toBe(0.47);
  });

  it("falls back to bestAsk when the side price is missing or zero", () => {
    const c = contract({
      prices: {
        buy: { yes: "0", no: "0" },
        sell: { yes: "0", no: "0" },
        bestBid: "0.5",
        bestAsk: "0.61",
        lastTradePrice: "0.6",
      },
    });
    expect(askPrice(c, "yes")).toBe(0.61);
  });
});

describe("contractToOutcome", () => {
  it("maps odds, resolution side and order increments", () => {
    const out = contractToOutcome(contract({ resolutionSide: "yes" }));
    expect(out).toMatchObject({
      label: "Chiefs -3.5",
      instrumentSymbol: "GEMI-NFL-KC",
      currentOdds: 0.54,
      noOdds: 0.47,
      resolutionSide: "yes",
      priceIncrement: 0.01,
      quantityIncrement: 0.01,
      quantityMinimum: 0.01,
    });
  });

  it("coerces an omitted resolutionSide to null (active markets omit the key)", () => {
    const { resolutionSide, ...rest } = contract();
    const out = contractToOutcome(rest as GeminiContract);
    expect(out.resolutionSide).toBeNull();
  });

  it("nulls increments when Gemini omits them", () => {
    const out = contractToOutcome(
      contract({ priceIncrement: undefined, quantityIncrement: undefined, quantityMinimum: undefined }),
    );
    expect(out.priceIncrement).toBeNull();
    expect(out.quantityIncrement).toBeNull();
    expect(out.quantityMinimum).toBeNull();
  });
});

describe("increment math", () => {
  it("counts decimal places", () => {
    expect(decimalPlaces(0.01)).toBe(2);
    expect(decimalPlaces(0.5)).toBe(1);
    expect(decimalPlaces(1)).toBe(0);
  });

  it("snaps down to the increment, surviving float error", () => {
    // $1 / 0.85 = 1.176... -> 1.17 contracts, not 1
    expect(snapDown(1 / 0.85, 0.01)).toBe(1.17);
    expect(snapDown(18.0, 0.01)).toBe(18);
    expect(snapDown(0.009, 0.01)).toBe(0); // below the minimum increment
  });

  it("formats to the increment's precision", () => {
    expect(formatToIncrement(0.54, 0.01)).toBe("0.54");
    expect(formatToIncrement(0.5, 0.01)).toBe("0.50");
    expect(formatToIncrement(17, 1)).toBe("17");
  });
});
