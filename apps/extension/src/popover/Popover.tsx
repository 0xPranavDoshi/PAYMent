import type { CallEntry, UserProfile } from "@copayme/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Gauge, Mark } from "../brand.js";
import { REFRESH_MESSAGE, isContextInvalidated } from "../context.js";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, EyeIcon } from "../icons.js";
import { SIGNED_OUT, type TradingActions, type TradingState } from "../trading.js";
import { callRowView, formatTweetTime, profileView } from "./view.js";

export type PopoverState =
  | { status: "loading" }
  | { status: "error"; /** The extension was reloaded under this page, so retrying cannot help. */ stale?: boolean }
  | { status: "ready"; profile: UserProfile | null; calls: CallEntry[] };

export function Popover(props: {
  handle: string;
  state: PopoverState;
  /** Base URL of the coPAYMe website. */
  webUrl: string;
  onClose: () => void;
  onRetry: () => void;
  /** Without it, the trade buttons say trading is not available. */
  trading?: TradingActions;
  now?: Date;
}) {
  const { handle, state, webUrl, onClose, onRetry, trading, now } = props;
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

      {state.status === "error" && !state.stale && (
        <div className="state">
          <div>Couldn't load this profile.</div>
          <button type="button" className="btn retry" style={{ marginTop: 10 }} onClick={onRetry}>
            Retry
          </button>
        </div>
      )}

      {state.status === "error" && state.stale && (
        <div className="state">
          <div>{REFRESH_MESSAGE}</div>
          <button type="button" className="btn refresh" style={{ marginTop: 10 }} onClick={() => window.location.reload()}>
            Refresh page
          </button>
        </div>
      )}

      {state.status === "ready" && !state.profile && <div className="state">No track record for @{handle} yet.</div>}

      {state.status === "ready" && state.profile && (
        <Summary profile={state.profile} calls={state.calls} now={now} trading={trading} />
      )}

      <div className="foot">
        <a className="site" href={site} target="_blank" rel="noopener noreferrer">
          View full profile on coPAYMe
          <ArrowUpRightIcon />
        </a>
      </div>
    </div>
  );
}

function Summary({
  profile,
  calls,
  now,
  trading,
}: {
  profile: UserProfile;
  calls: CallEntry[];
  now?: Date;
  trading?: TradingActions;
}) {
  const view = profileView(profile, now);
  return (
    <>
      <div className="hero">
        <Gauge score={view.gauge} />
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
        <div title="Average cents per $1 contract beyond the market price, shrunk for small samples">
          <b>{view.edge}</b>
          <span>Edge</span>
        </div>
      </div>

      <TradeActions handle={profile.handle} trading={trading} />

      <div className="sec">Recent picks</div>
      {calls.length === 0 ? (
        <div className="empty">No picks recorded yet.</div>
      ) : (
        <ul className="picks">
          {calls.map((call) => (
            <PickRow key={call.callId} call={call} handle={profile.handle} />
          ))}
        </ul>
      )}
    </>
  );
}

const COPY_AMOUNTS = [5, 10, 25];

