/**
 * Every x.com DOM assumption lives in this file. If X changes its markup and badges
 * vanish, this is the only file to fix.
 */

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';
const USER_NAME_SELECTOR = '[data-testid="User-Name"]';

/** First path segment of X's own pages, which are not handles. */
const RESERVED_PATHS = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "search",
  "settings",
  "i",
  "compose",
  "intent",
  "hashtag",
  "login",
  "logout",
  "signup",
  "tos",
  "privacy",
  "jobs",
]);

/** A link to a profile: exactly one path segment, like /elonmusk (not /elonmusk/status/1). */
const PROFILE_HREF = /^\/([A-Za-z0-9_]{1,15})\/?$/;

/**
 * The author's handle (lowercase, no @) for a tweet, or null if it can't be found.
 * Reads the first User-Name block, which is the outer tweet's author even when
 * the tweet quotes another one.
 */
export function extractHandle(article: Element): string | null {
  const userName = article.querySelector(USER_NAME_SELECTOR);
  if (!userName) return null;

  const candidates: { handle: string; showsAt: boolean }[] = [];
  for (const link of userName.querySelectorAll("a[href]")) {
    const match = PROFILE_HREF.exec(link.getAttribute("href") ?? "");
    const handle = match?.[1];
    if (!handle || RESERVED_PATHS.has(handle.toLowerCase())) continue;
    candidates.push({ handle, showsAt: (link.textContent ?? "").trim().startsWith("@") });
  }
  // Prefer the link whose text is the @handle; fall back to the display-name link,
  // which points at the same profile.
  const best = candidates.find((c) => c.showsAt) ?? candidates[0];
  return best ? best.handle.toLowerCase() : null;
}

/** The element a badge is appended to: the display-name row, so it sits next to the name. */
export function findMountPoint(article: Element): Element | null {
  const userName = article.querySelector(USER_NAME_SELECTOR);
  if (!userName) return null;
  return userName.firstElementChild ?? userName;
}

/** Tabs of a profile page (x.com/<handle>/<tab>); any other sub-path, like /status/1, isn't a profile. */
const PROFILE_TABS = new Set(["with_replies", "media", "likes", "highlights", "articles", "superfollows"]);
const PROFILE_PATH = /^\/([A-Za-z0-9_]{1,15})(?:\/([a-z_]+))?\/?$/;

/**
 * The handle whose profile page this path is (lowercase, no @), or null: x.com/elonmusk and its tabs
 * count; X's own pages (/home, /explore, ...) and sub-pages like /elonmusk/status/1 don't.
 */
export function profileHandleFromPath(pathname: string): string | null {
  const match = PROFILE_PATH.exec(pathname);
  const handle = match?.[1];
  if (!handle || RESERVED_PATHS.has(handle.toLowerCase())) return null;
  const tab = match?.[2];
  if (tab && !PROFILE_TABS.has(tab)) return null;
  return handle.toLowerCase();
}
