/**
 * Chrome keeps running a content script after its extension is reloaded or updated, but cuts its
 * connection to the extension. From then on every message fails with "Extension context
 * invalidated". The old copy cannot recover; the page has to be refreshed to get the new one.
 */
export function isContextInvalidated(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /extension context invalidated/i.test(message);
}

/** What to tell the user when that happens. */
export const REFRESH_MESSAGE = "coPAYMe was updated. Refresh this page to keep using it.";
