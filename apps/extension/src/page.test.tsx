// @vitest-environment happy-dom
import type { BadgesResponse } from "@copayme/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBadges, type ScanResult } from "./page.js";

const scored = { score: 72, change14d: 8, tier: "scored" as const, nResolved: 30, hitRate: 0.6 };

const tweetHtml = (handle: string) => `
  <article data-testid="tweet">
    <div data-testid="User-Name">
      <div><a href="/${handle}"><span>Name</span></a></div>
      <div><a href="/${handle}"><span>@${handle}</span></a></div>
    </div>
  </article>`;

/** Text inside every badge's shadow root on the page. */
const badgeTexts = () =>
  [...document.querySelectorAll<HTMLElement>("[data-copayme=badge]")].map(
    (host) => host.shadowRoot?.querySelector(".badge")?.textContent ?? "",
  );

describe("startBadges", () => {
  let stop: () => void;
  beforeEach(() => {
    document.body.innerHTML = '<main id="timeline"></main>';
  });
  afterEach(() => stop?.());

  const timeline = () => document.getElementById("timeline")!;
  const addTweet = (handle: string) => timeline().insertAdjacentHTML("beforeend", tweetHtml(handle));

  it("badges tweets already on the page and tweets added later, in one batch", async () => {
    const lookup = vi.fn(async (handles: string[]): Promise<BadgesResponse> =>
      Object.fromEntries(handles.map((h) => [h, h === "nobody" ? null : scored])),
    );
    addTweet("alice");
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("bob");
    addTweet("nobody");

    await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8", "72▲8", ""]));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(["alice", "bob", "nobody"]);
  });

  it("looks up a handle once even when it appears in several tweets", async () => {
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ alice: scored }));
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("alice");
    addTweet("alice");

    await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8", "72▲8"]));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(["alice"]);
  });

  it("does not look up a handle again once it has been fetched", async () => {
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ alice: scored }));
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("alice");
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8"]));

    addTweet("alice"); // scrolled to another tweet by the same person
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8", "72▲8"]));
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("retries a handle on a later tweet after a failed lookup", async () => {
    const lookup = vi
      .fn<(handles: string[]) => Promise<BadgesResponse>>()
      .mockRejectedValueOnce(new Error("API down"))
      .mockResolvedValue({ alice: scored });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("alice");
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    expect(badgeTexts()).toEqual([""]);

    addTweet("alice");
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8", "72▲8"]));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("removes the badge when a tweet leaves the page", async () => {
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ alice: scored }));
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("alice");
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8"]));

    timeline().querySelector("article")!.remove();
    await vi.waitFor(() => expect(badgeTexts()).toEqual([]));
  });

  it("shows New for a short record and ignores tweets it cannot read", async () => {
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({
      rookie: { score: 63, change14d: null, tier: "new", nResolved: 3, hitRate: 0.5 },
    }));
    stop = startBadges({ lookup, delayMs: 10 });
    timeline().insertAdjacentHTML("beforeend", '<article data-testid="tweet"><div>promoted</div></article>');
    addTweet("rookie");

    await vi.waitFor(() => expect(badgeTexts()).toEqual(["New"]));
    expect(lookup).toHaveBeenCalledWith(["rookie"]);
  });

  describe("profile scans", () => {
    afterEach(() => window.history.pushState({}, "", "/"));
    const fastTimeline = { timelineWaitMs: 60, timelinePollMs: 5, timelineSettleMs: 5 };
    /** A tweet with its timestamp link, as on a profile timeline. */
    const addTweetWithId = (handle: string, id: string) =>
      timeline().insertAdjacentHTML(
        "beforeend",
        tweetHtml(handle).replace("</article>", `<a href="/${handle}/status/${id}"><time>now</time></a></article>`),
      );

    it("sends the newest tweet the profile shows, waiting for the timeline to load", async () => {
      window.history.pushState({}, "", "/espn");
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "skipped" }));
      stop = startBadges({ lookup: async () => ({}), scan, delayMs: 10, routeCheckMs: 10, ...fastTimeline });
      addTweet("nba");
      await new Promise((r) => setTimeout(r, 15));
      expect(scan).not.toHaveBeenCalled(); // still waiting for @espn's own tweets
      addTweetWithId("espn", "999999999999999999"); // e.g. an older pinned tweet
      addTweetWithId("espn", "1990000000000000002");
      addTweetWithId("nba", "1999999999999999999");
      await vi.waitFor(() => expect(scan).toHaveBeenCalledWith("espn", "1990000000000000002"));
    });

    it("scans a handle when its profile is opened, shows Scanning…, then the new score", async () => {
      window.history.pushState({}, "", "/home");
      const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ newcomer: null }));
      let finish!: (r: ScanResult) => void;
      const scan = vi.fn(() => new Promise<ScanResult>((resolve) => (finish = resolve)));
      stop = startBadges({ lookup, scan, delayMs: 10, routeCheckMs: 10, ...fastTimeline });
      addTweet("newcomer");
      await vi.waitFor(() => expect(lookup).toHaveBeenCalled());
      expect(scan).not.toHaveBeenCalled(); // /home is not a profile

      window.history.pushState({}, "", "/NewComer");
      await vi.waitFor(() => expect(scan).toHaveBeenCalledWith("newcomer", null));
      await vi.waitFor(() => expect(badgeTexts()).toEqual(["Scanning…"]));

      finish({ status: "done", badge: scored });
      await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8"]));
    });

    it("scans each profile once per visit, not on every check", async () => {
      window.history.pushState({}, "", "/alice");
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "skipped" }));
      stop = startBadges({ lookup: async () => ({}), scan, delayMs: 10, routeCheckMs: 5, ...fastTimeline });
      await new Promise((r) => setTimeout(r, 120));
      expect(scan).toHaveBeenCalledTimes(1);
      window.history.pushState({}, "", "/alice/status/1");
      window.history.pushState({}, "", "/bob");
      await vi.waitFor(() => expect(scan).toHaveBeenCalledWith("bob", null));
      expect(scan).toHaveBeenCalledTimes(2);
    });

    it("puts the old badge back when a scan doesn't finish", async () => {
      window.history.pushState({}, "", "/home");
      const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ alice: scored }));
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "timeout" }));
      stop = startBadges({ lookup, scan, delayMs: 10, routeCheckMs: 10, ...fastTimeline });
      addTweet("alice");
      await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8"]));
      window.history.pushState({}, "", "/alice");
      await vi.waitFor(() => expect(scan).toHaveBeenCalled());
      await vi.waitFor(() => expect(badgeTexts()).toEqual(["72▲8"]));
    });
  });
});
