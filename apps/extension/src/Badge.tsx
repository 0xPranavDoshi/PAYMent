import { useSyncExternalStore } from "react";
import { badgeView } from "./badgeView.js";
import type { BadgeStore } from "./badgeStore.js";

/** Styles live inside the shadow root, so X's CSS can't reach them and ours can't leak out. */
export const BADGE_CSS = `
  :host { display: inline-flex; vertical-align: middle; margin-left: 4px; }
  .badge {
    display: inline-flex; align-items: center; gap: 3px; box-sizing: border-box;
    padding: 0 6px; height: 18px; border-radius: 9px; border: 0; margin: 0;
    font: 700 11px/18px system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #fff; background: #2f6fdb; cursor: pointer; white-space: nowrap;
  }
  .badge:hover { filter: brightness(1.12); }
  .badge:focus-visible { outline: 2px solid #1d9bf0; outline-offset: 1px; }
  .badge.new { background: #8b98a5; }
  .arrow.up { color: #b7f5c8; }
  .arrow.down { color: #ffc2c2; }
`;

export function Badge({
  handle,
  store,
  onOpen,
}: {
  handle: string;
  store: BadgeStore;
  /** Called when the badge is clicked, with the badge element to anchor the popover to. */
  onOpen?: (handle: string, anchor: Element) => void;
}) {
  const state = useSyncExternalStore(
    (notify) => store.subscribe(handle, notify),
    () => store.get(handle),
  );
  const view = badgeView(state);
  if (!view) return null;

  return (
    <button
      type="button"
      className={`badge ${view.kind}`}
      title={view.title}
      aria-haspopup="dialog"
      onClick={(event) => {
        // A tweet is a link: without this, clicking the badge would open the tweet.
        event.preventDefault();
        event.stopPropagation();
        onOpen?.(handle, event.currentTarget);
      }}
      onKeyDown={(event) => {
        // X has page-wide keyboard shortcuts; Enter and Space on the badge must not reach them.
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
    >
      {view.text}
      {view.arrow && (
        <span className={`arrow ${view.arrow.direction}`}>
          {view.arrow.direction === "up" ? "▲" : "▼"}
          {view.arrow.amount}
        </span>
      )}
    </button>
  );
}
