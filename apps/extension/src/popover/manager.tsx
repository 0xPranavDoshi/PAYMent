import { createRoot, type Root } from "react-dom/client";
import { isContextInvalidated } from "../context.js";
import type { ProfileData } from "../messages.js";
import { POPOVER_CSS } from "../styles.js";
import type { Theme, ThemeStore } from "../theme.js";
import type { TradingActions } from "../trading.js";
import { Popover, type PopoverState } from "./Popover.js";

const WIDTH = 320;
const GAP = 6;
const MARGIN = 8;
/** Room the card is likely to need, for deciding whether it opens below or above its badge. */
const ESTIMATED_HEIGHT = 560;

export interface PopoverManager {
  /** Opens the popover for this handle next to the badge, or closes it if it is already open there. */
  toggle(handle: string, anchor: Element): void;
  /** Re-reads the card if it is open for this handle (a scan just changed what it shows), without a loading flash. */
  refresh(handle: string): void;
  close(): void;
}

/**
 * One popover at a time, in its own shadow root on the page body (so a tweet's clipping can't cut it
 * off). It closes on Escape, on a click outside it, and when the page scrolls or resizes, since it
 * would no longer line up with its badge.
 */
export function createPopoverManager(opts: {
  load: (handle: string) => Promise<ProfileData>;
  /** Called with each profile the card loads, which is newer than the badge it was opened from. */
  onLoaded?: (handle: string, data: ProfileData) => void;
  webUrl: string;
  /** Keeps the card in step with X's theme. Without it the card is light. */
  theme?: ThemeStore;
  /** What the Watch and Copy trade buttons do. */
  trading?: TradingActions;
  /** What the card's Rescan button does. Without it, the card has no Rescan button. */
  rescan?: (handle: string) => void;
  doc?: Document;
}): PopoverManager {
  const { load, onLoaded, webUrl, theme, trading, rescan, doc = document } = opts;
  const win = doc.defaultView ?? window;

  let current: { handle: string; anchor: Element; host: HTMLElement; root: Root; reload: () => void; stop: () => void } | null = null;

  function close() {
    if (!current) return;
    current.stop();
    current.root.unmount();
    current.host.remove();
    current = null;
  }

  /**
   * Puts the card next to its badge. It opens below, or above when there is no room below, and keeps
   * that side while the page scrolls so it does not jump around.
   */
  function place(host: HTMLElement, anchor: Element, side?: "above" | "below"): "above" | "below" {
    const rect = anchor.getBoundingClientRect();
    host.style.left = `${Math.max(MARGIN, Math.min(rect.left, win.innerWidth - WIDTH - MARGIN))}px`;
    const below = win.innerHeight - rect.bottom;
    // Below unless there is clearly more room above; never above if that would run off the top.
    const chosen = side ?? (below >= ESTIMATED_HEIGHT || below >= rect.top ? "below" : "above");
    // The card shrinks (and scrolls inside itself) to the room on its side, so it is never cut off.
    const room = (chosen === "above" ? rect.top : below) - GAP - MARGIN;
    host.style.setProperty("--avail", `${Math.max(160, room)}px`);
    if (chosen === "above") {
      host.style.top = "auto";
      host.style.bottom = `${win.innerHeight - rect.top + GAP}px`;
    } else {
      host.style.bottom = "auto";
      host.style.top = `${rect.bottom + GAP}px`;
    }
    return chosen;
  }

  function open(handle: string, anchor: Element) {
    close();

    const host = doc.createElement("div");
    host.dataset.copayme = "popover";
    host.dataset.theme = theme?.get() ?? "light";
    host.style.cssText = "position:fixed;z-index:2147483647;"; // sets the whole style, so anything else goes after it
    if (theme) host.style.setProperty("--tw-bg", theme.surface());
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = POPOVER_CSS;
    const container = doc.createElement("div");
    shadow.append(style, container);
    const side = place(host, anchor);
    doc.body.appendChild(host);

    const root = createRoot(container);
    let token = 0; // a newer request makes older answers irrelevant

    const render = (state: PopoverState) =>
      root.render(
        <Popover
          handle={handle}
          state={state}
          webUrl={webUrl}
          trading={trading}
          onClose={close}
          onRetry={fetchProfile}
          // The scan shows on the badge and the scan card, so the card closes to get out of the way.
          {...(rescan ? { onRescan: () => (close(), rescan(handle)) } : {})}
        />,
      );

    function fetchProfile() {
      const mine = ++token;
      render({ status: "loading" });
      load(handle).then(
        (data) => {
          if (mine === token && current?.host === host) {
            render({ status: "ready", ...data });
            onLoaded?.(handle, data);
          }
        },
        (err: unknown) => {
          if (mine === token && current?.host === host) render({ status: "error", stale: isContextInvalidated(err) });
        },
      );
    }

    /** Reads the data again and swaps it in, keeping what is on screen if the read fails. */
    function reload() {
      const mine = ++token;
      load(handle).then(
        (data) => {
          if (mine === token && current?.host === host) {
            render({ status: "ready", ...data });
            onLoaded?.(handle, data);
          }
        },
        () => {},
      );
    }

    const onPointerDown = (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(host) && !path.includes(anchor)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    // X's timeline scrolls constantly, so the card follows its badge instead of closing. It closes
    // only when the badge is gone (X removed that tweet) or has scrolled out of view. Scrolling
    // inside the card itself is not the page scrolling and is ignored.
    let frame = 0;
    const onViewportChange = (event?: Event) => {
      if (event?.composedPath?.().includes(host)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (current?.host !== host) return;
        if (!anchor.isConnected) return close();
        const rect = anchor.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > win.innerHeight) return close();
        place(host, anchor, side);
      });
    };
    const stopTheme = theme?.subscribe((next: Theme) => {
      host.dataset.theme = next;
      host.style.setProperty("--tw-bg", theme.surface()); // Dim and Lights Out are both dark but not the same colour
    });

    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
    win.addEventListener("resize", onViewportChange);

    current = {
      handle,
      anchor,
      host,
      root,
      reload,
      stop: () => {
        token++;
        stopTheme?.();
        cancelAnimationFrame(frame);
        doc.removeEventListener("pointerdown", onPointerDown, true);
        doc.removeEventListener("keydown", onKeyDown, true);
        win.removeEventListener("scroll", onViewportChange, { capture: true } as EventListenerOptions);
        win.removeEventListener("resize", onViewportChange);
      },
    };

    fetchProfile();
  }

  return {
    toggle(handle, anchor) {
      if (current && current.handle === handle && current.anchor === anchor) close();
      else open(handle, anchor);
    },
    refresh(handle) {
      if (current?.handle === handle) current.reload();
    },
    close,
  };
}
