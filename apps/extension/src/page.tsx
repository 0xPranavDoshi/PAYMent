import type { Badge as BadgeData, BadgesResponse } from "@copayme/shared";
import { createRoot, type Root } from "react-dom/client";
import type { ProfileData } from "./messages.js";
import { createPopoverManager } from "./popover/manager.js";
import { Badge } from "./Badge.js";
import { BADGE_CSS, SCAN_CSS } from "./styles.js";
import { ScanCard } from "./ScanCard.js";
import { createScanStatusStore } from "./scanStatus.js";
import { createThemeStore } from "./theme.js";
import type { TradingActions } from "./trading.js";
import { createBadgeStore } from "./badgeStore.js";
import { isContextInvalidated } from "./context.js";
import { createBatcher } from "./batcher.js";
import { BADGE_TARGET_SELECTOR, PROFILE_SELECTOR, newestTweetIdBy, resolveTarget } from "./selectors.js";

export interface StartOptions {
  /** Fetches badges for these handles (in the extension, via the background worker). */
  lookup: (handles: string[]) => Promise<BadgesResponse>;
  /** Fetches the popover's data for one handle. Without it, badges are not clickable. */
  loadProfile?: (handle: string) => Promise<ProfileData>;
  /** Base URL of the coPAYMe website, for the popover's link. */
  webUrl?: string;
  /** What the popover's Watch and Copy trade buttons do. Without it they say trading is unavailable. */
  trading?: TradingActions;
  doc?: Document;
  /** Quiet period before a batch is sent. */
  delayMs?: number;
  /**
   * Scans a handle's posts (in the extension, via the background worker and the scout). Called only
   * when the user presses "Scan picks" on a profile: scans cost money and only suit accounts that post
   * sports picks, so the user chooses. Without it, there is no scan button.
   */
  scan?: (handle: string, newestTweetId: string | null) => Promise<ScanResult>;
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
  trading,
  doc = document,
  delayMs = 150,
  scan,
  timelineWaitMs = 4000,
  timelinePollMs = 250,
  timelineSettleMs = 500,
}: StartOptions): () => void {
  const store = createBadgeStore();
  const scanStatus = createScanStatusStore();
  const requested = new Set<string>();
  const mounted = new WeakMap<Element, { host: HTMLElement; root: Root }>();
  const roots = new Set<Root>();
  let stopped = false;

  // Badges and the popover follow X's own theme (Light, Dim or Lights Out), live.
  const theme = createThemeStore(doc);
  const hosts = new Set<HTMLElement>();
  theme.subscribe((next) => hosts.forEach((host) => (host.dataset.theme = next)));

  const popover = loadProfile ? createPopoverManager({ load: loadProfile, webUrl, theme, trading, doc }) : null;

  const batcher = createBatcher(async (handles) => {
    try {
      const badges = await lookup(handles);
      // A badge lookup that lands mid-scan would show the pre-scan badge; the scan sets the new one.
      for (const handle of handles) {
        const now = store.get(handle);
        // A lookup that lands mid-scan, or after a scan ended, must not undo what the scan showed.
        if (now !== "scanning" && now !== "empty" && now !== "failed") store.set(handle, badges[handle] ?? null);
      }
    } catch (err) {
      // The extension was reloaded under this page: this copy can never work again, so retire it.
      if (isContextInvalidated(err)) return stopAll();
      console.warn("[coPAYMe] badge lookup failed", err);
      // Forget these handles so the next tweet that shows them tries again.
      for (const handle of handles) requested.delete(handle);
    }
  }, delayMs);

  function mount(article: Element) {
    if (stopped || mounted.has(article)) return;
    const target = resolveTarget(article, doc.defaultView?.location.pathname ?? "");
    if (!target) return;
    const { handle, anchor } = target;

    const host = doc.createElement("span");
    host.dataset.copayme = "badge";
    host.dataset.theme = theme.get();
    hosts.add(host);
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = BADGE_CSS;
    const container = doc.createElement("span");
    shadow.append(style, container);
    anchor.appendChild(host);

    const root = createRoot(container);
    root.render(
      <Badge
        handle={handle}
        store={store}
        onOpen={popover ? (h, el) => popover.toggle(h, el) : undefined}
        canScan={Boolean(scan) && article.matches(PROFILE_SELECTOR)}
        onScan={(h) => void startScan(h)}
      />,
    );
    mounted.set(article, { host, root });
    roots.add(root);

    if (store.get(handle) === undefined && !requested.has(handle)) {
      requested.add(handle);
      batcher.add(handle);
    }
  }

  function unmount(article: Element) {
    const entry = mounted.get(article);
    if (!entry) return;
    entry.root.unmount();
    roots.delete(entry.root);
    entry.host.remove();
    hosts.delete(entry.host);
    mounted.delete(article);
  }

  const articlesIn = (node: Node): Element[] => {
    if (!(node instanceof Element)) return [];
    return node.matches(BADGE_TARGET_SELECTOR) ? [node] : [...node.querySelectorAll(BADGE_TARGET_SELECTOR)];
  };

  // X keeps only the tweets near the viewport in the page, so tweets come and go as you scroll.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.removedNodes.forEach((node) => articlesIn(node).forEach(unmount));
      record.addedNodes.forEach((node) => articlesIn(node).forEach(mount));
    }
  });

  doc.querySelectorAll(BADGE_TARGET_SELECTOR).forEach(mount);
  observer.observe(doc.body, { childList: true, subtree: true });

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

  // The user chooses which profiles to scan, by pressing "Scan picks" (or "Try again").
  const scanning = new Set<string>();
  async function startScan(handle: string) {
    if (!scan || stopped || scanning.has(handle)) return;
    scanning.add(handle);
    const before = store.get(handle);
    scanStatus.set({ phase: "scanning", handle, startedAt: Date.now() });
    store.set(handle, "scanning");
    try {
      const newest = await newestOnTimeline(handle);
      if (stopped) return;
      let result: ScanResult;
      try {
        result = await scan(handle, newest);
      } catch (err) {
        if (isContextInvalidated(err)) return stopAll();
        console.warn("[coPAYMe] profile scan failed", err);
        result = { status: "failed" };
      }
      if (stopped) return;
      if (result.status === "done" && result.badge) {
        store.set(handle, result.badge);
        scanStatus.set({ phase: "done", handle, badge: result.badge });
      } else if (result.status === "done") {
        store.set(handle, "empty");
        scanStatus.set({ phase: "empty", handle });
      } else if (result.status === "skipped") {
        store.set(handle, before === "scanning" ? null : before ?? null);
        scanStatus.set({ phase: "recent", handle });
      } else {
        store.set(handle, "failed");
        scanStatus.set({ phase: "failed", handle });
      }
    } finally {
      scanning.delete(handle);
    }
  }

  // The scan card: a corner panel that shows a scan running (with a stopwatch) and how it ended.
  let scanHost: HTMLElement | null = null;
  let scanRoot: Root | null = null;
  if (scan) {
    scanHost = doc.createElement("div");
    scanHost.dataset.copayme = "scan";
    scanHost.dataset.theme = theme.get();
    scanHost.style.cssText = "position:fixed;top:72px;right:20px;z-index:2147483646;";
    hosts.add(scanHost);
    const shadow = scanHost.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = SCAN_CSS;
    const container = doc.createElement("div");
    shadow.append(style, container);
    doc.body.appendChild(scanHost);
    scanRoot = createRoot(container);
    scanRoot.render(<ScanCard store={scanStatus} onRetry={(h) => void startScan(h)} />);
  }

  /** Stops watching the page and removes everything this script put on it. Safe to call more than once. */
  function stopAll() {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    popover?.close();
    scanRoot?.unmount();
    scanHost?.remove();
    theme.stop();
    roots.forEach((root) => root.unmount());
    hosts.forEach((host) => host.remove());
    roots.clear();
    hosts.clear();
  }

  return stopAll;
}
