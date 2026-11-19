import { createRoot, type Root } from "react-dom/client";
import type { ProfileData } from "../messages.js";
import { Popover, type PopoverState } from "./Popover.js";
import { POPOVER_CSS } from "./styles.js";

const WIDTH = 320;
const GAP = 6;
const MARGIN = 8;
/** Room the card is likely to need, for deciding whether it opens below or above its badge. */
const ESTIMATED_HEIGHT = 380;

export interface PopoverManager {
  /** Opens the popover for this handle next to the badge, or closes it if it is already open there. */
  toggle(handle: string, anchor: Element): void;
  close(): void;
}

/**
 * One popover at a time, in its own shadow root on the page body (so a tweet's clipping can't cut it
 * off). It closes on Escape, on a click outside it, and when the page scrolls or resizes, since it
 * would no longer line up with its badge.
 */
export function createPopoverManager(opts: {
  load: (handle: string) => Promise<ProfileData>;
  webUrl: string;
  doc?: Document;
}): PopoverManager {
  const { load, webUrl, doc = document } = opts;
  const win = doc.defaultView ?? window;

  let current: { handle: string; anchor: Element; host: HTMLElement; root: Root; stop: () => void } | null = null;

  function close() {
    if (!current) return;
    current.stop();
    current.root.unmount();
    current.host.remove();
    current = null;
  }

  function place(host: HTMLElement, anchor: Element) {
    const rect = anchor.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(rect.left, win.innerWidth - WIDTH - MARGIN));
    host.style.left = `${left}px`;
    const below = win.innerHeight - rect.bottom;
    if (below < ESTIMATED_HEIGHT && rect.top > below) {
      host.style.top = "auto";
      host.style.bottom = `${win.innerHeight - rect.top + GAP}px`;
    } else {
      host.style.bottom = "auto";
      host.style.top = `${rect.bottom + GAP}px`;
    }
  }

  function open(handle: string, anchor: Element) {
    close();

    const host = doc.createElement("div");
    host.dataset.copayme = "popover";
    host.style.cssText = "position:fixed;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = POPOVER_CSS;
    const container = doc.createElement("div");
    shadow.append(style, container);
    place(host, anchor);
    doc.body.appendChild(host);

    const root = createRoot(container);
    let token = 0; // a newer request makes older answers irrelevant

    const render = (state: PopoverState) =>
      root.render(<Popover handle={handle} state={state} webUrl={webUrl} onClose={close} onRetry={fetchProfile} />);

    function fetchProfile() {
      const mine = ++token;
      render({ status: "loading" });
      load(handle).then(
        (data) => {
          if (mine === token && current?.host === host) render({ status: "ready", ...data });
        },
        () => {
          if (mine === token && current?.host === host) render({ status: "error" });
        },
      );
    }

    const onPointerDown = (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(host) && !path.includes(anchor)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onViewportChange = () => close();

    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown, true);
    win.addEventListener("scroll", onViewportChange, { capture: true, passive: true });
    win.addEventListener("resize", onViewportChange);

    current = {
      handle,
      anchor,
      host,
      root,
      stop: () => {
        token++;
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
    close,
  };
}
