import { changeArrow, type Badge, type ChangeArrow } from "@copayme/shared";

/** undefined = not fetched yet, null = we have no data on this handle. */
export type BadgeState = Badge | null | undefined;

export interface BadgeView {
  kind: "new" | "scored";
  /** "New" or the score. */
  text: string;
  arrow: ChangeArrow | null;
  /** Hover text. */
  title: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What to draw for a handle, or null to draw nothing (still loading, or unknown). */
export function badgeView(state: BadgeState): BadgeView | null {
  if (!state) return null;

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
