"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type KeyboardEvent } from "react";
import {
  COPY_STEPS,
  DEFAULT_COPY_AMOUNT,
  pastWeekEarnings,
  recentSettled,
  snapToStep,
  stepAmount,
  type CallEntry,
} from "@copayme/shared";
import { getTicketCalls, startCopy, stopCopy, type ActionResult } from "@/lib/actions";
import { formatCents, formatUsd, shortDate, tone } from "@/lib/format";
import { copyBasis, resolveCopy, type CopyOverride, type CopyState } from "@/lib/copyOverride";

export type { CopyState };

/** "$10", or "$2.50" for amounts with cents. */
const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : formatUsd(n, false));

// ── Copy state shared by every toggle and ticket for a handle ────────────────
// The toggle and its ticket can be rendered apart (the leaderboard puts the ticket in the next row),
// so the result of a copy action is kept here, keyed by handle, until the page's own data catches up.
// Page data wins as soon as it differs from what the override was set against (see resolveCopy),
// stale entries are deleted, and the whole store is cleared whenever the viewer is signed out.

const overrides = new Map<string, CopyOverride>();
const listeners = new Set<() => void>();
const keyOf = (handle: string) => handle.toLowerCase();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setOverride(handle: string, value: CopyOverride | undefined) {
  if (value) overrides.set(keyOf(handle), value);
  else overrides.delete(keyOf(handle));
  for (const l of listeners) l();
}

function clearOverrides() {
  if (overrides.size === 0) return;
  overrides.clear();
  for (const l of listeners) l();
}

function useCopyState(handle: string, fromPage: CopyState | null, signedIn: boolean): CopyState | null {
  const override = useSyncExternalStore(subscribe, () => overrides.get(keyOf(handle)), () => undefined);
  const { copy, drop } = resolveCopy(override, fromPage, signedIn);
  useEffect(() => {
    if (!signedIn) clearOverrides();
    else if (drop && overrides.get(keyOf(handle)) === override) setOverride(handle, undefined);
  }, [signedIn, drop, override, handle]);
  return copy;
}

// ── Picks, loaded once per handle when a ticket first opens ──────────────────

const callsCache = new Map<string, Promise<CallEntry[]>>();

function useTicketCalls(handle: string): CallEntry[] | null {
  const [calls, setCalls] = useState<CallEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    const key = keyOf(handle);
    let request = callsCache.get(key);
    if (!request) {
      request = getTicketCalls(handle).catch(() => []);
      callsCache.set(key, request);
    }
    request.then((c) => live && setCalls(c));
    return () => {
      live = false;
    };
  }, [handle]);
  return calls;
}

// ── The ticket ───────────────────────────────────────────────────────────────

function postedAt(c: CallEntry): string {
  if (c.oddsAtCall === null) return "—";
  const price = `${Math.round(c.oddsAtCall * 100)}¢`;
  return c.side ? `${c.side.toUpperCase()} ${price}` : price;
}

