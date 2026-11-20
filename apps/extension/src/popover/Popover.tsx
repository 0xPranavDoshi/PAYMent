import {
  COPY_STEPS,
  DEFAULT_COPY_AMOUNT,
  pastWeekEarnings,
  snapToStep,
  stepAmount,
  type CallEntry,
  type UserProfile,
} from "@copayme/shared";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Mark, ScoreTile } from "../brand.js";
import { REFRESH_MESSAGE, isContextInvalidated } from "../context.js";
import { ArrowUpRightIcon, CheckIcon } from "../icons.js";
import type { Rank } from "../messages.js";
import { SIGNED_OUT, type TradingActions, type TradingState } from "../trading.js";
import { TweetCard } from "@copayme/tweet-card";
import { callRowView, formatAmount, formatUsd, profileView, recentPicks } from "./view.js";

export type PopoverState =
  | { status: "loading" }
  | { status: "error"; /** The extension was reloaded under this page, so retrying cannot help. */ stale?: boolean }
  | { status: "ready"; profile: UserProfile | null; calls: CallEntry[] };

export function Popover(props: {
  handle: string;
  state: PopoverState;
  /** Where the trader stands on the leaderboard, shown as "#R of N". Null or missing: not shown. */
  rank?: Rank | null;
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
  const { handle, state, rank = null, webUrl, onClose, onRetry, onRescan, trading, now } = props;
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

      {state.status === "ready" && state.profile && <Summary profile={state.profile} calls={state.calls} rank={rank} />}

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

      {state.status === "ready" && state.profile && (
        <TradeActions handle={state.profile.handle} calls={state.calls} now={now} trading={trading} webUrl={webUrl} />
      )}
    </div>
  );
}

function Summary({ profile, calls, rank }: { profile: UserProfile; calls: CallEntry[]; rank: Rank | null }) {
  const view = profileView(profile);
  const recent = recentPicks(calls, 2);
  return (
    <>
      <div className="head">
        <div className="who">
          <div className="handle" title={`@${profile.handle}`}>@{profile.handle}</div>
          <div className="sub">
            {view.picks} resolved
            {rank && (
              <>
                {" · "}
                <span className={`rank ${rank.rank === 1 ? "first" : ""}`}>
                  #{rank.rank} of {rank.total}
                </span>
              </>
            )}
          </div>
          {view.delta && <span className={`delta ${view.delta.direction}`}>{view.delta.text}</span>}
        </div>
        <ScoreTile score={view.gauge} size="lg" />
      </div>
      {view.note && <div className="note">{view.note}</div>}

      <div className="kv">
        <div title="Wins and losses">
          <span>Record</span>
          <b aria-label={view.record}>
            <span className="w">{view.wins}</span>–<span className="l">{view.losses}</span>
          </b>
        </div>
        <div>
          <span>Hit rate</span>
          <b>{view.hitRate}</b>
        </div>
        <div title="Average cents per $1 contract beyond the market price, shrunk for small samples">
          <span>Edge</span>
          <b className={view.edgeTone === "none" ? undefined : view.edgeTone === "up" ? "w" : "l"}>{view.edge}</b>
        </div>
      </div>

      {recent.length === 0 ? (
        <div className="empty">No picks recorded yet.</div>
      ) : (
        <ul className="picks" aria-label="Recent picks">
          {recent.map((call) => (
            <PickRow key={call.callId} call={call} handle={profile.handle} />
          ))}
        </ul>
      )}
    </>
  );
}

/** How long a confirmation line stays before it clears itself. */
const NOTICE_MS = 5000;
const MIN_STEP = COPY_STEPS[0]!;
const MAX_STEP = COPY_STEPS[COPY_STEPS.length - 1]!;

interface Notice {
  kind: "info" | "error";
  text: string;
  /** An optional link shown after the text, e.g. to the website's watchlist. */
  link?: { href: string; label: string };
}

/** "NOV 19", for the stamp's "SINCE NOV 19". */
const sinceLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();

/**
 * Watch (add the trader to your watchlist, which lives on the website) and Copy trade. Copy trade
 * tears a stub off the bottom of the card: the amount per pick on a stepper, what that amount would
 * have made over the past week, and one button to confirm. While copying, the stub is a green
 * "Copying" stamp with Change amount and Stop copying.
 */
