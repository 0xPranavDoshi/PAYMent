// @vitest-environment happy-dom
import type { BadgesResponse, CallEntry, UserProfile } from "@copayme/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileData } from "../messages.js";
import { startBadges } from "../page.js";

const WEB = "https://copayme.example";

const badge = { score: 72, change14d: 8, tier: "scored" as const, nResolved: 42, hitRate: 0.69 };
const profile = (handle: string, over: Partial<UserProfile> = {}): UserProfile => ({
  ...badge,
  handle,
  nWins: 29,
  skill: 0.1,
  lastCallAt: null,
  updatedAt: "2026-11-19T12:00:00.000Z",
  latestSnapshot: null,
  ...over,
});
const call = (n: number, over: Partial<CallEntry> = {}): CallEntry => ({
  callId: `00000000-0000-4000-8000-00000000000${n}`,
  tweetId: `100${n}`,
  tweetedAt: "2026-11-19T12:03:00.000Z",
  eventName: `Game ${n}`,
  pickLabel: "UConn",
  side: "yes",
  oddsAtCall: 0.62,
  oddsSource: "snapshot",
  status: "scored",
  result: "won",
  points: 0.38,
  ...over,
});

const tweetHtml = (handle: string) => `
  <article data-testid="tweet">
    <div data-testid="User-Name">
      <div><a href="/${handle}"><span>Name</span></a></div>
      <div><a href="/${handle}"><span>@${handle}</span></a></div>
    </div>
  </article>`;

const popoverHosts = () => [...document.querySelectorAll<HTMLElement>("[data-copayme=popover]")];
const popoverText = () => popoverHosts()[0]?.shadowRoot?.querySelector(".card")?.textContent ?? null;
const badges = () => [...document.querySelectorAll<HTMLElement>("[data-copayme=badge]")];
const badgeButton = (i = 0) => badges()[i]!.shadowRoot!.querySelector<HTMLButtonElement>("button")!;
const click = (el: Element) => {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
  el.dispatchEvent(event);
  return event;
};

