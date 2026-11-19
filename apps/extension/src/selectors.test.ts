// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { TWEET_SELECTOR, extractHandle, findMountPoint, profileHandleFromPath } from "./selectors.js";

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
