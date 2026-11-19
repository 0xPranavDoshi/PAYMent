import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { WEB_URL } from "../src/config.js";
import type { BadgesReply, BadgesRequest, ProfileReply, ProfileRequest } from "../src/messages.js";
import { startBadges } from "../src/page.js";

export default defineContentScript({
  matches: ["https://x.com/*"],
  main() {
    startBadges({
      webUrl: WEB_URL,
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
    });
  },
});
