import type { CallEntry, UserProfile } from "@copayme/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mark, ScoreTile } from "../brand.js";
import { REFRESH_MESSAGE, isContextInvalidated } from "../context.js";
import { ArrowUpRightIcon, CheckIcon, ChevronDownIcon, CopyIcon, EyeIcon } from "../icons.js";
import { SIGNED_OUT, type TradingActions, type TradingState } from "../trading.js";
import { TweetCard } from "@copayme/tweet-card";
import { callRowView, formatAmount, parseAmount, profileView } from "./view.js";

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
  /** Scans the account again (new posts, and stored picks re-checked). Without it, no Rescan button. */
  onRescan?: () => void;
  now?: Date;
}) {
  const { handle, state, webUrl, onClose, onRetry, onRescan, trading, now } = props;
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
        <Summary profile={state.profile} calls={state.calls} now={now} trading={trading} webUrl={webUrl} />
      )}

      <div className="foot">
        <a className="site" href={site} target="_blank" rel="noopener noreferrer">
          View full profile on coPAYMe
          <ArrowUpRightIcon />
        </a>
        {onRescan && (
          <button
            type="button"
            className="rescan"
            title="Read this account's new posts and re-check its stored picks. Costs nothing if it hasn't posted."
            onClick={onRescan}
          >
            Rescan
          </button>
        )}
      </div>
    </div>
  );
}

