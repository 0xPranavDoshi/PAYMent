// @vitest-environment happy-dom
import type { BadgesResponse } from "@copayme/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBadges } from "./page.js";

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
});
