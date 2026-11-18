/**
 * Collects handles as they appear and sends them together after a quiet period,
 * so a scroll burst costs one request instead of one per tweet.
 */
export function createBatcher(flush: (handles: string[]) => void, delayMs = 150) {
  let pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    add(handle: string) {
      pending.add(handle);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const handles = [...pending];
        pending = new Set();
        flush(handles);
      }, delayMs);
    },
  };
}
