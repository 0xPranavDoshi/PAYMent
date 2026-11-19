import type { CallEntry, UserProfile } from "@copayme/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Gauge, Mark } from "../brand.js";
import { REFRESH_MESSAGE, isContextInvalidated } from "../context.js";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, EyeIcon } from "../icons.js";
import { SIGNED_OUT, type TradingActions, type TradingState } from "../trading.js";
import { callRowView, formatAmount, formatTweetTime, parseAmount, profileView, watchView } from "./view.js";

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

      <TradeActions handle={profile.handle} trading={trading} score={view.gauge} />

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

const COPY_PRESETS = [5, 10, 25];
const DEFAULT_COPY_AMOUNT = 10;

/** Watch (a watchlist that shows how a trader does from now on) and Copy trade (mirror each new pick). */
function TradeActions({ handle, trading, score }: { handle: string; trading?: TradingActions; score: number | null }) {
  const [state, setState] = useState<TradingState | null>(null);
  const [busy, setBusy] = useState<"watch" | "copy" | null>(null);
  // State updates land after the next render, so rapid clicks would all see "not busy". The ref is
  // set immediately, which is what stops a double-click from submitting twice.
  const working = useRef(false);
  const [panel, setPanel] = useState<"copy" | null>(null);
  const [preset, setPreset] = useState<number | "custom">(DEFAULT_COPY_AMOUNT);
  const [custom, setCustom] = useState("");
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

  /** Runs one action, then re-reads the truth from the service so what is shown is what is saved. */
  async function run(which: "watch" | "copy", action: () => Promise<void>, done: string, after?: () => void) {
    if (working.current) return;
    working.current = true;
    setBusy(which);
    setNotice(null);
    try {
      await action();
      after?.();
      setNotice({ kind: "info", text: done });
      setState(await trading!.state(handle).catch(() => state));
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

  const watch = state?.watch ?? null;
  const copying = state?.copy?.active === true;
  const paperMode = state?.copyMode === "paper";
  const amount = preset === "custom" ? parseAmount(custom) : preset;
  const customInvalid = preset === "custom" && custom.trim() !== "" && amount === null;

  function openCopyPanel() {
    // Editing an existing copy starts from its current amount.
    const current = state?.copy?.active ? state.copy.amountUsdc : DEFAULT_COPY_AMOUNT;
    if (COPY_PRESETS.includes(current)) {
      setPreset(current);
      setCustom("");
    } else {
      setPreset("custom");
      setCustom(String(current));
    }
    setNotice(null);
    setPanel("copy");
  }

  const stopWatching = () =>
    void run("watch", () => trading!.setWatch(handle, false), `Stopped watching @${handle}.`);
  const stopCopying = () =>
    void run("copy", () => trading!.stopCopy(handle), `Stopped copying @${handle}. Picks already copied stay open.`);

  const view = watch ? watchView(watch, score) : null;

  return (
    <>
      <div className="actions">
        <button
          type="button"
          className={`tbtn ${watch ? "on" : ""}`}
          title={
            watch
              ? "Watching. Press to stop."
              : "Watch: add to your watchlist and see how their score and a $1-per-pick paper P&L move from now on"
          }
          aria-pressed={watch !== null}
          aria-busy={busy === "watch"}
          onClick={() => {
            setPanel(null);
            if (!ready() || working.current) return;
            void run(
              "watch",
              () => trading!.setWatch(handle, !watch),
              watch ? `Stopped watching @${handle}.` : `Watching @${handle}. You'll see how they do from now on.`,
            );
          }}
        >
          {watch ? <CheckIcon /> : <EyeIcon />}
          {watch ? "Watching" : "Watch"}
        </button>

        <button
          type="button"
          className={`tbtn solid ${copying ? "on" : ""}`}
          title={copying ? `Copying at ${formatAmount(state?.copy?.amountUsdc ?? 0)} per pick. Press to stop.` : "Copy trade: mirror each new pick"}
          aria-pressed={copying}
          aria-busy={busy === "copy"}
          onClick={() => {
            if (!ready() || working.current) return;
            if (copying) stopCopying();
            else if (panel === "copy") setPanel(null);
            else openCopyPanel();
          }}
        >
          {copying ? <CheckIcon /> : <CopyIcon />}
          {copying ? `Copying · ${formatAmount(state?.copy?.amountUsdc ?? 0)}` : "Copy trade"}
        </button>
      </div>

      {view && (
        <div className="status" role="group" aria-label="Watching">
          <div className="shead">
            <b>Watching</b>
            <span>since {view.since}</span>
          </div>
          <dl className="srows">
            <div>
              <dt>Score</dt>
              <dd>
                {view.score.then} → {view.score.now}
                {view.score.delta && <em className={view.score.delta.direction}>{view.score.delta.text}</em>}
              </dd>
            </div>
            <div>
              <dt>Paper P&L</dt>
              <dd className={view.pnl.tone}>{view.pnl.text}</dd>
            </div>
            <div>
              <dt>Picks</dt>
              <dd>{view.picks}</dd>
            </div>
          </dl>
          <div className="sacts">
            {!copying && (
              <button type="button" className="btn sm primary" onClick={openCopyPanel}>
                Start copying
              </button>
            )}
            <button type="button" className="stopbtn" onClick={stopWatching}>
              Stop watching
            </button>
          </div>
        </div>
      )}

      {copying && (
        <div className="status" role="group" aria-label="Copying">
          <div className="shead">
            <b>Copying</b>
            <span>
              {formatAmount(state?.copy?.amountUsdc ?? 0)} per new pick · {paperMode ? "simulated" : "real orders"}
            </span>
          </div>
          <p className="sdesc">Every new pick from @{handle} is copied automatically. Stopping doesn't close picks already copied.</p>
          <div className="sacts">
            <button type="button" className="btn sm" onClick={openCopyPanel}>
              Change amount
            </button>
            <button type="button" className="stopbtn" onClick={stopCopying}>
              Stop copying
            </button>
          </div>
        </div>
      )}

      {panel === "copy" && (
        <div className="panel" role="group" aria-label="Copy trade amount">
          <p>
            {paperMode ? (
              <>
                <b>This is simulated.</b> coPAYMe will place a paper trade of {amount !== null ? formatAmount(amount) : "your amount"} on every new
                pick from @{handle}, as it is tweeted. No real money moves.
              </>
            ) : (
              <>
                <b>This places real orders.</b> coPAYMe will buy {amount !== null ? formatAmount(amount) : "your amount"} on every new pick from @{handle},
                as it is tweeted.
              </>
            )}{" "}
            You can stop any time.
          </p>
          <div className="chips">
            {COPY_PRESETS.map((value) => (
              <button key={value} type="button" className="chip" aria-pressed={preset === value} onClick={() => setPreset(value)}>
                ${value}
              </button>
            ))}
            <label className={`amount ${preset === "custom" ? "active" : ""} ${customInvalid ? "bad" : ""}`}>
              <span>$</span>
              <input
                inputMode="decimal"
                placeholder="Other"
                aria-label="Other amount in dollars"
                value={custom}
                onFocus={() => setPreset("custom")}
                onChange={(event) => {
                  setPreset("custom");
                  setCustom(event.target.value);
                }}
              />
            </label>
          </div>
          {customInvalid && <div className="hint">Enter an amount above $0, with at most two decimals.</div>}
          <div className="row2">
            <button
              type="button"
              className="btn primary"
              disabled={amount === null}
              onClick={() =>
                amount !== null &&
                void run(
                  "copy",
                  () => trading!.startCopy(handle, amount),
                  copying ? `Now copying @${handle} at ${formatAmount(amount)} per pick.` : `Copying @${handle} at ${formatAmount(amount)} per pick.`,
                  () => setPanel(null),
                )
              }
            >
              {copying ? "Update amount" : "Start copying"}
            </button>
            <button type="button" className="btn" onClick={() => setPanel(null)}>
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
