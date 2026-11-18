import { useSyncExternalStore } from "react";
import { badgeView } from "./badgeView.js";
import type { BadgeStore } from "./badgeStore.js";

/** Styles live inside the shadow root, so X's CSS can't reach them and ours can't leak out. */
export const BADGE_CSS = `
  :host { display: inline-flex; vertical-align: middle; margin-left: 4px; }
  .badge {
    display: inline-flex; align-items: center; gap: 3px;
    padding: 0 6px; height: 18px; border-radius: 9px;
    font: 700 11px/18px system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #fff; background: #2f6fdb; cursor: default; white-space: nowrap;
  }
  .badge.new { background: #8b98a5; }
  .arrow.up { color: #b7f5c8; }
  .arrow.down { color: #ffc2c2; }
`;

export function Badge({ handle, store }: { handle: string; store: BadgeStore }) {
  const state = useSyncExternalStore(
    (notify) => store.subscribe(handle, notify),
    () => store.get(handle),
  );
  const view = badgeView(state);
  if (!view) return null;

  return (
    <span className={`badge ${view.kind}`} title={view.title}>
      {view.text}
      {view.arrow && (
        <span className={`arrow ${view.arrow.direction}`}>
          {view.arrow.direction === "up" ? "▲" : "▼"}
          {view.arrow.amount}
        </span>
      )}
    </span>
  );
}