describe("the popover", () => {
  let stop: () => void;
  const lookup = async (handles: string[]): Promise<BadgesResponse> => Object.fromEntries(handles.map((h) => [h, badge]));

  function start(loadProfile?: (handle: string) => Promise<ProfileData>, handles = ["alice"]) {
    document.body.innerHTML = `<main>${handles.map(tweetHtml).join("")}</main>`;
    stop = startBadges({ lookup, loadProfile, webUrl: WEB, delayMs: 5 });
    return vi.waitFor(() => expect(badges().every((b) => b.shadowRoot?.querySelector("button"))).toBe(true));
  }
  afterEach(() => stop?.());
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const ready = (handle = "alice"): ProfileData => ({
    profile: profile(handle),
    calls: [call(1), call(2, { result: "lost", points: -0.62, side: "no" }), call(3, { status: "pending", result: null, points: null })],
  });

  it("opens next to the badge, shows loading and then the profile and recent picks", async () => {
    let release!: (d: ProfileData) => void;
    await start(() => new Promise((r) => (release = r)));
    click(badgeButton());

    await vi.waitFor(() => expect(popoverText()).toContain("Loading"));
    expect(popoverText()).toContain("@alice");
    release(ready());

    await vi.waitFor(() => expect(popoverText()).toContain("Game 1"));
    const text = popoverText()!;
    expect(text).toContain("coPAYMe");
    expect(text).toContain("72");
    expect(text).toContain("▲ 8 in 14 days");
    expect(text).toContain("29–13");
    expect(text).toContain("69%");
    expect(text).toContain("UConn · YES · 62¢");
    expect(text).toContain("+0.38");
    expect(text).toContain("UConn · NO");
    expect(text).toContain("−0.62");
    expect(text).toContain("Pending");

    const card = popoverHosts()[0]!.shadowRoot!;
    expect([...card.querySelectorAll(".dot")].map((d) => d.className.replace("dot ", ""))).toEqual(["won", "lost", "pending"]);

    const links = [...popoverHosts()[0]!.shadowRoot!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("https://x.com/i/status/1001");
    expect(links).toContain(`${WEB}/traders/alice`);
  });

  it("explains the New badge and handles empty data", async () => {
    await start(async () => ({ profile: profile("alice", { tier: "new", nResolved: 2, nWins: 1, hitRate: 0.5 }), calls: [] }));
    click(badgeButton());
    await vi.waitFor(() => expect(popoverText()).toContain("No picks recorded yet"));
    expect(popoverText()).toContain("NEW");
    expect(popoverText()).toContain("A score appears after 5 resolved picks");

    click(badgeButton()); // close
    stop();
    await start(async () => ({ profile: null, calls: [] }));
    click(badgeButton());
    await vi.waitFor(() => expect(popoverText()).toContain("No track record for @alice yet"));
  });

  it("closes on Escape, on a click outside, and when the page scrolls", async () => {
    await start(async () => ready());
    const open = async () => {
      click(badgeButton());
      await vi.waitFor(() => expect(popoverHosts()).toHaveLength(1));
    };

    await open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popoverHosts()).toHaveLength(0);

    await open();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(popoverHosts()).toHaveLength(0);

    await open();
    window.dispatchEvent(new Event("scroll"));
    expect(popoverHosts()).toHaveLength(0);
  });

  it("stays open for a click inside it, and closes with its close button", async () => {
    await start(async () => ready());
    click(badgeButton());
    await vi.waitFor(() => expect(popoverText()).toContain("Game 1"));

    const card = popoverHosts()[0]!.shadowRoot!.querySelector(".card")!;
    card.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(popoverHosts()).toHaveLength(1);

    click(popoverHosts()[0]!.shadowRoot!.querySelector<HTMLButtonElement>(".x")!);
    expect(popoverHosts()).toHaveLength(0);
  });

  it("toggles on a second click on the same badge, and moves to another badge", async () => {
    await start(async (h) => ready(h), ["alice", "bob"]);
    click(badgeButton(0));
    await vi.waitFor(() => expect(popoverText()).toContain("@alice"));
    click(badgeButton(0));
    expect(popoverHosts()).toHaveLength(0);

    click(badgeButton(0));
    await vi.waitFor(() => expect(popoverText()).toContain("@alice"));
    click(badgeButton(1));
    await vi.waitFor(() => expect(popoverText()).toContain("@bob"));
    expect(popoverHosts()).toHaveLength(1); // only ever one
  });

  it("does not let the click reach X, so the tweet does not open", async () => {
    await start(async () => ready());
    const reachedTweet = vi.fn();
    const reachedPage = vi.fn();
    document.querySelector("article")!.addEventListener("click", reachedTweet);
    document.addEventListener("click", reachedPage);

    const event = click(badgeButton());
    expect(event.defaultPrevented).toBe(true);
    expect(reachedTweet).not.toHaveBeenCalled();
    expect(reachedPage).not.toHaveBeenCalled();
    document.removeEventListener("click", reachedPage);

    const reachedKeys = vi.fn();
    document.addEventListener("keydown", reachedKeys);
    badgeButton().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    expect(reachedKeys).not.toHaveBeenCalled();
    document.removeEventListener("keydown", reachedKeys);
  });

  it("shows an error with a Retry that loads again", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("API down")).mockResolvedValue(ready());
    await start(load);
    click(badgeButton());
    await vi.waitFor(() => expect(popoverText()).toContain("Couldn't load this profile"));

    click(popoverHosts()[0]!.shadowRoot!.querySelector<HTMLButtonElement>(".retry")!);
    await vi.waitFor(() => expect(popoverText()).toContain("Game 1"));
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores a slow answer for a badge the user has already moved away from", async () => {
    const releases: Record<string, (d: ProfileData) => void> = {};
    await start((h) => new Promise((r) => (releases[h] = r)), ["alice", "bob"]);
    click(badgeButton(0));
    await vi.waitFor(() => expect(releases.alice).toBeDefined());
    click(badgeButton(1));
    await vi.waitFor(() => expect(releases.bob).toBeDefined());

    releases.bob!(ready("bob"));
    await vi.waitFor(() => expect(popoverText()).toContain("Game 1"));
    releases.alice!({ profile: profile("alice", { score: 11 }), calls: [call(9)] }); // arrives late
    await new Promise((r) => setTimeout(r, 30));
    expect(popoverText()).toContain("@bob");
    expect(popoverText()).not.toContain("Game 9");
  });

  it("does nothing when badges were started without a way to load profiles", async () => {
    await start(undefined);
    click(badgeButton());
    expect(popoverHosts()).toHaveLength(0);
  });

  it("is removed when the extension stops", async () => {
    await start(async () => ready());
    click(badgeButton());
    await vi.waitFor(() => expect(popoverHosts()).toHaveLength(1));
    stop();
    expect(popoverHosts()).toHaveLength(0);
  });

  it("opens below the badge, or above it when there is no room below", async () => {
    await start(async () => ready());
    const button = badgeButton();
    window.innerHeight = 800;
    window.innerWidth = 1200;

    button.getBoundingClientRect = () => ({ left: 100, right: 140, top: 100, bottom: 118, width: 40, height: 18, x: 100, y: 100, toJSON: () => ({}) });
    click(button);
    await vi.waitFor(() => expect(popoverHosts()).toHaveLength(1));
    expect(popoverHosts()[0]!.style.top).toBe("124px");
    expect(popoverHosts()[0]!.style.left).toBe("100px");
    click(button);

    button.getBoundingClientRect = () => ({ left: 1190, right: 1200, top: 700, bottom: 718, width: 10, height: 18, x: 1190, y: 700, toJSON: () => ({}) });
    click(button);
    await vi.waitFor(() => expect(popoverHosts()).toHaveLength(1));
    expect(popoverHosts()[0]!.style.bottom).toBe("106px"); // 800 - 700 + 6
    expect(popoverHosts()[0]!.style.left).toBe("872px"); // kept on screen: 1200 - 320 - 8
  });
});
