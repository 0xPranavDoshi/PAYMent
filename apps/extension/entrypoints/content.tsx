import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import type { BadgesReply, BadgesRequest } from "../src/messages.js";
import { startBadges } from "../src/page.js";

export default defineContentScript({
  matches: ["https://x.com/*"],
  main() {
    startBadges({
      lookup: async (handles) => {
        const request: BadgesRequest = { type: "badges", handles };
        const reply: BadgesReply = await browser.runtime.sendMessage(request);
        if (!reply.ok) throw new Error(reply.error);
        return reply.badges;
      },
    });
  },
});
