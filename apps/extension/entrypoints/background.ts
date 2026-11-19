import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { fetchBadges } from "../src/api.js";
import type { BadgesReply, BadgesRequest } from "../src/messages.js";

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: BadgesRequest, _sender, sendResponse) => {
    if (message?.type !== "badges") return;

    fetchBadges(message.handles).then(
      (badges): BadgesReply => ({ ok: true, badges }),
      (err: unknown): BadgesReply => ({ ok: false, error: String(err) }),
    ).then(sendResponse);

    return true; // keep the channel open for the async reply
  });
});
