// Short-lived server-side store for the X OAuth PKCE verifier, keyed by the OAuth
// `state` (which round-trips through X's redirect URL). This avoids relying on
// cookies surviving the cross-site redirect back from x.com — some browsers
// (e.g. Brave with shields) drop them, which breaks the flow.
//
// Single-process only (fine for dev / a single server). For a multi-instance
// deployment, back this with a shared store (Redis) instead.

interface Entry {
  verifier: string;
  expires: number;
}

const g = globalThis as unknown as { __xOauthStore?: Map<string, Entry> };
const store = (g.__xOauthStore ??= new Map<string, Entry>());

const TTL_MS = 10 * 60 * 1000;

export function saveOauth(state: string, verifier: string): void {
  const now = Date.now();
  for (const [k, v] of store) if (v.expires < now) store.delete(k); // opportunistic cleanup
  store.set(state, { verifier, expires: now + TTL_MS });
}

/** Returns the verifier and removes the entry (one-time use). null if unknown/expired. */
export function takeOauth(state: string): string | null {
  const entry = store.get(state);
  if (!entry) return null;
  store.delete(state);
  return entry.expires < Date.now() ? null : entry.verifier;
}
