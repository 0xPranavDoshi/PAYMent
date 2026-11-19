import { useEffect, useState, useSyncExternalStore } from "react";
import { Mark } from "./brand.js";
import { formatElapsed, type ScanStatusStore } from "./scanStatus.js";

/** How long a finished result stays on screen. */
const RESULT_MS = 9_000;

function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === null ? "" : formatElapsed(now - startedAt);
}

/**
 * A card in the corner of the page that shows a profile scan running (with a stopwatch and a moving bar),
 * then how it ended. It is the one place the user can always see that something is happening.
 */
export function ScanCard({ store, onRetry, onStop }: { store: ScanStatusStore; onRetry: (handle: string) => void; onStop?: (handle: string) => void }) {
  const status = useSyncExternalStore(store.subscribe, store.get);
  const elapsed = useElapsed(status?.phase === "scanning" ? status.startedAt : null);

  // Results fade away by themselves; a running scan and a failure stay until dealt with.
  useEffect(() => {
    if (!status || status.phase === "scanning" || status.phase === "failed") return;
    const timer = setTimeout(() => store.set(null), RESULT_MS);
    return () => clearTimeout(timer);
  }, [status, store]);

  if (!status) return null;
  const who = `@${status.handle}`;
  const running = status.phase === "scanning";

  return (
    <div className={`scan ${status.phase}`} role="status" aria-live="polite">
      <div className="head">
        <Mark className={`mark ${running ? "spin" : ""}`} />
        <b>
          {running && `Scanning ${who}`}
          {status.phase === "done" && `${who} scanned`}
          {status.phase === "empty" && "No picks found"}
          {status.phase === "failed" && "Scan didn't finish"}
          {status.phase === "recent" && "Scanned a moment ago"}
          {status.phase === "stopped" && "Scan stopped"}
        </b>
        {running && <span className="clock">{elapsed}</span>}
        {/* A running scan is stopped, not hidden: hiding it would leave it running with no way to stop it. */}
        {!running && (
          <button type="button" className="x" aria-label="Dismiss" onClick={() => store.set(null)}>
            ×
          </button>
        )}
      </div>

      {running && (
        <>
          <div className="bar" aria-hidden="true">
            <i />
          </div>
          <p>Reading their recent posts and matching picks to markets. The first scan can take a couple of minutes.</p>
          {onStop && (
            <button type="button" className="stop" onClick={() => onStop(status.handle)}>
              Stop scan
            </button>
          )}
        </>
      )}
      {status.phase === "done" && (
        <p>
          {status.badge.tier === "new"
            ? `${status.badge.nResolved} settled pick${status.badge.nResolved === 1 ? "" : "s"} so far. A score appears at 5.`
            : `Score ${status.badge.score} · ${status.badge.nResolved} settled picks.`}
        </p>
      )}
      {status.phase === "empty" && <p>We read {who}&apos;s recent posts and found no sports picks on markets we track.</p>}
      {status.phase === "recent" && <p>Give it a few minutes, then reload the page to see the result.</p>}
      {status.phase === "stopped" && <p>Nothing more will be read for {who}. You can scan it again any time.</p>}
      {status.phase === "failed" && (
        <>
          <p>The scan stopped before it finished. Nothing was lost; you can run it again.</p>
          <button type="button" className="again" onClick={() => onRetry(status.handle)}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
