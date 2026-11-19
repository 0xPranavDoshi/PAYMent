import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { fetchBadges, fetchProfileData } from "../src/api.js";
import { createBadgeCache, type KeyValueStore } from "../src/badgeCache.js";
import { createBadgeService } from "../src/badgeService.js";
import { MOCK } from "../src/config.js";
import type { BadgesReply, ExtensionRequest, ProfileReply } from "../src/messages.js";
import { createProfileService } from "../src/profileService.js";

export default defineBackground(() => {
  const storage: KeyValueStore = {
    get: (keys) => browser.storage.local.get(keys),
    getAll: () => browser.storage.local.get(null),
    set: (items) => browser.storage.local.set(items),
    remove: (keys) => browser.storage.local.remove(keys),
  };
  // The version is part of every cache key, so updating the extension (or switching mock mode on
  // or off) starts from an empty cache.
  const cache = createBadgeCache({
    store: storage,
    version: browser.runtime.getManifest().version + (MOCK ? "-mock" : ""),
  });
  void cache.prune().catch(() => {});

  const badges = createBadgeService({ cache, fetchBadges });
  const profiles = createProfileService({ fetchProfileData });

  browser.runtime.onMessage.addListener((message: ExtensionRequest, _sender, sendResponse) => {
    if (message?.type === "badges") {
      badges
        .lookup(message.handles)
        .then((result): BadgesReply => ({ ok: true, badges: result }))
        .catch((err: unknown): BadgesReply => ({ ok: false, error: String(err) }))
        .then(sendResponse);
      return true; // keep the channel open for the async reply
    }

    if (message?.type === "profile") {
      profiles
        .get(message.handle)
        .then((data): ProfileReply => ({ ok: true, ...data }))
        .catch((err: unknown): ProfileReply => ({ ok: false, error: String(err) }))
        .then(sendResponse);
      return true;
    }
  });
});