function TradeActions({
  handle,
  calls,
  now,
  trading,
  webUrl,
}: {
  handle: string;
  calls: CallEntry[];
  now?: Date;
  trading?: TradingActions;
  webUrl: string;
}) {
  const [state, setState] = useState<TradingState | null>(null);
  const [busy, setBusy] = useState<"watch" | "copy" | null>(null);
  // State updates land after the next render, so rapid clicks would all see "not busy". The ref is
  // set immediately, which is what stops a double-click from submitting twice.
  const working = useRef(false);
  const [open, setOpen] = useState(false);
  /** Changing the amount of a copy that is running: the stub shows the stepper instead of the stamp. */
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(DEFAULT_COPY_AMOUNT);
  const [notice, setNotice] = useState<Notice | null>(null);
  const stub = useRef<HTMLDivElement>(null);
  const base = webUrl.replace(/\/$/, "");
  const watchlistUrl = `${base}/watchlist`;

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

  // The stub opens at the bottom of a card that scrolls, so bring it into view.
  useEffect(() => {
    if (open) stub.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

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
      try { window.open(`${base}/signin`, "_blank", "noopener"); } catch { /* blocked */ }
      setNotice({ kind: "info", text: "Sign in with X on coPAYMe, then come back here." });
      return false;
    }
    return true;
  }

  /** Runs one action, then re-reads the truth from the service so what is shown is what is saved. */
  async function run(which: "watch" | "copy", action: () => Promise<void>, done: Notice | null, after?: () => void) {
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
  const copy = state?.copy?.active ? state.copy : null;
  const showStamp = copy !== null && !editing;
  const week = pastWeekEarnings(calls, amount, now ?? new Date());

  function openStub() {
    // A running copy's amount may not be one of the steps; the stepper starts at the nearest one.
    setAmount(copy ? snapToStep(copy.amountUsdc) : DEFAULT_COPY_AMOUNT);
    setEditing(false);
    setNotice(null);
    setOpen(true);
  }

  const confirm = () => void run("copy", () => trading!.startCopy(handle, amount), null, () => setEditing(false));

  const stopCopying = () =>
    void run("copy", () => trading!.stopCopy(handle), { kind: "info", text: `Stopped copying @${handle}. Picks already copied stay open.` }, () =>
      setOpen(false),
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
          {watching && <CheckIcon />}
          {watching ? "Watching" : "Watch"}
        </button>

        <button
          type="button"
          className={`tbtn copy ${copy ? "on" : ""} ${open ? "pressed" : ""}`}
          title={copy ? `Copying at ${formatAmount(copy.amountUsdc)} per pick. Press to change or stop.` : "Copy trade: mirror each new pick"}
          aria-expanded={open}
          aria-busy={busy === "copy"}
          onClick={async () => {
            if (working.current) return;
            if (!(readyNow() ?? (await recheck()))) return;
            if (open) setOpen(false);
            else openStub();
          }}
        >
          {copy && <CheckIcon />}
          {copy ? `Copying · ${formatAmount(copy.amountUsdc)}` : open ? "Copy trade ▴" : "Copy trade"}
        </button>
      </div>

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

      {open && (
        <>
          <div className="perf" aria-hidden="true" />
          <div className="pstub" ref={stub} role="group" aria-label={`Copy trade @${handle}`}>
            {showStamp ? (
              <>
                <div className="stamp">
                  Copying @{handle}
                  <small>
                    {formatAmount(copy.amountUsdc)} PER PICK{copy.since ? ` · SINCE ${sinceLabel(copy.since)}` : ""}
                  </small>
                </div>
                <div className="row2">
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setAmount(snapToStep(copy.amountUsdc));
                      setNotice(null);
                      setEditing(true);
                    }}
                  >
                    Change amount
                  </button>
                  <button type="button" className="btn sm danger" aria-busy={busy === "copy"} onClick={stopCopying}>
                    Stop copying
                  </button>
                </div>
                <p className="fine">
                  See every copied pick in{" "}
                  <a href={`${base}/portfolio`} target="_blank" rel="noopener noreferrer">
                    Portfolio
                  </a>
                  .
                </p>
              </>
            ) : (
              <>
                <div className="ph">
                  COPY TRADE <small>@{handle}</small>
                </div>
                <div className="pslip">
                  <div className="li">
                    <span>Amount per pick</span>
                    <span className="dots" />
                    <span className="stp">
                      <button type="button" aria-label="Lower amount per pick" disabled={amount <= MIN_STEP} onClick={() => setAmount((a) => stepAmount(a, -1))}>
                        −
                      </button>
                      <b aria-live="polite">{formatAmount(amount)}</b>
                      <button type="button" aria-label="Raise amount per pick" disabled={amount >= MAX_STEP} onClick={() => setAmount((a) => stepAmount(a, 1))}>
                        +
                      </button>
                    </span>
                  </div>
                  <div className="li total" title="What copying at this amount would have made on the picks of the last 7 days">
                    <span>Past week</span>
                    <span className="dots" />
                    <b className={week === null || Math.round(week * 100) === 0 ? "none" : week > 0 ? "w" : "l"}>{week === null ? "—" : formatUsd(week)}</b>
                  </div>
                </div>
                <button type="button" className="btn primary full" aria-busy={busy === "copy"} onClick={confirm}>
                  {copy ? "Save" : "Copy trade"}
                </button>
              </>
            )}
          </div>
        </>
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
          {row.outcome.kind === "pending" ? (
            <span className="pts none tag">PENDING</span>
          ) : (
            <span className={`pts ${tone}`}>{row.points ?? row.outcome.text}</span>
          )}
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
