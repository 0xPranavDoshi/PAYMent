// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  TWEET_SELECTOR,
  extractHandle,
  extractTweetId,
  findMountPoint,
  newestTweetIdBy,
  profileHandleFromPath,
} from "./selectors.js";

/** A tweet as X renders it: author block, then the timestamp linking to the tweet's own page. */
const tweetWithId = (author: string, id: string, extra = "") => `
  <article data-testid="tweet">
    ${extra}
    <div data-testid="User-Name">
      <div><a href="/${author}"><span>${author}</span></a></div>
      <div><a href="/${author}"><span>@${author}</span></a><a href="/${author}/status/${id}"><time datetime="2026-11-18T12:00:00.000Z">Nov 18</time></a></div>
    </div>
  </article>`;

describe("extractTweetId", () => {
  const article = (html: string) => {
    document.body.innerHTML = html;
    return document.querySelector(TWEET_SELECTOR)!;
  };

  it("reads the id from the link around the tweet's own timestamp", () => {
    expect(extractTweetId(article(tweetWithId("espn", "1990000000000000001")))).toBe("1990000000000000001");
  });

  it("takes the outer tweet's id, not a quoted tweet's", () => {
    const quoted = tweetWithId("espn", "1990000000000000005").replace(
      "</article>",
      '<div role="link"><a href="/nba/status/1980000000000000000"><time>Nov 1</time></a></div></article>',
    );
    expect(extractTweetId(article(quoted))).toBe("1990000000000000005");
  });

  it("is null without a status link", () => {
    expect(extractTweetId(article('<article data-testid="tweet"><time>now</time></article>'))).toBeNull();
    expect(extractTweetId(article('<article data-testid="tweet"><a href="/espn"><time>now</time></a></article>'))).toBeNull();
  });
});

describe("newestTweetIdBy", () => {
  it("is the largest id by that handle: a pinned older tweet first doesn't matter, nor do ids of different length", () => {
    document.body.innerHTML =
      tweetWithId("espn", "999999999999999999", '<div data-testid="socialContext">Pinned</div>') +
      tweetWithId("ESPN", "1990000000000000002") +
      tweetWithId("espn", "1990000000000000001");
    expect(newestTweetIdBy(document, "espn")).toBe("1990000000000000002");
  });

  it("ignores retweets and other people's tweets", () => {
    document.body.innerHTML =
      tweetWithId("nba", "1999999999999999999", '<div data-testid="socialContext">ESPN reposted</div>') +
      tweetWithId("espn", "1990000000000000001");
    expect(newestTweetIdBy(document, "espn")).toBe("1990000000000000001");
  });

  it("is null when none of the handle's tweets are on the page", () => {
    document.body.innerHTML = tweetWithId("nba", "1990000000000000001");
    expect(newestTweetIdBy(document, "espn")).toBeNull();
  });
});

describe("profileHandleFromPath", () => {
  it("returns the handle for a profile page and its tabs, lowercased", () => {
    expect(profileHandleFromPath("/ActionNetworkHQ")).toBe("actionnetworkhq");
    expect(profileHandleFromPath("/espn/")).toBe("espn");
    expect(profileHandleFromPath("/espn/with_replies")).toBe("espn");
    expect(profileHandleFromPath("/espn/media")).toBe("espn");
  });

  it("ignores X's own pages and non-profile sub-pages", () => {
    for (const path of ["/", "/home", "/explore", "/notifications", "/messages", "/search", "/i/flow/login", "/login", "/tos", "/settings/account"]) {
      expect(profileHandleFromPath(path)).toBeNull();
    }
    expect(profileHandleFromPath("/espn/status/123")).toBeNull();
    expect(profileHandleFromPath("/espn/followers")).toBeNull();
    expect(profileHandleFromPath("/this_handle_is_way_too_long")).toBeNull();
  });
});

/** Trimmed copy of how x.com marks up a tweet header. */
function tweet(inner: string): Element {
  document.body.innerHTML = `<article data-testid="tweet">${inner}</article>`;
  return document.querySelector(TWEET_SELECTOR)!;
}

const header = (handle: string) => `
  <div data-testid="User-Name">
    <div><a href="/${handle}"><span>Display Name</span></a></div>
    <div>
      <a href="/${handle}"><span>@${handle}</span></a>
      <span>·</span>
      <a href="/${handle}/status/1234567890"><time>2h</time></a>
    </div>
  </div>`;

describe("extractHandle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("reads the handle from the tweet header, lowercased", () => {
    expect(extractHandle(tweet(header("ElonMusk")))).toBe("elonmusk");
  });

  it("ignores the status link in the header", () => {
    const article = tweet(`
      <div data-testid="User-Name">
        <div><a href="/alice/status/9"><span>x</span></a></div>
      </div>`);
    expect(extractHandle(article)).toBeNull();
  });

  it("falls back to the display-name link when no @handle link exists", () => {
    const article = tweet(`
      <div data-testid="User-Name">
        <div><a href="/some_user"><span>Display Name</span></a></div>
      </div>`);
    expect(extractHandle(article)).toBe("some_user");
  });

  it("skips X's own pages", () => {
    const article = tweet(`
      <div data-testid="User-Name">
        <div><a href="/home"><span>@home</span></a></div>
      </div>`);
    expect(extractHandle(article)).toBeNull();
  });

  it("uses the outer author when the tweet quotes another one", () => {
    const article = tweet(`
      ${header("outer")}
      <div role="link">${header("quoted")}</div>`);
    expect(extractHandle(article)).toBe("outer");
  });

  it("returns null for a tweet without a header", () => {
    expect(extractHandle(tweet("<div>ad</div>"))).toBeNull();
  });
});

describe("findMountPoint", () => {
  it("mounts in the display-name row", () => {
    const article = tweet(header("alice"));
    const row = findMountPoint(article)!;
    expect(row.querySelector("span")?.textContent).toBe("Display Name");
    expect(row.parentElement?.getAttribute("data-testid")).toBe("User-Name");
  });
});
