import { MAX_BADGE_HANDLES, badgeFromProfile, type Badge as BadgeData, type BadgesResponse } from "@copayme/shared";
import { createRoot, type Root } from "react-dom/client";
import type { ProfileData, Rank } from "./messages.js";
import { createPopoverManager } from "./popover/manager.js";
import { Badge } from "./Badge.js";
import { BADGE_CSS, SCAN_CSS } from "./styles.js";
import { ScanCard } from "./ScanCard.js";
import { createScanStatusStore } from "./scanStatus.js";
import { createThemeStore } from "./theme.js";
import type { TradingActions } from "./trading.js";
import { createBadgeStore } from "./badgeStore.js";
import type { BadgeState } from "./badgeView.js";
import { isContextInvalidated } from "./context.js";
import { createBatcher } from "./batcher.js";
import { BADGE_TARGET_SELECTOR, PROFILE_SELECTOR, newestTweetIdBy, profileHandleFromPath, resolveTarget } from "./selectors.js";

export interface StartOptions {
  /** Fetches badges for these handles (in the extension, via the background worker). */
  lookup: (handles: string[]) => Promise<BadgesResponse>;
  /** Fetches the popover's data for one handle. Without it, badges are not clickable. */
  loadProfile?: (handle: string) => Promise<ProfileData>;
  /** Fetches a handle's leaderboard rank for the popover's header (null: not on it). Without it, no rank is shown. */
  loadRank?: (handle: string) => Promise<Rank | null>;
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
  scan?: (handle: string, newestTweetId: string | null, opts?: { force?: boolean }) => Promise<ScanResult>;
  /**
   * Hands the page a function to call when another tab's scan produced a new badge for a handle; returns
   * how to stop listening. Without it, a scan in one tab does not update the badges in the others.
   */
  subscribeBadgeUpdates?: (apply: (handle: string, badge: BadgeData | null) => void) => () => void;
  /** Tells the scout to stop a running scan (the user pressed Stop). Without it, Stop only stops waiting. */
  cancelScan?: (handle: string) => Promise<void>;
  /**
   * How long to wait for the profile's own tweets to show before scanning without the newest tweet id,
   * how often to look, and how long to let the first screenful render once one shows.
   */
  timelineWaitMs?: number;
  timelinePollMs?: number;
  timelineSettleMs?: number;
  /** How often the badges on screen are checked against the API again (a score changes when picks settle). */
  revalidateMs?: number;
}

/** What a scan reports back to the page. */
export type ScanResult = { status: "done"; badge: BadgeData | null } | { status: "skipped" | "failed" | "timeout" | "stopped" };

