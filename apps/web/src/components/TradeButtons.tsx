"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { startCopy, stopCopy, watchTrader, type ActionResult } from "@/lib/actions";
import { CheckIcon, ChevronIcon, CopyIcon, EyeIcon } from "./Icons";

const PRESETS = [5, 10, 25];

const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

/** A positive dollar amount with at most two decimals, or null. */
function parseAmount(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value > 0 ? value : null;
}

function useAction(signedIn: boolean) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    if (!signedIn) return router.push("/signin");
    if (busy.current) return; // a double-click must not submit twice
    busy.current = true;
    setError(null);
    start(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(result.error ?? "Something went wrong.");
        else after?.();
      } finally {
        busy.current = false;
      }
    });
  }
  return { run, pending, error };
}

export function WatchButton({ handle, watching, signedIn }: { handle: string; watching: boolean; signedIn: boolean }) {
  const { run, pending, error } = useAction(signedIn);
  return (
    <span className="tb">
      <button
        type="button"
        className={`btn sm ${watching ? "on" : ""}`}
        aria-pressed={watching}
        aria-busy={pending}
        title={watching ? "On your watchlist. Press to remove." : "Add to your watchlist"}
        onClick={() => run(() => watchTrader(handle, !watching))}
      >
        {watching ? <CheckIcon /> : <EyeIcon />}
        {watching ? "Watching" : "Watch"}
      </button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}

export function CopyButton({
  handle,
  copy,
  signedIn,
  paper,
}: {
  handle: string;
  copy: { active: boolean; amountUsdc: number } | null;
  signedIn: boolean;
  paper: boolean;
}) {
  const { run, pending, error } = useAction(signedIn);
  const copying = copy?.active === true;
  const [panel, setPanel] = useState<"amount" | "menu" | null>(null);
  const [preset, setPreset] = useState<number | "custom">(10);
  const [custom, setCustom] = useState("");
  const amount = preset === "custom" ? parseAmount(custom) : preset;
  const invalid = preset === "custom" && custom.trim() !== "" && amount === null;

  function openAmount() {
    const current = copying ? copy!.amountUsdc : 10;
    if (PRESETS.includes(current)) {
      setPreset(current);
      setCustom("");
    } else {
      setPreset("custom");
      setCustom(String(current));
    }
    setPanel("amount");
  }

  return (
    <span className="tb">
      <button
        type="button"
        className={`btn sm primary ${copying ? "on" : ""}`}
        aria-pressed={copying}
        aria-expanded={panel !== null}
        aria-busy={pending}
        onClick={() => {
          if (!signedIn) return run(async () => ({ ok: true }));
          if (copying) setPanel((p) => (p === "menu" ? null : "menu"));
          else if (panel === "amount") setPanel(null);
          else openAmount();
        }}
      >
        {copying ? <CheckIcon /> : <CopyIcon />}
        {copying ? `Copying · ${usd(copy!.amountUsdc)}` : "Copy trade"}
        {copying && <ChevronIcon />}
      </button>

      {panel === "menu" && (
        <div className="pop menu" role="menu">
          <button type="button" role="menuitem" onClick={openAmount}>Change amount</button>
          <button type="button" role="menuitem" className="danger" onClick={() => run(() => stopCopy(handle), () => setPanel(null))}>
            Stop copying
          </button>
          <p className="fine">Stopping keeps picks that are already copied open.</p>
        </div>
      )}

      {panel === "amount" && (
        <div className="pop" role="group" aria-label="Copy trade amount">
          <p>
            {paper ? (
              <><b>Simulated.</b> We&apos;ll place a paper trade of {amount ? usd(amount) : "your amount"} on each new pick from @{handle}. No real money moves.</>
            ) : (
              <><b>Real orders.</b> We&apos;ll buy {amount ? usd(amount) : "your amount"} on each new pick from @{handle}.</>
            )}
          </p>
          <div className="chips">
            {PRESETS.map((v) => (
              <button key={v} type="button" className="chip" aria-pressed={preset === v} onClick={() => setPreset(v)}>${v}</button>
            ))}
            <label className={`amt ${preset === "custom" ? "active" : ""} ${invalid ? "bad" : ""}`}>
              <span>$</span>
              <input
                inputMode="decimal"
                placeholder="Other"
                aria-label="Other amount in dollars"
                value={custom}
                onFocus={() => setPreset("custom")}
                onChange={(e) => {
                  setPreset("custom");
                  setCustom(e.target.value);
                }}
              />
            </label>
          </div>
          {invalid && <p className="fine bad">Enter an amount above $0 with at most two decimals.</p>}
          <div className="row2">
            <button
              type="button"
              className="btn sm primary"
              disabled={amount === null || pending}
              onClick={() => amount !== null && run(() => startCopy(handle, amount), () => setPanel(null))}
            >
              {copying ? "Update amount" : "Start copying"}
            </button>
            <button type="button" className="btn sm" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <span className="err">{error}</span>}
    </span>
  );
}
