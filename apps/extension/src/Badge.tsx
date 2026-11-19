import { useSyncExternalStore } from "react";
import { Mark } from "./brand.js";
import { badgeView } from "./badgeView.js";
import type { BadgeStore } from "./badgeStore.js";

export { BADGE_CSS } from "./styles.js";

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
      className={`pill ${view.kind}`}
      title={view.title}
      aria-haspopup="dialog"
      aria-label={`coPAYMe: ${view.title}`}
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
      <Mark />
      {view.kind === "scored" && <span className="cap">SCORE</span>}
      <span className="num">{view.kind === "new" ? "NEW" : view.text}</span>
      {view.arrow && (
        <span className={`arrow ${view.arrow.direction}`}>
          {view.arrow.direction === "up" ? "▲" : "▼"}
          {view.arrow.amount}
        </span>
      )}
    </button>
  );
}
