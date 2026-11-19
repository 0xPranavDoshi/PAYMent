import type { CallEntry, UserProfile } from "@copayme/shared";
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
}) {
  const { handle, state, webUrl, onClose, onRetry } = props;

  return (
    <div className="card" role="dialog" aria-label={`Track record for @${handle}`}>
      <div className="head">
        <span className="handle">@{handle}</span>
        <button type="button" className="close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {state.status === "loading" && <div className="muted">Loading…</div>}

      {state.status === "error" && (
        <div>
          <div className="muted">Couldn't load this profile.</div>
          <button type="button" className="retry" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {state.status === "ready" && !state.profile && (
        <div className="muted">No track record for @{handle} yet.</div>
      )}

      {state.status === "ready" && state.profile && <Summary profile={state.profile} calls={state.calls} />}

      <div className="foot">
        <a href={`${webUrl.replace(/\/$/, "")}/traders/${encodeURIComponent(handle)}`} target="_blank" rel="noopener noreferrer">
          Open coPAYMe ↗
        </a>
      </div>
    </div>
  );
}

function Summary({ profile, calls }: { profile: UserProfile; calls: CallEntry[] }) {
  const view = profileView(profile);
  return (
    <>
      <div className="score">
        <span className={`num ${view.badge.kind}`}>{view.badge.text}</span>
        {view.badge.arrow && (
          <span className={`arrow ${view.badge.arrow.direction}`}>
            {view.badge.arrow.direction === "up" ? "▲" : "▼"}
            {view.badge.arrow.amount}
          </span>
        )}
      </div>
      <div className="muted">{view.summary}</div>
      {view.note && <div className="muted note">{view.note}</div>}

      <h3>Recent picks</h3>
      {calls.length === 0 ? (
        <div className="muted">No picks recorded yet.</div>
      ) : (
        <ul>
          {calls.map((call) => {
            const row = callRowView(call);
            return (
              <li className="row" key={call.callId}>
                <div className="line">
                  <span className="event">{row.event}</span>
                  <span className={`pill ${row.outcome.kind}`}>{row.outcome.text}</span>
                </div>
                <div className="detail muted">
                  <span>
                    {row.pick} · {row.price}
                  </span>
                  <span>{row.points ?? ""}</span>
                </div>
                <div className="detail muted">
                  <a href={row.tweetUrl} target="_blank" rel="noopener noreferrer">
                    View tweet ↗
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
