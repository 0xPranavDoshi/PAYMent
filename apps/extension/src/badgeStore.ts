import type { BadgeState } from "./badgeView.js";

/** Badge state per lowercase handle, shared by every badge on the page. */
export function createBadgeStore() {
  const states = new Map<string, BadgeState>();
  const listeners = new Map<string, Set<() => void>>();

  return {
    get: (handle: string): BadgeState => states.get(handle),
    set(handle: string, state: BadgeState) {
      states.set(handle, state);
      listeners.get(handle)?.forEach((notify) => notify());
    },
    subscribe(handle: string, notify: () => void): () => void {
      let set = listeners.get(handle);
      if (!set) listeners.set(handle, (set = new Set()));
      set.add(notify);
      return () => {
        set.delete(notify);
      };
    },
  };
}

export type BadgeStore = ReturnType<typeof createBadgeStore>;
