import { useEffect, useState, useSyncExternalStore } from "react";
import { badgeView } from "./badgeView.js";
import type { BadgeStore } from "./badgeStore.js";
import { formatElapsed } from "./scanStatus.js";

export { BADGE_CSS } from "./styles.js";

/** Counts up while `active`, for the profile header's scanning pill. */
function useStopwatch(active: boolean): string {
  const [started, setStarted] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const begin = Date.now();
    setStarted(begin);
    setNow(begin);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return active ? formatElapsed(now - started) : "";
}

export function Badge({
  handle,
  store,
  onOpen,
  canScan = false,
  onScan,
}: {
  handle: string;
  store: BadgeStore;
  /** Called when the badge is clicked, with the badge element to anchor the popover to. */
  onOpen?: (handle: string, anchor: Element) => void;
  /** True on the profile header, where an account we know nothing about gets a "Scan picks" button. */
  canScan?: boolean;
  /** Called when "Scan picks" or "Retry" is pressed. */
  onScan?: (handle: string) => void;
}) {
  const state = useSyncExternalStore(
    (notify) => store.subscribe(handle, notify),
    () => store.get(handle),
  );
  const view = badgeView(state, { canScan });
  const clock = useStopwatch(canScan && view?.kind === "scanning");
  if (!view) return null;
  const isAction = view.kind === "offer" || view.kind === "failed";

  return (
    <button
      type="button"
      className={`pill ${view.kind}`}
      title={view.title}
      aria-haspopup={isAction || view.kind === "scanning" ? undefined : "dialog"}
      aria-label={`coPAYMe: ${view.title}`}
      onClick={(event) => {
        // A tweet is a link: without this, clicking the badge would open the tweet.
        event.preventDefault();
        event.stopPropagation();
        if (isAction) onScan?.(handle);
        else if (view.kind !== "scanning") onOpen?.(handle, event.currentTarget);
      }}
      onKeyDown={(event) => {
        // X has page-wide keyboard shortcuts; Enter and Space on the badge must not reach them.
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
    >
      {view.meter && <span className={`meter ${view.meter.band}`} style={{ "--v": `${view.meter.pct}%` } as React.CSSProperties} />}
      <span className="num">{view.kind === "new" ? "NEW" : view.text}</span>
      {clock && <span className="clock">{clock}</span>}
    </button>
  );
}