export default function CopyTicket({
  handle,
  copy: copyFromPage,
  signedIn,
  nPicks,
  variant,
  onClose,
}: {
  handle: string;
  copy: CopyState | null;
  signedIn: boolean;
  nPicks: number;
  variant: "row" | "card";
  onClose?: () => void;
}) {
  const copy = useCopyState(handle, copyFromPage, signedIn);
  const copying = copy?.active === true;
  const calls = useTicketCalls(handle);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(() => (copying ? snapToStep(copy!.amountUsdc) : DEFAULT_COPY_AMOUNT));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  /** Shows `next` at once, runs the action, and puts the old state back if the server says no. */
  function run(next: CopyState, action: () => Promise<ActionResult>) {
    if (busy.current) return; // a double-click must not submit twice
    busy.current = true;
    const before = overrides.get(keyOf(handle));
    setError(null);
    setOverride(handle, { value: next, basis: copyBasis(copyFromPage) });
    setEditing(false);
    start(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setOverride(handle, before);
          setError(result.error ?? "Something went wrong.");
        }
      } catch {
        setOverride(handle, before);
        setError("Something went wrong.");
      } finally {
        busy.current = false;
      }
    });
  }

  const confirm = () =>
    run({ active: true, amountUsdc: amount, since: copy?.since ?? new Date().toISOString() }, () => startCopy(handle, amount));
  const stop = () => run({ ...copy!, active: false }, () => stopCopy(handle));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && onClose) onClose();
  };

  const recent = calls ? recentSettled(calls) : [];
  const week = calls ? pastWeekEarnings(calls, amount, new Date()) : null;
  const showStamp = copying && !editing;

  return (
    <div className={`tk-wrap ${variant === "card" ? "tk-card" : "tk-row"}`} onKeyDown={onKeyDown}>
      <div className="ticket" role="group" aria-label={`Copy trade @${handle}`}>
        <div className="tk-main">
          <div className="tk-h">
            RECENT PICKS <small>price when posted · result per $1</small>
          </div>
          {calls === null ? (
            <p className="tk-note">Loading picks…</p>
          ) : recent.length === 0 ? (
            <p className="tk-note">No settled picks yet.</p>
          ) : (
            <table className="tk-tbl">
              <thead>
                <tr><th>MARKET</th><th>POSTED AT</th><th>RESULT</th><th>EDGE</th></tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.callId}>
                    <td title={`${c.pickLabel} · ${c.eventName}`}>{c.pickLabel}</td>
                    <td>{postedAt(c)}</td>
                    <td>{c.result === "won" ? "Won" : "Lost"}</td>
                    <td className={c.points === null ? "muted" : tone(c.points)}>{c.points === null ? "—" : formatCents(c.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Link href={`/traders/${encodeURIComponent(handle)}`} className="tk-foot">
            {nPicks > 0 ? `See all ${nPicks} pick${nPicks === 1 ? "" : "s"} →` : "See all picks →"}
          </Link>
        </div>

        <div className="stub">
          {showStamp ? (
            <>
              <div className="stamp">
                Copying @{handle}
                <small>
                  {usd(copy!.amountUsdc)} PER PICK{copy!.since ? ` · SINCE ${shortDate(copy!.since).toUpperCase()}` : ""}
                </small>
              </div>
              <div className="tk-row2">
                <button type="button" className="btn sm" onClick={() => {
                  setAmount(snapToStep(copy!.amountUsdc));
                  setError(null);
                  setEditing(true);
                }}>
                  Change amount
                </button>
                <button type="button" className="btn sm tk-danger" aria-busy={pending} onClick={stop}>
                  Stop copying
                </button>
              </div>
              <p className="tk-fine">
                See every copied pick in <Link href="/portfolio">Portfolio</Link>.
              </p>
            </>
          ) : (
            <>
              <div className="tk-h">
                COPY TRADE <small>@{handle}</small>
              </div>
              <div className="slip">
                <div className="li">
                  <span>Amount per pick</span>
                  <span className="dots" />
                  <span className="stp">
                    <button type="button" aria-label="Lower amount per pick" disabled={amount <= COPY_STEPS[0]!} onClick={() => setAmount((a) => stepAmount(a, -1))}>−</button>
                    <b aria-live="polite">{usd(amount)}</b>
                    <button type="button" aria-label="Raise amount per pick" disabled={amount >= COPY_STEPS[COPY_STEPS.length - 1]!} onClick={() => setAmount((a) => stepAmount(a, 1))}>+</button>
                  </span>
                </div>
                <div className="li total">
                  <span>Past week</span>
                  <span className="dots" />
                  <b className={week === null ? "muted" : tone(week)}>{week === null ? "—" : formatUsd(week)}</b>
                </div>
              </div>
              {signedIn ? (
                <button type="button" className="btn primary xl" aria-busy={pending} onClick={confirm}>
                  {copying ? "Save" : "Copy trade"}
                </button>
              ) : (
                <Link href="/signin" className="btn primary xl">Sign in to copy</Link>
              )}
            </>
          )}
          {error && <p className="tk-err" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}

// ── The button that opens it ─────────────────────────────────────────────────

export function CopyTradeToggle({
  handle,
  copy: copyFromPage,
  signedIn,
  nPicks,
  primary = false,
  size = "sm",
  ticketPlacement,
  open: openProp,
  onOpenChange,
}: {
  handle: string;
  copy: CopyState | null;
  signedIn: boolean;
  nPicks: number;
  primary?: boolean;
  /** Button size; tables use "sm", the profile header "lg". */
  size?: "sm" | "lg";
  /** "inline": the toggle renders the ticket right after itself. "below": the caller renders it, using onOpenChange. */
  ticketPlacement: "below" | "inline";
  /** Set it to control the open state from the caller (e.g. one open ticket per table). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const copy = useCopyState(handle, copyFromPage, signedIn);
  const copying = copy?.active === true;
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };

  const cls = ["btn", size, copying ? "dark" : primary ? "primary" : "", open ? "pressed" : ""].filter(Boolean).join(" ");
  return (
    <>
      <button type="button" className={cls} aria-expanded={open} onClick={() => setOpen(!open)}>
        {copying ? `✓ Copying · ${usd(copy!.amountUsdc)}` : open ? "Copy trade ▴" : "Copy trade"}
      </button>
      {ticketPlacement === "inline" && open && (
        <CopyTicket handle={handle} copy={copyFromPage} signedIn={signedIn} nPicks={nPicks} variant="card" onClose={() => setOpen(false)} />
      )}
    </>
  );
}
