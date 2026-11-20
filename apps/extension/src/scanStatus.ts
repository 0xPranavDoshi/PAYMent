import type { Badge } from "@copayme/shared";

/**
 * What the floating scan card shows. A scan takes minutes the first time, so the page says plainly that
 * it is running, for how long, and how it ended.
 */
export type ScanStatus =
  | { phase: "scanning"; handle: string; startedAt: number }
  /** Finished with a score (or a New badge). */
  | { phase: "done"; handle: string; badge: Badge }
  /** Finished, but no sports picks were found in their recent posts. */
  | { phase: "empty"; handle: string }
  /** Did not finish; the user can try again. */
  | { phase: "failed"; handle: string }
  /** Asked for too recently to ask again. */
  | { phase: "recent"; handle: string }
  /** The user pressed Stop. */
  | { phase: "stopped"; handle: string };

/** The one scan status shown on the page (null: nothing to show). */
export function createScanStatusStore() {
  let current: ScanStatus | null = null;
  const listeners = new Set<() => void>();
  return {
    get: (): ScanStatus | null => current,
    set(next: ScanStatus | null) {
      current = next;
      listeners.forEach((notify) => notify());
    },
    subscribe(notify: () => void): () => void {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
}

export type ScanStatusStore = ReturnType<typeof createScanStatusStore>;

/** "0:07", "2:41": elapsed time the way a stopwatch shows it. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
