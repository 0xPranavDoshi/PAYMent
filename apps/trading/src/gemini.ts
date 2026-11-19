import crypto from "node:crypto";
import type { OutcomeInfo } from "@copayme/shared";

export interface GeminiConfig {
  apiKey: string;
  apiSecret: string;
  readBaseUrl: string;   // production — sports markets live here
  orderBaseUrl: string;  // sandbox — place orders here
}

export interface GeminiContract {
  id: string;
  label: string;
  instrumentSymbol: string;
  status: string;
  marketState: string;
  prices: {
    buy: { yes: string; no: string };
    sell: { yes: string; no: string };
    bestBid: string;
    bestAsk: string;
    lastTradePrice: string;
  };
  expiryDate: string | null;
  resolutionSide: "yes" | "no" | null;
  resolvedAt: string | null;
}

export interface GeminiEvent {
  id: string;
  title: string;
  ticker: string;
  status: string;
  effectiveDate: string | null;  // when the market was listed (equals createdAt), NOT game start

  expiryDate: string | null;
  resolvedAt: string | null;
  contracts: GeminiContract[];
  sportsMarket?: {
    sport: string;
    type: string;
  };
}

export interface GeminiOrder {
  orderId: number;
  status: string;
  symbol: string;
  side: string;
  outcome: string;
  orderType: string;
  quantity: string;
  filledQuantity: string;
  remainingQuantity: string;
  price: string;
  avgExecutionPrice: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export class GeminiClient {
  constructor(private cfg: GeminiConfig) {}

  async listSportsEvents(params?: {
    status?: string;
    sport?: string;
    limit?: number;
  }): Promise<GeminiEvent[]> {
    const qs = new URLSearchParams({ limit: String(params?.limit ?? 200) });
    if (params?.status) qs.set("status", params.status);
    if (params?.sport) qs.set("sport", params.sport);
    const res = await fetch(
      `${this.cfg.readBaseUrl}/v1/prediction-markets/events?${qs}`,
    );
    if (!res.ok) {
      throw new Error(`Gemini listEvents ${res.status}: ${await res.text()}`);
    }
    const data: unknown = await res.json();
    return Array.isArray(data)
      ? (data as GeminiEvent[])
      : ((data as { events?: GeminiEvent[] }).events ?? []);
  }

  async getEvent(ticker: string): Promise<GeminiEvent> {
    const res = await fetch(
      `${this.cfg.readBaseUrl}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`,
    );
    if (!res.ok) {
      throw new Error(`Gemini getEvent ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<GeminiEvent>;
  }

  async placeOrder(params: {
    symbol: string;
    side: "buy" | "sell";
    outcome: "yes" | "no";
    quantity: string;
    price: string;
  }): Promise<GeminiOrder> {
    const endpoint = "/v1/prediction-markets/order";
    const nonce = Date.now();
    const payload = {
      request: endpoint,
      nonce,
      symbol: params.symbol,
      orderType: "limit",
      side: params.side,
      outcome: params.outcome,
      quantity: params.quantity,
      price: params.price,
      timeInForce: "immediate-or-cancel",
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64");
    const signature = crypto
      .createHmac("sha384", this.cfg.apiSecret)
      .update(encodedPayload)
      .digest("hex");

    const res = await fetch(`${this.cfg.orderBaseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-GEMINI-APIKEY": this.cfg.apiKey,
        "X-GEMINI-PAYLOAD": encodedPayload,
        "X-GEMINI-SIGNATURE": signature,
      },
      body: encodedPayload,
    });
    if (!res.ok) {
      throw new Error(`Gemini placeOrder ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<GeminiOrder>;
  }
}

/** Extract the best-ask price for a given side as a [0,1] number. */
export function askPrice(
  contract: GeminiContract,
  side: "yes" | "no" = "yes",
): number {
  const p = parseFloat(contract.prices.buy[side]);
  return Number.isFinite(p) && p > 0 ? p : parseFloat(contract.prices.bestAsk);
}

/** Convert a Gemini event contract into our OutcomeInfo shape. */
export function contractToOutcome(contract: GeminiContract): OutcomeInfo {
  const noP = parseFloat(contract.prices.buy.no);
  return {
    label: contract.label,
    instrumentSymbol: contract.instrumentSymbol,
    currentOdds: askPrice(contract, "yes"),
    noOdds: Number.isFinite(noP) && noP > 0 ? noP : null,
    resolutionSide: contract.resolutionSide,
  };
}
