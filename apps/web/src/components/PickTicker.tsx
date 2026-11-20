import type { RecentCall } from "@copayme/shared";

/** A black strip of the latest picks. Static: it overflows hidden and does not animate. */
export default function PickTicker({ calls }: { calls: RecentCall[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="hm-ticker" aria-label="Latest picks">
      <span className="live">LIVE PICKS</span>
      {calls.map((c) => (
        <span key={c.callId}>
          <b>@{c.handle}</b> {c.pickLabel}
          {c.side && (
            <>
              {" "}
              <span className={c.side === "yes" ? "y" : "n"}>
                {c.side.toUpperCase()}
                {c.oddsAtCall !== null ? ` ${Math.round(c.oddsAtCall * 100)}¢` : ""}
              </span>
            </>
          )}
        </span>
      ))}
    </div>
  );
}
