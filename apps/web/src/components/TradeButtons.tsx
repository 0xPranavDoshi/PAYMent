"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { watchTrader, type ActionResult } from "@/lib/actions";
import { CheckIcon, EyeIcon } from "./Icons";

function useAction(signedIn: boolean) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  /**
   * Runs an action. `optimistic` shows the result at once (it is undone automatically if the server
   * says no), and `after` runs straight away too, so a click never waits on the round trip.
   */
  function run(action: () => Promise<ActionResult>, opts: { optimistic?: () => void; after?: () => void } = {}) {
    if (!signedIn) return router.push("/signin");
    if (busy.current) return; // a double-click must not submit twice
    busy.current = true;
    setError(null);
    opts.after?.();
    start(async () => {
      opts.optimistic?.();
      try {
        const result = await action();
        if (!result.ok) setError(result.error ?? "Something went wrong.");
      } finally {
        busy.current = false;
      }
    });
  }
  return { run, pending, error };
}

/** A secondary button that adds or removes the trader from the watchlist. */
export function WatchButton({ handle, watching, signedIn, size = "sm" }: { handle: string; watching: boolean; signedIn: boolean; size?: "sm" | "lg" }) {
  const { run, pending, error } = useAction(signedIn);
  const [isWatching, setWatching] = useOptimistic(watching);
  return (
    <span className="tb">
      <button
        type="button"
        className={`btn ${size}`}
        aria-pressed={isWatching}
        aria-busy={pending}
        title={isWatching ? "On your watchlist. Press to remove." : "Add to your watchlist"}
        onClick={() => run(() => watchTrader(handle, !isWatching), { optimistic: () => setWatching(!isWatching) })}
      >
        {isWatching ? <CheckIcon /> : <EyeIcon />}
        {isWatching ? "Watching" : "Watch"}
      </button>
      {error && <span className="err">{error}</span>}
    </span>
  );
}
