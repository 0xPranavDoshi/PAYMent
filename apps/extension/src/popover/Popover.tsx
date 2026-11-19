import type { CallEntry, UserProfile } from "@copayme/shared";
import { Gauge, Mark } from "../brand.js";
import { callRowView, profileView } from "./view.js";

export type PopoverState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; profile: UserProfile | null; calls: CallEntry[] };

export function Popover(props: {
  handle: string;
  state: PopoverState;
  /** Base URL of the coPAYMe website. */
  webUrl: string;
  onClose: () => void;
  onRetry: () => void;
  now?: Date;
}) {
  const { handle, state, webUrl, onClose, onRetry, now } = props;
  const site = `${webUrl.replace(/\/$/, "")}/traders/${encodeURIComponent(handle)}`;

  return (
    <div className="card" role="dialog" aria-label={`coPAYMe track record for @${handle}`}>
      <div className="top">
        <span className="brand">
          <Mark /> coPAYMe
        </span>
        <button type="button" className="x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {state.status === "loading" && (
        <div className="skeleton" aria-busy="true">
          <span className="handle">@{handle}</span>
          <div className="bar" style={{ width: "70%" }} />
          <div className="bar" style={{ width: "45%" }} />
          <div className="sub">Loading…</div>
        </div>
      )}

      {state.status === "error" && (
        <div className="state">
          <div>Couldn't load this profile.</div>
          <button type="button" className="btn retry" style={{ marginTop: 10 }} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {state.status === "ready" && !state.profile && (
        <div className="state">No track record for @{handle} yet.</div>
      )}

      {state.status === "ready" && state.profile && (
        <Summary profile={state.profile} calls={state.calls} now={now} />
      )}

      <div className="foot">
        <span />
        <a className="link" href={site} target="_blank" rel="noopener noreferrer">
          Open coPAYMe ↗
        </a>
      </div>
    </div>
  );
}

function Summary({ profile, calls, now }: { profile: UserProfile; calls: CallEntry[]; now?: Date }) {
  const view = profileView(profile, now);
  return (
    <>
      <div className="hero">
        <Gauge score={view.gauge} label={view.badge.kind === "new" ? "NEW" : view.badge.text} />
        <div className="who">
          <div className="handle">@{profile.handle}</div>
          {view.lastPick && <div className="sub">{view.lastPick}</div>}
          {view.delta && <span className={`delta ${view.delta.direction}`}>{view.delta.text}</span>}
        </div>
      </div>
      {view.note && <div className="note">{view.note}</div>}

      <div className="stats">
        <div title="Wins and losses">
          <b>{view.record}</b>
          <span>Record</span>
        </div>
        <div>
          <b>{view.hitRate}</b>
          <span>Hit rate</span>
        </div>
        <div title="Average points per pick beyond the market price, shrunk for small samples">
          <b>{view.edge}</b>
          <span>Edge</span>
        </div>
      </div>

      <div className="sec">Recent picks</div>
      {calls.length === 0 ? (
        <div className="empty">No picks recorded yet.</div>
      ) : (
        <ul className="picks">
          {calls.map((call) => {
            const row = callRowView(call);
            const tone = row.points === null ? "none" : row.outcome.kind === "won" ? "won" : row.outcome.kind === "lost" ? "lost" : "none";
            return (
              <li className="pick" key={call.callId}>
                <span className={`dot ${row.outcome.kind}`} title={row.outcome.text} />
                <div style={{ minWidth: 0 }}>
                  <div className="t">{row.event}</div>
                  <div className="s">
                    <span>
                      {row.pick} · {row.price}
                    </span>
                    <a href={row.tweetUrl} target="_blank" rel="noopener noreferrer">
                      Tweet ↗
                    </a>
                  </div>
                </div>
                <span className={`pts ${tone}`}>{row.points ?? row.outcome.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