/** Puts a badge next to the author of every tweet on the page, including ones added later. Returns a stop function. */
export function startBadges({
  lookup,
  loadProfile,
  loadRank,
  webUrl = "",
  trading,
  doc = document,
  delayMs = 150,
  scan,
  cancelScan,
  subscribeBadgeUpdates,
  timelineWaitMs = 4000,
  timelinePollMs = 250,
  timelineSettleMs = 500,
  revalidateMs = 60_000,
}: StartOptions): () => void {
  const store = createBadgeStore();
  const scanStatus = createScanStatusStore();
  /** How many badges for each handle are on the page right now. */
  const onScreen = new Map<string, number>();

  /**
   * Shows a newer badge for a handle (from another tab's scan, a re-check, or a card that just loaded the
   * profile). It never touches a scan in progress, never replaces a score with "no data", and does nothing
   * when the badge is unchanged, so badges do not redraw for no reason.
   */
  function applyBadge(rawHandle: string, badge: BadgeData | null): void {
    const handle = rawHandle.toLowerCase();
    const now = store.get(handle);
    if (now === "scanning" || badge === null) return;
    if (typeof now === "object" && now !== null && JSON.stringify(now) === JSON.stringify(badge)) return;
    store.set(handle, badge);
  }
  const requested = new Set<string>();
  const mounted = new WeakMap<Element, { host: HTMLElement; root: Root; handle: string }>();
  const roots = new Set<Root>();
  let stopped = false;

  // Badges and the popover are always light. X's page colour is tracked only for the ticket's notches.
  const theme = createThemeStore(doc);
  const hosts = new Set<HTMLElement>();

  const popover = loadProfile
    ? createPopoverManager({
        load: loadProfile,
        loadRank,
        webUrl,
        theme,
        trading,
        doc,
        // A card that just loaded the profile knows a newer score than the badge it was opened from.
        onLoaded: (h: string, data: ProfileData) => {
          if (data.profile) applyBadge(h, badgeFromProfile(data.profile));
        },
        // The card's Rescan button: scan this handle again now (startScan is hoisted).
        ...(scan ? { rescan: (h: string) => void startScan(h, { force: true }) } : {}),
      })
    : null;

  // A scan in another tab (or this one) produced a new badge: show it here too, and re-read an open card.
  const unsubscribeUpdates = subscribeBadgeUpdates?.((rawHandle, badge) => {
    if (stopped) return;
    applyBadge(rawHandle, badge);
    popover?.refresh(rawHandle.toLowerCase());
  });

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
        canScan={Boolean(scan)}
        onScan={(h) => void startScan(h)}
      />,
    );
    mounted.set(article, { host, root, handle });
    roots.add(root);
    onScreen.set(handle, (onScreen.get(handle) ?? 0) + 1);

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
    const left = (onScreen.get(entry.handle) ?? 1) - 1;
    if (left <= 0) onScreen.delete(entry.handle);
    else onScreen.set(entry.handle, left);
    entry.host.remove();
    hosts.delete(entry.host);
    mounted.delete(article);
  }

  const articlesIn = (node: Node): Element[] => {
    if (!(node instanceof Element)) return [];
    return node.matches(BADGE_TARGET_SELECTOR) ? [node] : [...node.querySelectorAll(BADGE_TARGET_SELECTOR)];
  };

  // X keeps only the tweets near the viewport in the page, so tweets come and go as you scroll.
  /**
   * X reuses the profile header element when you go from one profile to another, so a badge mounted
   * once would keep showing the first person's score. Re-check each header's handle and remount it
   * for the new person.
   */
  function refreshProfileHeaders() {
    if (stopped) return;
    const pathname = doc.defaultView?.location.pathname ?? "";
    doc.querySelectorAll(PROFILE_SELECTOR).forEach((header) => {
      const entry = mounted.get(header);
      const now = resolveTarget(header, pathname)?.handle ?? null;
      if (entry && entry.handle !== now) unmount(header);
      if (!mounted.has(header)) mount(header);
    });
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.removedNodes.forEach((node) => articlesIn(node).forEach(unmount));
      record.addedNodes.forEach((node) => articlesIn(node).forEach(mount));
    }
    refreshProfileHeaders();
  });
  /**
   * A score changes whenever picks settle, and nothing tells this page. Without this, a badge kept the
   * value from its first lookup until the tab was reloaded. Every so often (and when you return to the
   * tab) the badges on screen are looked up again, and any that changed are updated.
   */
  let revalidating = false;
  async function revalidate() {
    if (stopped || revalidating || doc.visibilityState === "hidden") return;
    revalidating = true;
    try {
      const handles = [...onScreen.keys()];
      for (let i = 0; i < handles.length; i += MAX_BADGE_HANDLES) {
        const chunk = handles.slice(i, i + MAX_BADGE_HANDLES);
        const fresh = await lookup(chunk);
        if (stopped) return;
        for (const handle of chunk) applyBadge(handle, fresh[handle] ?? null);
      }
    } catch (err) {
      if (isContextInvalidated(err)) stopAll();
      // anything else: keep what is shown and try again at the next check
    } finally {
      revalidating = false;
    }
  }
  const revalidateTimer = setInterval(() => void revalidate(), revalidateMs);
  const onVisible = () => void revalidate();
  doc.addEventListener("visibilitychange", onVisible);

  // X also changes pages without touching the header's own nodes, so check the address too.
  let lastPath = doc.defaultView?.location.pathname ?? "";
  const pathTimer = setInterval(() => {
    const path = doc.defaultView?.location.pathname ?? "";
    if (path !== lastPath) {
      lastPath = path;
      refreshProfileHeaders();
    }
  }, 300);

  doc.querySelectorAll(BADGE_TARGET_SELECTOR).forEach(mount);
  observer.observe(doc.body, { childList: true, subtree: true });

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * The newest tweet by `handle` on its profile, once the timeline has loaded, or null if none showed
   * in time. The scout skips fetching from X (which costs) when it already has that tweet.
   */
  async function newestOnTimeline(handle: string): Promise<string | null> {
    // Only a profile page lists the handle's own tweets; scanning from the feed has no timeline to wait for.
    if (profileHandleFromPath(doc.defaultView?.location.pathname ?? "") !== handle) return null;
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
  // One scan per handle at a time. Each run gets an id; stopping a run makes it stale, so whatever it
  // reports later is ignored and a new scan can start straight away.
  const activeRun = new Map<string, number>();
  const stateBeforeScan = new Map<string, BadgeState>();
  let runCounter = 0;

  /** `force`: the Rescan button (skips the 10-minute "asked recently" wait; the scout still decides the cost). */
  async function startScan(handle: string, opts: { force?: boolean } = {}) {
    if (!scan || stopped || activeRun.has(handle)) return;
    const run = ++runCounter;
    activeRun.set(handle, run);
    const isCurrent = () => !stopped && activeRun.get(handle) === run;
    const before = store.get(handle);
    stateBeforeScan.set(handle, before);
    scanStatus.set({ phase: "scanning", handle, startedAt: Date.now() });
    store.set(handle, "scanning");
    try {
      // Only the account's own profile shows its newest tweets first. Elsewhere (a timeline, a reply) the
      // tweet on screen may be an old one, and the scout would wrongly conclude nothing new was posted.
      const onOwnProfile = profileHandleFromPath(doc.location?.pathname ?? "") === handle;
      const newest = onOwnProfile ? await newestOnTimeline(handle) : null;
      if (!isCurrent()) return; // stopped while waiting: nothing is asked of the scout
      let result: ScanResult;
      try {
        result = await (opts.force ? scan(handle, newest, { force: true }) : scan(handle, newest));
      } catch (err) {
        if (isContextInvalidated(err)) return stopAll();
        console.warn("[coPAYMe] profile scan failed", err);
        result = { status: "failed" };
      }
      if (!isCurrent()) return; // the user stopped it (and may have started another): ignore this result
      popover?.refresh(handle); // the scan may have stored picks: an open card must not keep showing the old ones
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
      if (activeRun.get(handle) === run) activeRun.delete(handle);
    }
  }

  /** The user pressed Stop: put the button back at once, and tell the scout so it stops spending. */
  function stopScan(handle: string) {
    if (!activeRun.has(handle)) return;
    activeRun.delete(handle); // the running scan is now stale
    const before = stateBeforeScan.get(handle);
    store.set(handle, before === "scanning" || before === undefined ? null : before);
    scanStatus.set({ phase: "stopped", handle });
    cancelScan?.(handle).catch((err) => {
      if (isContextInvalidated(err)) return stopAll();
      console.warn("[coPAYMe] could not tell the scout to stop", err);
    });
  }

  // The scan card: a corner panel that shows a scan running (with a stopwatch) and how it ended.
  let scanHost: HTMLElement | null = null;
  let scanRoot: Root | null = null;
  if (scan) {
    scanHost = doc.createElement("div");
    scanHost.dataset.copayme = "scan";
    scanHost.style.cssText = "position:fixed;top:72px;right:20px;z-index:2147483646;";
    hosts.add(scanHost);
    const shadow = scanHost.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = SCAN_CSS;
    const container = doc.createElement("div");
    shadow.append(style, container);
    doc.body.appendChild(scanHost);
    scanRoot = createRoot(container);
    scanRoot.render(<ScanCard store={scanStatus} onRetry={(h) => void startScan(h)} onStop={stopScan} />);
  }

  /** Stops watching the page and removes everything this script put on it. Safe to call more than once. */
  function stopAll() {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    clearInterval(pathTimer);
    clearInterval(revalidateTimer);
    doc.removeEventListener("visibilitychange", onVisible);
    unsubscribeUpdates?.();
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
