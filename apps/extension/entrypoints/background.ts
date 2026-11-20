import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { fetchBadges, fetchProfileData } from "../src/api.js";
import { createBadgeCache, type KeyValueStore } from "../src/badgeCache.js";
import { createBadgeService } from "../src/badgeService.js";
import { FOLLOWER_ID, MOCK, SCOUT_URL, TRADING_URL } from "../src/config.js";
import type { BadgesReply, ExtensionRequest, ProfileReply, ScanCancelReply, ScanReply, TradingReply } from "../src/messages.js";
import { createProfileService } from "../src/profileService.js";
import { createScanService } from "../src/scanService.js";
import { createMockTrading, createTradingService, validFollowerId } from "../src/trading.js";

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
  // After a scan, fetch the handle's badge straight from the API (the cached one predates the scan)
  // and write it back so every tab sees the new score.
  const scans = createScanService({
    scoutUrl: SCOUT_URL,
    refreshBadge: async (handle) => {
      const badge = (await fetchBadges([handle]))[handle] ?? null;
      await cache.write({ [handle]: badge });
      return badge;
    },
  });

  // Who to trade as: the session the X login stores in chrome.storage.local, else the configured
  // user. With neither, trading stays off and the buttons say so.
  const trading = MOCK
    ? createMockTrading()
    : createTradingService({
        baseUrl: TRADING_URL,
        getFollowerId: async () => {
          const { session } = (await browser.storage.local.get("session")) as { session?: { userId?: unknown } };
          return validFollowerId(session?.userId) ?? validFollowerId(FOLLOWER_ID);
        },
      });

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

    if (message?.type === "trading") {
      const run = async (): Promise<TradingReply> => {
        if (message.op === "state") return { ok: true, state: await trading.state(message.handle) };
        if (message.op === "watch") await trading.setWatch(message.handle, message.on);
        else if (message.op === "copy-start") await trading.startCopy(message.handle, message.amountUsdc);
        else await trading.stopCopy(message.handle);
        return { ok: true };
      };
      run()
        .catch((err: unknown): TradingReply => ({ ok: false, error: err instanceof Error ? err.message : String(err) }))
        .then(sendResponse);
      return true;
    }

    if (message?.type === "scan-cancel") {
      if (MOCK) {
        sendResponse({ ok: true } satisfies ScanCancelReply);
        return;
      }
      scans
        .cancel(message.handle)
        .then((): ScanCancelReply => ({ ok: true }))
        .catch((err: unknown): ScanCancelReply => ({ ok: false, error: String(err) }))
        .then(sendResponse);
      return true;
    }

    if (message?.type === "scan") {
      if (MOCK) {
        sendResponse({ ok: true, status: "skipped" } satisfies ScanReply);
        return;
      }
      scans
        .scan(message.handle, message.newestTweetId ?? null, { force: message.force === true })
        .then((outcome): ScanReply =>
          outcome.status === "done" ? { ok: true, status: "done", badge: outcome.badge } : { ok: true, status: outcome.status },
        )
        .catch((err: unknown): ScanReply => ({ ok: false, error: String(err) }))
        .then(sendResponse);
      return true;
    }
  });
});
