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
    (host) => host.shadowRoot?.querySelector(".pill")?.textContent ?? "",
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

    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8", "SCORE72▲8", ""]));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(["alice", "bob", "nobody"]);
  });

  it("looks up a handle once even when it appears in several tweets", async () => {
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ alice: scored }));
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("alice");
    addTweet("alice");

    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8", "SCORE72▲8"]));
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(["alice"]);
  });

  it("does not look up a handle again once it has been fetched", async () => {
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ alice: scored }));
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("alice");
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8"]));

    addTweet("alice"); // scrolled to another tweet by the same person
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8", "SCORE72▲8"]));
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
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8", "SCORE72▲8"]));
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("removes the badge when a tweet leaves the page", async () => {
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ alice: scored }));
    stop = startBadges({ lookup, delayMs: 10 });
    addTweet("alice");
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8"]));

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

    await vi.waitFor(() => expect(badgeTexts()).toEqual(["NEW"]));
    expect(lookup).toHaveBeenCalledWith(["rookie"]);
  });

  describe("profile scans", () => {
    const fastTimeline = { timelineWaitMs: 60, timelinePollMs: 5, timelineSettleMs: 5 };
    const setUrl = (path: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`https://x.com${path}`);
    afterEach(() => setUrl("/"));

    const header = (handle: string) => `
      <div data-testid="UserName">
        <div><span>Dana Whitfield</span></div>
        <div><span>@${handle}</span></div>
      </div>`;
    /** A tweet with its timestamp link, as on a profile timeline. */
    const addTweetWithId = (handle: string, id: string) =>
      timeline().insertAdjacentHTML("beforeend", tweetHtml(handle).replace("</article>", `<a href="/${handle}/status/${id}"><time>now</time></a></article>`));

    const pill = () => document.querySelector("[data-copayme=badge]")?.shadowRoot?.querySelector<HTMLButtonElement>(".pill") ?? null;
    const pillText = () => pill()?.textContent ?? null;
    const card = () => document.querySelector("[data-copayme=scan]")?.shadowRoot?.querySelector<HTMLElement>(".scan") ?? null;
    const cardText = () => card()?.textContent ?? null;
    const open = (handle: string) => {
      setUrl(`/${handle}`);
      document.body.innerHTML = `<main id="timeline">${header(handle)}</main>`;
    };
    const known = async (): Promise<BadgesResponse> => ({ dana: null });

    it("does not scan by itself: opening a profile we know nothing about offers a Scan picks button", async () => {
      open("dana");
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "done", badge: scored }));
      stop = startBadges({ lookup: known, scan, delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));
      await new Promise((r) => setTimeout(r, 40));
      expect(scan).not.toHaveBeenCalled();
      expect(card()).toBeNull(); // nothing running, so no card
    });

    it("offers no button when scanning is not available, or on a handle that already has a score", async () => {
      open("dana");
      stop = startBadges({ lookup: known, delayMs: 10 });
      await new Promise((r) => setTimeout(r, 40));
      expect(pill()).toBeNull();
      stop();
      stop = startBadges({ lookup: async () => ({ dana: scored }), scan: vi.fn(), delayMs: 10 });
      await vi.waitFor(() => expect(pillText()).toBe("SCORE72▲8"));
    });

    it("offers Scan picks on tweets too, and scans straight away from the feed (no profile timeline to wait for)", async () => {
      setUrl("/home");
      document.body.innerHTML = '<main id="timeline"></main>';
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "done", badge: scored }));
      stop = startBadges({ lookup: async () => ({ alice: null, bob: scored }), scan, delayMs: 10, timelineWaitMs: 5_000 });
      addTweet("alice");
      addTweet("bob");
      await vi.waitFor(() => expect(badgeTexts()).toEqual(["Scan picks", "SCORE72▲8"]));
      const started = Date.now();
      document.querySelector("[data-copayme=badge]")!.shadowRoot!.querySelector<HTMLButtonElement>(".pill")!.click();
      await vi.waitFor(() => expect(scan).toHaveBeenCalledWith("alice", null));
      expect(Date.now() - started).toBeLessThan(1_000); // not the 5 s timeline wait
      await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8", "SCORE72▲8"]));
    });

    it("shows the new person's badge when X reuses the profile header for another profile", async () => {
      setUrl("/pickswise");
      document.body.innerHTML = `<main id="timeline">${header("pickswise")}</main>`;
      const lookup = vi.fn(async (handles: string[]): Promise<BadgesResponse> =>
        Object.fromEntries(handles.map((h) => [h, h === "pickswise" ? scored : null])),
      );
      stop = startBadges({ lookup, scan: vi.fn(), delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("SCORE72▲8"));

      // Clicking a "who to follow" suggestion: the URL changes and X rewrites the same header element in place.
      setUrl("/the_bmatt");
      const headerEl = document.querySelector('[data-testid="UserName"]')!;
      headerEl.innerHTML = '<div><span>BMatthews</span></div><div><span>@the_bmatt</span></div>';

      await vi.waitFor(() => expect(pillText()).toBe("Scan picks")); // not pickswise's 72
      expect(lookup).toHaveBeenLastCalledWith(["the_bmatt"]);
      expect(document.querySelectorAll("[data-copayme=badge]")).toHaveLength(1); // no leftover badge
    });

    it("notices a profile change even when only the address changed first", async () => {
      setUrl("/pickswise");
      document.body.innerHTML = `<main id="timeline">${header("pickswise")}</main>`;
      stop = startBadges({ lookup: async (hs) => Object.fromEntries(hs.map((h) => [h, h === "pickswise" ? scored : null])), scan: vi.fn(), delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("SCORE72▲8"));
      document.querySelector('[data-testid="UserName"]')!.innerHTML = '<div><span>Other</span></div><div><span>@other</span></div>';
      setUrl("/other");
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"), { timeout: 2_000 });
    });

    it("scanning shows a running pill with a stopwatch and a card that says what is happening", async () => {
      open("dana");
      let finish!: (r: ScanResult) => void;
      const scan = vi.fn(() => new Promise<ScanResult>((resolve) => (finish = resolve)));
      stop = startBadges({ lookup: known, scan, delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));

      pill()!.click();
      await vi.waitFor(() => expect(pillText()).toMatch(/^Scanning… ?0:0\d$/));
      expect(cardText()).toContain("Scanning @dana");
      expect(cardText()).toContain("Reading their recent posts");
      expect(cardText()).toMatch(/0:0\d/); // the stopwatch
      expect(card()!.querySelector(".bar")).not.toBeNull(); // the moving bar
      await vi.waitFor(() => expect(scan).toHaveBeenCalledWith("dana", null)); // after the timeline wait

      finish({ status: "done", badge: scored });
      await vi.waitFor(() => expect(pillText()).toBe("SCORE72▲8"));
      expect(cardText()).toContain("@dana scanned");
      expect(cardText()).toContain("Score 72 · 30 settled picks.");
    });

    it("sends the newest tweet the profile shows, waiting for the timeline to load", async () => {
      open("dana");
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "skipped" }));
      stop = startBadges({ lookup: known, scan, delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));
      pill()!.click();
      addTweetWithId("dana", "999999999999999999"); // e.g. an older pinned tweet
      addTweetWithId("dana", "1990000000000000002");
      addTweetWithId("nba", "1999999999999999999");
      await vi.waitFor(() => expect(scan).toHaveBeenCalledWith("dana", "1990000000000000002"));
    });

    it("says so when no sports picks were found, and keeps saying so on the profile", async () => {
      open("dana");
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "done", badge: null }));
      stop = startBadges({ lookup: known, scan, delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));
      pill()!.click();
      await vi.waitFor(() => expect(pillText()).toBe("No picks found"));
      expect(cardText()).toContain("found no sports picks on markets we track");
    });

    it("says a scan did not finish and lets the user try again from the card or the pill", async () => {
      open("dana");
      const scan = vi.fn<() => Promise<ScanResult>>().mockResolvedValueOnce({ status: "timeout" }).mockResolvedValueOnce({ status: "failed" }).mockResolvedValue({ status: "done", badge: scored });
      stop = startBadges({ lookup: known, scan, delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));
      pill()!.click();
      await vi.waitFor(() => expect(pillText()).toBe("Scan failed · Retry"));
      expect(cardText()).toContain("Scan didn't finish");

      pill()!.click(); // retry from the pill
      await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(pillText()).toBe("Scan failed · Retry"));

      card()!.querySelector<HTMLButtonElement>(".again")!.click(); // retry from the card
      await vi.waitFor(() => expect(pillText()).toBe("SCORE72▲8"));
      expect(scan).toHaveBeenCalledTimes(3);
    });

    it("tells the user when a scan was asked for a moment ago, and puts the button back", async () => {
      open("dana");
      const scan = vi.fn(async (): Promise<ScanResult> => ({ status: "skipped" }));
      stop = startBadges({ lookup: known, scan, delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));
      pill()!.click();
      await vi.waitFor(() => expect(cardText()).toContain("Scanned a moment ago"));
      expect(pillText()).toBe("Scan picks");
    });

    it("scans once per press even if pressed repeatedly while it runs", async () => {
      open("dana");
      const scan = vi.fn(() => new Promise<ScanResult>(() => {}));
      stop = startBadges({ lookup: known, scan, delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));
      const button = pill()!;
      button.click();
      button.click();
      button.click();
      await vi.waitFor(() => expect(scan).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 30));
      expect(scan).toHaveBeenCalledTimes(1);
    });

    it("can be dismissed, and stops with the page", async () => {
      open("dana");
      stop = startBadges({ lookup: known, scan: () => new Promise<ScanResult>(() => {}), delayMs: 10, ...fastTimeline });
      await vi.waitFor(() => expect(pillText()).toBe("Scan picks"));
      pill()!.click();
      await vi.waitFor(() => expect(card()).not.toBeNull());
      card()!.querySelector<HTMLButtonElement>(".x")!.click();
      await vi.waitFor(() => expect(card()).toBeNull());
      stop();
      expect(document.querySelector("[data-copayme=scan]")).toBeNull();
    });
  });
});

