/** What a page knows about the viewer copying a trader. `since` is when the copy started (ISO), if known. */
export interface CopyState {
  active: boolean;
  amountUsdc: number;
  since?: string;
}

/** The result of a copy action, remembered until the page's own data catches up. `basis` is the page data it was set against. */
export interface CopyOverride {
  value: CopyState;
  basis: string;
}

/** A fingerprint of page copy data: an override only holds while the page still says this. */
export function copyBasis(copy: CopyState | null): string {
  return copy ? `${copy.active}|${copy.amountUsdc}` : "none";
}

/**
 * Which copy state to show. Page data wins as soon as it differs from what the override was set
 * against, and a signed-out viewer never sees an override. `drop` says the override is stale and
 * should be deleted.
 */
export function resolveCopy(
  override: CopyOverride | undefined,
  fromPage: CopyState | null,
  signedIn: boolean,
): { copy: CopyState | null; drop: boolean } {
  if (!override) return { copy: fromPage, drop: false };
  if (!signedIn || override.basis !== copyBasis(fromPage)) return { copy: fromPage, drop: true };
  return { copy: override.value, drop: false };
}
