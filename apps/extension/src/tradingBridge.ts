import type { TradingReply, TradingRequest } from "./messages.js";
import { SIGNED_OUT, type TradingActions } from "./trading.js";

/** The content script's side of trading: sends each action to the background worker, which holds the user and the API. */
export function createTradingBridge(send: (request: TradingRequest) => Promise<TradingReply>): TradingActions {
  async function ask(request: TradingRequest) {
    const reply = await send(request);
    if (!reply.ok) throw new Error(reply.error);
    return reply;
  }
  return {
    state: async (handle) => (await ask({ type: "trading", op: "state", handle })).state ?? SIGNED_OUT,
    setWatch: async (handle, on) => void (await ask({ type: "trading", op: "watch", handle, on })),
    startCopy: async (handle, amountUsdc) => void (await ask({ type: "trading", op: "copy-start", handle, amountUsdc })),
    stopCopy: async (handle) => void (await ask({ type: "trading", op: "copy-stop", handle })),
  };
}
