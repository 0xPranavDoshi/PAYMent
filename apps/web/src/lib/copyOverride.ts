/** What a page knows about the viewer copying a trader. `since` is when the copy started (ISO), if known. */
export interface CopyState {
  active: boolean;
  amountUsdc: number;
  since?: string;
}

/**
 * The result of a copy action, remembered until the page's own data catches up. `basis` is the page
 * data it was set against; `viewer` is the follower id of who made it (only they ever see it).
 */
export interface CopyOverride {
  value: CopyState;
  basis: string;
  viewer: string;
}

/** A fingerprint of page copy data: an override only holds while the page still says this. */
export function copyBasis(copy: CopyState | null): string {
  return copy ? `${copy.active}|${copy.amountUsdc}` : "none";
}

/**
 * Which copy state to show. Page data wins as soon as it differs from what the override was set
 * against; an override is only ever shown to the viewer who made it, so a signed-out viewer
 * (viewerId null) or a different account never sees it. `drop` says the override should be deleted.
 */
export function resolveCopy(
  override: CopyOverride | undefined,
  fromPage: CopyState | null,
  viewerId: string | null,
): { copy: CopyState | null; drop: boolean } {
  if (!override) return { copy: fromPage, drop: false };
  if (viewerId === null || override.viewer !== viewerId || override.basis !== copyBasis(fromPage)) return { copy: fromPage, drop: true };
  return { copy: override.value, drop: false };
}
