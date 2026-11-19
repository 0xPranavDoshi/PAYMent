/**
 * Every x.com DOM assumption lives in this file. If X changes its markup and badges
 * vanish, this is the only file to fix.
 */

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';
/** The name block at the top of a profile page. Note the spelling: tweets use "User-Name", profiles "UserName". */
export const PROFILE_SELECTOR = '[data-testid="UserName"]';
/** Everything that gets a badge. */
export const BADGE_TARGET_SELECTOR = `${TWEET_SELECTOR}, ${PROFILE_SELECTOR}`;
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

/**
 * The handle of the profile being viewed, from the address (x.com/<handle>) and confirmed against the
 * header's own text, so a header that belongs to something else never gets the wrong person's badge.
 */
export function extractProfileHandle(header: Element, pathname: string): string | null {
  const handle = profileHandleFromPath(pathname);
  if (!handle) return null;
  return (header.textContent ?? "").toLowerCase().includes(`@${handle}`) ? handle : null;
}

/** What a badge belongs to: the handle, and where on the page it goes. Null if the element is not a target. */
export function resolveTarget(element: Element, pathname: string): { handle: string; anchor: Element } | null {
  if (element.matches(TWEET_SELECTOR)) {
    const handle = extractHandle(element);
    const anchor = findMountPoint(element);
    return handle && anchor ? { handle, anchor } : null;
  }
  if (element.matches(PROFILE_SELECTOR)) {
    const handle = extractProfileHandle(element, pathname);
    return handle ? { handle, anchor: element.firstElementChild ?? element } : null;
  }
  return null;
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
