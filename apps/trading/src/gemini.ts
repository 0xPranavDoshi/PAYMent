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
  priceIncrement?: string;
  quantityIncrement?: string;
  quantityMinimum?: string;
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
  // Gemini rejects nonces that are not strictly increasing. All orders share one
  // API key, so concurrent placeOrder calls must not collide on Date.now().
  private lastNonce = 0;

  constructor(private cfg: GeminiConfig) {}

  private nextNonce(): number {
    this.lastNonce = Math.max(Date.now(), this.lastNonce + 1);
    return this.lastNonce;
  }

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
    if (Array.isArray(data)) return data as GeminiEvent[];
    const body = data as { data?: GeminiEvent[]; events?: GeminiEvent[] };
    return body.data ?? body.events ?? [];
  }

  async getEvent(ticker: string): Promise<GeminiEvent> {
    const res = await fetch(
      `${this.cfg.readBaseUrl}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`,
    );
    if (!res.ok) {
      throw new Error(`Gemini getEvent ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as GeminiEvent | { data?: GeminiEvent };
    return (data as { data?: GeminiEvent }).data ?? (data as GeminiEvent);
  }

  async placeOrder(params: {
    symbol: string;
    side: "buy" | "sell";
    outcome: "yes" | "no";
    quantity: string;
    price: string;
  }): Promise<GeminiOrder> {
    const endpoint = "/v1/prediction-markets/order";
    const nonce = this.nextNonce();
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

    // Gemini private endpoints carry the payload in the header, not the body.
    // The body must be empty (Content-Length: 0).
    const res = await fetch(`${this.cfg.orderBaseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Content-Length": "0",
        "Cache-Control": "no-cache",
        "X-GEMINI-APIKEY": this.cfg.apiKey,
        "X-GEMINI-PAYLOAD": encodedPayload,
        "X-GEMINI-SIGNATURE": signature,
      },
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

function parsePositive(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Convert a Gemini event contract into our OutcomeInfo shape. */
export function contractToOutcome(contract: GeminiContract): OutcomeInfo {
  const noP = parseFloat(contract.prices.buy.no);
  return {
    label: contract.label,
    instrumentSymbol: contract.instrumentSymbol,
    currentOdds: askPrice(contract, "yes"),
    noOdds: Number.isFinite(noP) && noP > 0 ? noP : null,
    resolutionSide: contract.resolutionSide ?? null,
    priceIncrement: parsePositive(contract.priceIncrement),
    quantityIncrement: parsePositive(contract.quantityIncrement),
    quantityMinimum: parsePositive(contract.quantityMinimum),
  };
}

/** Decimal places implied by an increment, e.g. 0.01 -> 2, 1 -> 0. */
export function decimalPlaces(increment: number): number {
  const str = String(increment);
  const dot = str.indexOf(".");
  return dot === -1 ? 0 : str.length - dot - 1;
}

/** Round a value down to the nearest multiple of `increment`. */
export function snapDown(value: number, increment: number): number {
  if (!Number.isFinite(increment) || increment <= 0) return value;
  const snapped = Math.floor((value + 1e-9) / increment) * increment;
  return parseFloat(snapped.toFixed(decimalPlaces(increment)));
}

/** Snap a value down to the increment and format it as a fixed-decimal string. */
export function formatToIncrement(value: number, increment: number): string {
  return snapDown(value, increment).toFixed(decimalPlaces(increment));
}
