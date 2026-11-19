import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { WEB_URL } from "../src/config.js";
import type { BadgesReply, BadgesRequest, ProfileReply, ProfileRequest, ScanCancelReply, ScanCancelRequest, ScanReply, ScanRequest, TradingReply, TradingRequest } from "../src/messages.js";
import { startBadges } from "../src/page.js";
import { createTradingBridge } from "../src/tradingBridge.js";

export default defineContentScript({
  matches: ["https://x.com/*"],
  main(ctx) {
    const stop = startBadges({
      webUrl: WEB_URL,
      trading: createTradingBridge(async (request: TradingRequest): Promise<TradingReply> => browser.runtime.sendMessage(request)),
      lookup: async (handles) => {
        const request: BadgesRequest = { type: "badges", handles };
        const reply: BadgesReply = await browser.runtime.sendMessage(request);
        if (!reply.ok) throw new Error(reply.error);
        return reply.badges;
      },
      loadProfile: async (handle) => {
        const request: ProfileRequest = { type: "profile", handle };
        const reply: ProfileReply = await browser.runtime.sendMessage(request);
        if (!reply.ok) throw new Error(reply.error);
        return { profile: reply.profile, calls: reply.calls };
      },
      // Pressing Stop: stop waiting here, and tell the scout to skip the paid work it has not started yet.
      cancelScan: async (handle) => {
        const request: ScanCancelRequest = { type: "scan-cancel", handle };
        const reply: ScanCancelReply = await browser.runtime.sendMessage(request);
        if (!reply.ok) throw new Error(reply.error);
      },
      // Pressing Scan picks asks the scout to read that handle's recent picks.
      scan: async (handle, newestTweetId) => {
        const request: ScanRequest = { type: "scan", handle, newestTweetId };
        const reply: ScanReply = await browser.runtime.sendMessage(request);
        if (!reply.ok) throw new Error(reply.error);
        return reply.status === "done" ? { status: "done", badge: reply.badge } : { status: reply.status };
      },
    });
    // When the extension is reloaded or updated, this copy of the script is orphaned: take its badges
    // off the page instead of leaving them behind to fail on every tweet.
    ctx.onInvalidated(stop);
  },
});