describe("badges on profile pages", () => {
  let stop: () => void;
  afterEach(() => stop?.());

  const profileHeader = (handle: string) => `
    <div data-testid="UserName">
      <div><span>Dana Whitfield</span></div>
      <div><span>@${handle}</span></div>
    </div>`;

  it("puts a badge on the profile header of the profile being viewed", async () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://x.com/dana_picks");
    document.body.innerHTML = `<main id="timeline"></main>`;
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ dana_picks: scored }));
    stop = startBadges({ lookup, delayMs: 10 });

    // X builds the profile page after navigation, so the header arrives later.
    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", profileHeader("dana_picks"));
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8"]));
    expect(lookup).toHaveBeenCalledWith(["dana_picks"]);
    expect(document.querySelector('[data-testid="UserName"] > div [data-copayme=badge]')).not.toBeNull(); // in the name row
  });

  it("shares one lookup between a profile header and that person's tweets", async () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://x.com/dana_picks");
    document.body.innerHTML = `<main id="timeline">${profileHeader("dana_picks")}</main>`;
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({ dana_picks: scored }));
    stop = startBadges({ lookup, delayMs: 10 });
    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", tweetHtml("dana_picks"));

    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8", "SCORE72▲8"]));
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("adds nothing when the address is not a profile", async () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://x.com/home");
    document.body.innerHTML = `<main id="timeline"></main>`;
    const lookup = vi.fn(async (): Promise<BadgesResponse> => ({}));
    stop = startBadges({ lookup, delayMs: 10 });
    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", profileHeader("dana_picks"));
    await new Promise((r) => setTimeout(r, 60));
    expect(badgeTexts()).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("when the extension is reloaded under an open page", () => {
  let stop: () => void;
  afterEach(() => stop?.());

  it("retires quietly: removes its badges, stops asking, and does not log an error per tweet", async () => {
    document.body.innerHTML = '<main id="timeline"></main>';
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lookup = vi.fn(async (): Promise<BadgesResponse> => {
      throw new Error("Extension context invalidated.");
    });
    stop = startBadges({ lookup, delayMs: 10 });
    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", tweetHtml("alice"));
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-copayme=badge]")).toHaveLength(0)); // its badge is gone

    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", tweetHtml("bob")); // a new tweet scrolls in
    await new Promise((r) => setTimeout(r, 60));
    expect(document.querySelectorAll("[data-copayme=badge]")).toHaveLength(0); // nothing is mounted any more
    expect(lookup).toHaveBeenCalledTimes(1); // and it has stopped asking
    expect(warn).not.toHaveBeenCalled(); // and stopped logging
    warn.mockRestore();
  });

  it("still treats an ordinary failure as retryable, so a flaky API does not switch badges off", async () => {
    document.body.innerHTML = '<main id="timeline"></main>';
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const lookup = vi
      .fn<(handles: string[]) => Promise<BadgesResponse>>()
      .mockRejectedValueOnce(new Error("badges request failed: 500"))
      .mockResolvedValue({ alice: scored });
    stop = startBadges({ lookup, delayMs: 10 });
    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", tweetHtml("alice"));
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", tweetHtml("alice"));
    await vi.waitFor(() => expect(badgeTexts()).toContain("SCORE72▲8"));
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("can be stopped more than once, and removes the badges it added", async () => {
    document.body.innerHTML = '<main id="timeline"></main>';
    stop = startBadges({ lookup: async () => ({ alice: scored }), delayMs: 10 });
    document.getElementById("timeline")!.insertAdjacentHTML("beforeend", tweetHtml("alice"));
    await vi.waitFor(() => expect(badgeTexts()).toEqual(["SCORE72▲8"]));
    stop();
    stop();
    expect(document.querySelectorAll("[data-copayme=badge]")).toHaveLength(0);
  });
});
