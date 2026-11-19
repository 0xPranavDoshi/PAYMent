import { changeArrow, type Badge, type ChangeArrow } from "@copayme/shared";

/**
 * undefined = not fetched yet, null = we have no data on this handle, "scanning" = reading their posts
 * now, "empty" = scanned and no sports picks were found, "failed" = the scan did not finish.
 */
export type BadgeState = Badge | null | undefined | "scanning" | "empty" | "failed";

export interface BadgeView {
  kind: "new" | "scored" | "scanning" | "offer" | "empty" | "failed";
  /** "New" or the score. */
  text: string;
  arrow: ChangeArrow | null;
  /** Hover text. */
  title: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * What to draw for a handle, or null to draw nothing (still loading, or unknown). On a profile page
 * (`canScan`), a handle we know nothing about gets a "Scan picks" button instead of nothing: scans cost
 * money and only make sense for accounts that post sports picks, so the user chooses which to scan.
 */
export function badgeView(state: BadgeState, opts: { canScan?: boolean } = {}): BadgeView | null {
  if (state === null && opts.canScan) {
    return { kind: "offer", text: "Scan picks", arrow: null, title: "Read this account's recent posts and score its picks" };
  }
  if (!state) return null;
  if (state === "scanning") {
    return { kind: "scanning", text: "Scanning…", arrow: null, title: "Reading this account's recent picks…" };
  }
  if (state === "empty") {
    return { kind: "empty", text: "No picks found", arrow: null, title: "We read their recent posts and found no sports picks on markets we track." };
  }
  if (state === "failed") {
    return { kind: "failed", text: "Scan failed · Retry", arrow: null, title: "The scan didn't finish. Click to try again." };
  }

  if (state.tier === "new") {
    return {
      kind: "new",
      text: "New",
      arrow: null,
      title: `${plural(state.nResolved, "resolved pick")} so far. A score appears at 5.`,
    };
  }

  const hit = state.hitRate === null ? "" : ` · ${Math.round(state.hitRate * 100)}% hit rate`;
  return {
    kind: "scored",
    text: String(state.score),
    arrow: changeArrow(state.change14d),
    title: `Score ${state.score} of 100 · ${plural(state.nResolved, "resolved pick")}${hit}`,
  };
}