/** Watch (follow with $1 paper bets) and Copy trade (mirror each new pick, simulated for now). */
function TradeActions({ handle, trading }: { handle: string; trading?: TradingActions }) {
  const [state, setState] = useState<TradingState | null>(null);
  const [busy, setBusy] = useState<"watch" | "copy" | null>(null);
  // State updates land after the next render, so rapid clicks would all see "not busy". The ref is
  // set immediately, which is what stops a double-click from submitting twice.
  const working = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState(10);
  const [notice, setNotice] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    if (!trading) return;
    trading.state(handle).then(
      (next) => live && setState(next),
      () => live && setState(SIGNED_OUT),
    );
    return () => {
      live = false;
    };
  }, [trading, handle]);

  /** Whether trading can be used right now; if not, says why. */
  function ready(): boolean {
    if (!trading) {
      setNotice({ kind: "info", text: "Trading isn't available yet." });
      return false;
    }
    if (!state?.signedIn) {
      setNotice({ kind: "info", text: "Sign in with X to trade. Coming soon." });
      return false;
    }
    return true;
  }

  async function run(which: "watch" | "copy", action: () => Promise<void>, after: () => void) {
    if (working.current) return;
    working.current = true;
    setBusy(which);
    setNotice(null);
    try {
      await action();
      after();
    } catch (err) {
      setNotice({
        kind: "error",
        text: isContextInvalidated(err) ? REFRESH_MESSAGE : err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  const watching = state?.watching === true;
  const copying = state?.copy?.active === true;

  return (
    <>
      <div className="actions">
        <button
          type="button"
          className={`tbtn ${watching ? "on" : ""}`}
          title={watching ? "Watching: a $1 paper bet on each new pick. Press to stop." : "Watch: follow with $1 paper bets on each new pick"}
          aria-pressed={watching}
          aria-busy={busy === "watch"}
          onClick={() => {
            setConfirming(false);
            if (!ready() || working.current) return;
            void run("watch", () => trading!.setWatch(handle, !watching), () =>
              setState((s) => (s ? { ...s, watching: !watching } : s)),
            );
          }}
        >
          {watching ? <CheckIcon /> : <EyeIcon />}
          {watching ? "Watching" : "Watch"}
        </button>

        <button
          type="button"
          className={`tbtn solid ${copying ? "on" : ""}`}
          title={copying ? `Copying: a $${state?.copy?.amountUsdc} trade on each new pick. Press to stop.` : "Mirror each new pick with a trade (simulated for now)"}
          aria-pressed={copying}
          aria-busy={busy === "copy"}
          onClick={() => {
            if (!ready() || working.current) return;
            if (copying) {
              void run("copy", () => trading!.stopCopy(handle), () =>
                setState((s) => (s ? { ...s, copy: s.copy && { ...s.copy, active: false } } : s)),
              );
            } else {
              setNotice(null);
              setConfirming((open) => !open);
            }
          }}
        >
          {copying ? <CheckIcon /> : <CopyIcon />}
          {copying ? `Copying · $${state?.copy?.amountUsdc}` : "Copy trade"}
        </button>
      </div>

      {confirming && (
        <div className="panel" role="group" aria-label="Confirm copy trading">
          <p>
            <b>Simulated for now.</b> coPAYMe will place a ${amount} trade on every new pick from @{handle}, as it is
            tweeted. You can stop any time.
          </p>
          <div className="chips">
            {COPY_AMOUNTS.map((value) => (
              <button
                key={value}
                type="button"
                className="chip"
                aria-pressed={amount === value}
                onClick={() => setAmount(value)}
              >
                ${value}
              </button>
            ))}
          </div>
          <div className="row2">
            <button
              type="button"
              className="btn primary"
              onClick={() =>
                void run("copy", () => trading!.startCopy(handle, amount), () => {
                  setConfirming(false);
                  setState((s) => (s ? { ...s, copy: { active: true, amountUsdc: amount } } : s));
                })
              }
            >
              Start copying
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className={`toast ${notice.kind === "error" ? "error" : ""}`} role="status">
          {notice.text}
        </div>
      )}
    </>
  );
}

/** One pick. "See tweet" flips the card over to show the tweet's text, instead of leaving the page. */
function PickRow({ call, handle }: { call: CallEntry; handle: string }) {
  const row = callRowView(call);
  const when = formatTweetTime(call.tweetedAt);
  const tone = row.points === null ? "none" : row.outcome.kind === "won" ? "won" : row.outcome.kind === "lost" ? "lost" : "none";

  const [flipped, setFlipped] = useState(false);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>();
  // Both faces are stacked, so the card is as tall as whichever face is showing.
  useLayoutEffect(() => {
    const h = (flipped ? back : front).current?.offsetHeight;
    if (h) setHeight(h);
  }, [flipped, call]);

  return (
    <li className={`pick ${flipped ? "flipped" : ""}`}>
      <div className="flip" style={height ? { height } : undefined}>
        <div className="face front" ref={front} inert={flipped}>
          <div style={{ minWidth: 0 }}>
            <div className="t">{row.event}</div>
            <div className="s">
              <span>
                {row.pick} · {row.price}
              </span>
              <button type="button" className="flipbtn" onClick={() => setFlipped(true)}>
                See tweet
              </button>
            </div>
          </div>
          <span className={`pts ${tone}`}>{row.points ?? row.outcome.text}</span>
        </div>

        <div className="face back" ref={back} inert={!flipped}>
          <div className="tweet">
            <div className="avatar" aria-hidden="true">
              {handle.charAt(0).toUpperCase()}
            </div>
            <div className="tmain">
              <div className="thead">
                <b>@{handle}</b>
                <span>· {when.short}</span>
              </div>
              <p className="ttext">{call.tweetText}</p>
              <div className="tmeta">{when.full}</div>
            </div>
          </div>
          <div className="tfoot">
            <span>
              Pick: {row.pick} · {row.price}
            </span>
            <span className="acts">
              <a className="link" href={row.tweetUrl} target="_blank" rel="noopener noreferrer">
                Open on X ↗
              </a>
              <button type="button" className="flipbtn" onClick={() => setFlipped(false)}>
                Back
              </button>
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}
