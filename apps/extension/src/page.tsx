import type { BadgesResponse } from "@copayme/shared";
import { createRoot, type Root } from "react-dom/client";
import type { ProfileData } from "./messages.js";
import { createPopoverManager } from "./popover/manager.js";
import { Badge } from "./Badge.js";
import { BADGE_CSS } from "./styles.js";
import { createThemeStore } from "./theme.js";
import { createBadgeStore } from "./badgeStore.js";
import { createBatcher } from "./batcher.js";
import { BADGE_TARGET_SELECTOR, resolveTarget } from "./selectors.js";

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
}

/** Puts a badge next to the author of every tweet on the page, including ones added later. Returns a stop function. */
export function startBadges({ lookup, loadProfile, webUrl = "", doc = document, delayMs = 150 }: StartOptions): () => void {
  const store = createBadgeStore();
  const requested = new Set<string>();
  const mounted = new WeakMap<Element, { host: HTMLElement; root: Root }>();

  // Badges and the popover follow X's own theme (Light, Dim or Lights Out), live.
  const theme = createThemeStore(doc);
  const hosts = new Set<HTMLElement>();
  theme.subscribe((next) => hosts.forEach((host) => (host.dataset.theme = next)));

  const popover = loadProfile ? createPopoverManager({ load: loadProfile, webUrl, theme, doc }) : null;

  const batcher = createBatcher(async (handles) => {
    try {
      const badges = await lookup(handles);
      for (const handle of handles) store.set(handle, badges[handle] ?? null);
    } catch (err) {
      console.warn("[coPAYMe] badge lookup failed", err);
      // Forget these handles so the next tweet that shows them tries again.
      for (const handle of handles) requested.delete(handle);
    }
  }, delayMs);

  function mount(article: Element) {
    if (mounted.has(article)) return;
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

  return () => {
    observer.disconnect();
    popover?.close();
    theme.stop();
  };
}
