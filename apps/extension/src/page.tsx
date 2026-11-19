import type { Badge as BadgeData, BadgesResponse } from "@copayme/shared";
import { createRoot, type Root } from "react-dom/client";
import type { ProfileData } from "./messages.js";
import { createPopoverManager } from "./popover/manager.js";
import { Badge, BADGE_CSS } from "./Badge.js";
import { createBadgeStore } from "./badgeStore.js";
import { createBatcher } from "./batcher.js";
import { TWEET_SELECTOR, extractHandle, findMountPoint, newestTweetIdBy, profileHandleFromPath } from "./selectors.js";

export interface StartOptions {
  /** Fetches badges for these handles (in the extension, via the background worker). */
  lookup: (handles: string[]) => Promise<BadgesResponse>;
  /** Fetches the popover's data for one handle. Without it, badges are not clickable. */
  loadProfile?: (handle: string) => Promise<ProfileData>;
  /** Base URL of the coPAYMe website, for the popover's link. */
  webUrl?: string;
  doc?: Document;
  /** Quiet period before a batch is sent. */
  delayMs?: number;
  /**
   * Scans a handle's posts (in the extension, via the background worker and the scout). Called when
   * the user opens a profile page. Without it, profiles are never scanned.
   */
  scan?: (handle: string, newestTweetId: string | null) => Promise<ScanResult>;
  /** How often to check whether the user navigated to a profile (X changes pages without loading). */
  routeCheckMs?: number;
  /**
   * How long to wait for the profile's own tweets to show before scanning without the newest tweet id,
   * how often to look, and how long to let the first screenful render once one shows.
   */
  timelineWaitMs?: number;
  timelinePollMs?: number;
  timelineSettleMs?: number;
}

/** What a scan reports back to the page. */
export type ScanResult = { status: "done"; badge: BadgeData | null } | { status: "skipped" | "failed" | "timeout" };

/** Puts a badge next to the author of every tweet on the page, including ones added later. Returns a stop function. */
export function startBadges({
  lookup,
  loadProfile,
  webUrl = "",
  doc = document,
  delayMs = 150,
  scan,
  routeCheckMs = 1000,
  timelineWaitMs = 4000,
  timelinePollMs = 250,
  timelineSettleMs = 500,
}: StartOptions): () => void {
  const store = createBadgeStore();
  const requested = new Set<string>();
  const mounted = new WeakMap<Element, { host: HTMLElement; root: Root }>();

  const popover = loadProfile ? createPopoverManager({ load: loadProfile, webUrl, doc }) : null;

  const batcher = createBatcher(async (handles) => {
    try {
      const badges = await lookup(handles);
      // A badge lookup that lands mid-scan would show the pre-scan badge; the scan sets the new one.
      for (const handle of handles) if (store.get(handle) !== "scanning") store.set(handle, badges[handle] ?? null);
    } catch (err) {
      console.warn("[coPAYMe] badge lookup failed", err);
      // Forget these handles so the next tweet that shows them tries again.
      for (const handle of handles) requested.delete(handle);
    }
  }, delayMs);

  function mount(article: Element) {
    if (mounted.has(article)) return;
    const handle = extractHandle(article);
    const anchor = findMountPoint(article);
    if (!handle || !anchor) return;

    const host = doc.createElement("span");
    host.dataset.copayme = "badge";
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = BADGE_CSS;
    const container = doc.createElement("span");
    shadow.append(style, container);
    anchor.appendChild(host);

    const root = createRoot(container);
    root.render(<Badge handle={handle} store={store} onOpen={popover ? (h, el) => popover.toggle(h, el) : undefined} />);
    mounted.set(article, { host, root });

    if (store.get(handle) === undefined && !requested.has(handle)) {
      requested.add(handle);
      batcher.add(handle);
    }
  }

  function unmount(article: Element) {
    const entry = mounted.get(article);
    if (!entry) return;
    entry.root.unmount();
    entry.host.remove();
    mounted.delete(article);
  }

  const articlesIn = (node: Node): Element[] => {
    if (!(node instanceof Element)) return [];
    return node.matches(TWEET_SELECTOR) ? [node] : [...node.querySelectorAll(TWEET_SELECTOR)];
  };

  // X keeps only the tweets near the viewport in the page, so tweets come and go as you scroll.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.removedNodes.forEach((node) => articlesIn(node).forEach(unmount));
      record.addedNodes.forEach((node) => articlesIn(node).forEach(mount));
    }
  });

  doc.querySelectorAll(TWEET_SELECTOR).forEach(mount);
  observer.observe(doc.body, { childList: true, subtree: true });

  // Opening a profile scans that handle's posts, so a score can appear for people we haven't seen.
  let lastProfile: string | null = null;
  let stopped = false;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * The newest tweet by `handle` on its profile, once the timeline has loaded, or null if none showed
   * in time. The scout skips fetching from X (which costs) when it already has that tweet.
   */
  async function newestOnTimeline(handle: string): Promise<string | null> {
    const deadline = Date.now() + timelineWaitMs;
    while (!stopped && Date.now() < deadline) {
      if (newestTweetIdBy(doc, handle) !== null) {
        await sleep(timelineSettleMs);
        return newestTweetIdBy(doc, handle);
      }
      await sleep(timelinePollMs);
    }
    return null;
  }

  async function scanProfile(handle: string) {
    if (!scan) return;
    const newest = await newestOnTimeline(handle);
    if (stopped) return;
    const before = store.get(handle);
    store.set(handle, "scanning");
    let result: ScanResult;
    try {
      result = await scan(handle, newest);
    } catch (err) {
      console.warn("[coPAYMe] profile scan failed", err);
      result = { status: "failed" };
    }
    if (result.status === "done") store.set(handle, result.badge);
    else store.set(handle, before === "scanning" ? undefined : before);
  }
  function checkRoute() {
    const handle = profileHandleFromPath(doc.location?.pathname ?? "");
    if (handle === lastProfile) return;
    lastProfile = handle;
    if (handle) void scanProfile(handle);
  }
  const routeTimer = scan ? setInterval(checkRoute, routeCheckMs) : null;
  if (scan) checkRoute();

  return () => {
    stopped = true;
    observer.disconnect();
    if (routeTimer) clearInterval(routeTimer);
    popover?.close();
  };
}