function Summary({
  profile,
  calls,
  now,
  trading,
  webUrl,
}: {
  profile: UserProfile;
  calls: CallEntry[];
  now?: Date;
  trading?: TradingActions;
  webUrl: string;
}) {
  const view = profileView(profile, now);
  return (
    <>
      <div className="hero">
        <ScoreTile score={view.gauge} size="lg" />
        <div className="who">
          <div className="handle">@{profile.handle}</div>
          {view.lastPick && <div className="sub">{view.lastPick}</div>}
          {view.delta && <span className={`delta ${view.delta.direction}`}>{view.delta.text}</span>}
        </div>
      </div>
      {view.note && <div className="note">{view.note}</div>}

      <div className="stats">
        <div title="Wins and losses">
          <b aria-label={view.record}>
            <span className="w">{view.wins}</span>–<span className="l">{view.losses}</span>
          </b>
          <span>Record</span>
        </div>
        <div>
          <b>{view.hitRate}</b>
          <span>Hit rate</span>
        </div>
        <div title="Average cents per $1 contract beyond the market price, shrunk for small samples">
          <b className={view.edgeTone === "none" ? undefined : view.edgeTone === "up" ? "w" : "l"}>{view.edge}</b>
          <span>Edge</span>
        </div>
      </div>

      <TradeActions handle={profile.handle} trading={trading} webUrl={webUrl} />

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
/** How long a confirmation line stays before it clears itself. */
const NOTICE_MS = 5000;

interface Notice {
  kind: "info" | "error";
  text: string;
  /** An optional link shown after the text, e.g. to the website's watchlist. */
  link?: { href: string; label: string };
}

/**
 * Watch (add the trader to your watchlist, which lives on the website) and Copy trade (mirror each new
 * pick). Both are plain toggles; there are no panels that stay open. While copying, the Copy trade
 * pill opens a small menu to change the amount or stop.
 */
function TradeActions({ handle, trading, webUrl }: { handle: string; trading?: TradingActions; webUrl: string }) {
  const [state, setState] = useState<TradingState | null>(null);
  const [busy, setBusy] = useState<"watch" | "copy" | null>(null);
  // State updates land after the next render, so rapid clicks would all see "not busy". The ref is
  // set immediately, which is what stops a double-click from submitting twice.
  const working = useRef(false);
  const [panel, setPanel] = useState<"amount" | "menu" | null>(null);
  const [preset, setPreset] = useState<number | "custom">(DEFAULT_COPY_AMOUNT);
  const [custom, setCustom] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const watchlistUrl = `${webUrl.replace(/\/$/, "")}/watchlist`;

  /** Re-reads login + watch/copy state from the service and returns it. */
  const refresh = useCallback(async (): Promise<TradingState | null> => {
    if (!trading) return null;
    try {
      const next = await trading.state(handle);
      setState(next);
      return next;
    } catch {
      setState(SIGNED_OUT);
      return SIGNED_OUT;
    }
  }, [trading, handle]);

  useEffect(() => {
    void refresh();
    // Re-check when the user comes back to this tab — e.g. after signing in on coPAYMe in
    // another tab — so the login takes effect without reloading x.com.
    const onReturn = () => {
      if (!document.hidden) void refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refresh]);

  // A confirmation clears itself, so nothing is left sitting in the card.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  /** Synchronous check: true/false when known, null when the cached state says signed out
   *  and it's worth re-checking. Staying sync on the signed-in path keeps the double-click
   *  guard (`working`) effective. */
  function readyNow(): boolean | null {
    if (!trading) {
      setNotice({ kind: "info", text: "Trading isn't available yet." });
      return false;
    }
    return state?.signedIn ? true : null;
  }

  /** Re-checks the login (a sign-in on the site may have just happened in another tab);
   *  if still signed out, sends the user to sign in. */
  async function recheck(): Promise<boolean> {
    const current = await refresh();
    if (!current?.signedIn) {
      // One login for site + extension: sign in on the coPAYMe site, and the session
      // bridge (entrypoints/webAuth.content.ts) hands it to the extension.
      try { window.open(`${webUrl.replace(/\/$/, "")}/signin`, "_blank", "noopener"); } catch { /* blocked */ }
      setNotice({ kind: "info", text: "Sign in with X on coPAYMe, then come back here." });
      return false;
    }
    return true;
  }

  /** Runs one action, then re-reads the truth from the service so what is shown is what is saved. */
  async function run(which: "watch" | "copy", action: () => Promise<void>, done: Notice, after?: () => void) {
    if (working.current) return;
    working.current = true;
    setBusy(which);
    setNotice(null);
    try {
      await action();
      after?.();
      setNotice(done);
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

  const watching = state?.watching === true;
  const copying = state?.copy?.active === true;
  const paperMode = state?.copyMode === "paper";
  const amount = preset === "custom" ? parseAmount(custom) : preset;
  const customInvalid = preset === "custom" && custom.trim() !== "" && amount === null;

  function openAmountPanel() {
    // Changing an existing copy starts from its current amount.
    const current = state?.copy?.active ? state.copy.amountUsdc : DEFAULT_COPY_AMOUNT;
    if (COPY_PRESETS.includes(current)) {
      setPreset(current);
      setCustom("");
    } else {
      setPreset("custom");
      setCustom(String(current));
    }
    setNotice(null);
    setPanel("amount");
  }

  const stopCopying = () =>
    void run("copy", () => trading!.stopCopy(handle), { kind: "info", text: `Stopped copying @${handle}. Picks already copied stay open.` }, () =>
      setPanel(null),
    );

  return (
    <>
      <div className="actions">
        <button
          type="button"
          className={`tbtn ${watching ? "on" : ""}`}
          title={watching ? "On your watchlist. Press to remove." : "Add to your watchlist, where you can follow how they do"}
          aria-pressed={watching}
          aria-busy={busy === "watch"}
          onClick={async () => {
            setPanel(null);
            if (working.current) return;
            if (!(readyNow() ?? (await recheck()))) return;
            void run(
              "watch",
              () => trading!.setWatch(handle, !watching),
              watching
                ? { kind: "info", text: "Removed from your watchlist." }
                : { kind: "info", text: "Added to your watchlist.", link: { href: watchlistUrl, label: "View watchlist ↗" } },
            );
          }}
        >
          {watching ? <CheckIcon /> : <EyeIcon />}
          {watching ? "Watching" : "Watch"}
        </button>

        <button
          type="button"
          className={`tbtn solid ${copying ? "on" : ""}`}
          title={copying ? `Copying at ${formatAmount(state?.copy?.amountUsdc ?? 0)} per pick. Press for options.` : "Copy trade: mirror each new pick"}
          aria-pressed={copying}
          aria-expanded={copying ? panel === "menu" : panel === "amount"}
          aria-busy={busy === "copy"}
          onClick={async () => {
            if (working.current) return;
            if (!(readyNow() ?? (await recheck()))) return;
            if (copying) setPanel((open) => (open === "menu" ? null : "menu"));
            else if (panel === "amount") setPanel(null);
            else openAmountPanel();
          }}
        >
          {copying ? <CheckIcon /> : <CopyIcon />}
          {copying ? `Copying · ${formatAmount(state?.copy?.amountUsdc ?? 0)}` : "Copy trade"}
          {copying && <ChevronDownIcon />}
        </button>
      </div>

      {copying && panel === "menu" && (
        <div className="menu" role="menu" aria-label="Copy trading options">
          <button type="button" role="menuitem" onClick={openAmountPanel}>
            Change amount
          </button>
          <button type="button" role="menuitem" className="danger" onClick={stopCopying}>
            Stop copying
          </button>
        </div>
      )}

      {panel === "amount" && (
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
                  { kind: "info", text: copying ? `Now copying @${handle} at ${formatAmount(amount)} per pick.` : `Copying @${handle} at ${formatAmount(amount)} per pick.` },
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
          {notice.link && (
            <a href={notice.link.href} target="_blank" rel="noopener noreferrer">
              {notice.link.label}
            </a>
          )}
        </div>
      )}
    </>
  );
}

/** One pick. "See tweet" flips the card over to show the tweet's text, instead of leaving the page. */
function PickRow({ call, handle }: { call: CallEntry; handle: string }) {
  const row = callRowView(call);
  const tone = row.points === null ? "none" : row.outcome.kind === "won" ? "won" : row.outcome.kind === "lost" ? "lost" : "none";

  const [flipped, setFlipped] = useState(false);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLLIElement>(null);
  const [height, setHeight] = useState<number | undefined>();
  // Both faces are stacked, so the card is as tall as whichever face is showing.
  useLayoutEffect(() => {
    const h = (flipped ? back : front).current?.offsetHeight;
    if (h) setHeight(h);
  }, [flipped, call]);
  // The card scrolls. After reading a tall tweet and flipping back, the scroll position can be
  // beyond the shorter content, leaving a blank card; bring the pick back into view instead.
  useEffect(() => {
    item.current?.scrollIntoView({ block: "nearest" });
  }, [flipped]);

  return (
    <li ref={item} className={`pick ${flipped ? "flipped" : ""}`}>
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
          <span className={`pts ${tone}`} >{row.points ?? row.outcome.text}</span>
        </div>

        <div className="face back" ref={back} inert={!flipped}>
          <TweetCard
            handle={handle}
            text={call.tweetText}
            postedAt={call.tweetedAt}
            tweetId={call.tweetId}
            note={
              <>
                Pick: {row.pick} · {row.price}
              </>
            }
            actions={
              <button type="button" className="flipbtn" onClick={() => setFlipped(false)}>
                Back
              </button>
            }
          />
        </div>
      </div>
    </li>
  );
}
