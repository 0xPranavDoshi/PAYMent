// @vitest-environment happy-dom
import type { BadgesResponse, CallEntry, UserProfile } from "@copayme/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileData } from "../messages.js";
import { startBadges } from "../page.js";
import type { TradingActions, TradingState } from "../trading.js";

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
  tweetText: `Tweet number ${n}`,
  tweetedAt: "2026-11-19T12:03:00.000Z",
  eventName: `Game ${n}`,
  marketTicker: `NCAAM-2611200300-G${n}-M`,
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

  function start(loadProfile?: (handle: string) => Promise<ProfileData>, handles = ["alice"], trading?: TradingActions) {
    document.body.innerHTML = `<main>${handles.map(tweetHtml).join("")}</main>`;
    stop = startBadges({ lookup, loadProfile, webUrl: WEB, trading, delayMs: 5 });
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
    const card = popoverHosts()[0]!.shadowRoot!;
    await vi.waitFor(() => expect(card.querySelector(".gauge .score")!.textContent).toBe("72")); // counts up to the score
    const text = popoverText()!;
    expect(text).toContain("coPAYMe");
    expect(text).toContain("SCORE");
    expect(text).toContain("▲ 8 in 14 days");
    expect(text).toContain("29–13");
    expect(text).toContain("69%");
    expect(text).toContain("UConn · YES · 62¢");
    expect(text).toContain("+38¢");
    expect(text).toContain("UConn · NO");
    expect(text).toContain("−62¢");
    expect(text).toContain("Pending");

    expect(card.querySelector(".dot")).toBeNull(); // no markers beside the picks
    expect([...card.querySelectorAll(".pick .front .pts")].map((p) => p.className.replace("pts ", ""))).toEqual(["won", "lost", "none"]);
    expect(card.querySelector(".gauge")!.getAttribute("aria-label")).toBe("Score 72 out of 100");

    const links = [...popoverHosts()[0]!.shadowRoot!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("https://x.com/i/status/1001"); // "Open on X", on the back of the card
    expect(links).toContain(`${WEB}/traders/alice`);
  });

  it("has a Rescan button that closes the card and rescans the account, forced past the 10-minute wait", async () => {
    document.body.innerHTML = `<main>${tweetHtml("alice")}</main>`;
    const scan = vi.fn(async () => ({ status: "done" as const, badge }));
    stop = startBadges({ lookup, loadProfile: async () => ready(), scan, webUrl: WEB, delayMs: 5 });
    await vi.waitFor(() => expect(badges().every((b) => b.shadowRoot?.querySelector("button"))).toBe(true));
    click(badgeButton());
    await vi.waitFor(() => expect(popoverText()).toContain("Game 1"));
    const rescan = popoverHosts()[0]!.shadowRoot!.querySelector<HTMLButtonElement>("button.rescan")!;
    expect(rescan.textContent).toBe("Rescan");
    click(rescan);
    await vi.waitFor(() => expect(scan).toHaveBeenCalledWith("alice", null, { force: true })); // not its profile: no newest id
    expect(popoverHosts()).toHaveLength(0);
  });

  it("has no Rescan button when scanning isn't available", async () => {
    await start(async () => ready());
    click(badgeButton());
    await vi.waitFor(() => expect(popoverText()).toContain("Game 1"));
    expect(popoverHosts()[0]!.shadowRoot!.querySelector("button.rescan")).toBeNull();
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

  it("closes on Escape and on a click outside", async () => {
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

  it("shrinks the card to the room on its side, so it is never cut off", async () => {
    await start(async () => ready());
    const button = badgeButton();
    window.innerHeight = 700;
    window.innerWidth = 1200;
    // A badge at 400px in a 700px window: 282 below, 400 above. Above is roomier, but the card is
    // taller than 400, so it must shrink (and scroll inside itself) rather than run off the top.
    button.getBoundingClientRect = () => ({ left: 100, right: 140, top: 400, bottom: 418, width: 40, height: 18, x: 100, y: 400, toJSON: () => ({}) });
    click(button);
    await vi.waitFor(() => expect(popoverHosts()).toHaveLength(1));
    expect(popoverHosts()[0]!.style.bottom).toBe("306px"); // 700 - 400 + 6
    expect(popoverHosts()[0]!.style.getPropertyValue("--avail")).toBe("386px"); // 400 - 6 - 8
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

  describe("scrolling", () => {
    const rect = (top: number) => ({ left: 100, right: 160, top, bottom: top + 24, width: 60, height: 24, x: 100, y: top, toJSON: () => ({}) });
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

    async function openAt(top: number) {
      window.innerHeight = 900;
      window.innerWidth = 1200;
      await start(async () => ready());
      const button = badgeButton();
      let current = top;
      button.getBoundingClientRect = () => rect(current) as DOMRect;
      click(button);
      await vi.waitFor(() => expect(popoverHosts()).toHaveLength(1));
      return { move: (t: number) => (current = t), button };
    }

    it("stays open and follows its badge when the page scrolls", async () => {
      const { move } = await openAt(100);
      expect(popoverHosts()[0]!.style.top).toBe("130px"); // 100 + 24 + 6

      move(60); // the page scrolled 40px
      window.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(popoverHosts()[0]!.style.top).toBe("90px"));
      expect(popoverHosts()).toHaveLength(1);

      for (let i = 0; i < 5; i++) {
        move(60 - i * 3);
        window.dispatchEvent(new Event("scroll"));
        await nextFrame();
      }
      expect(popoverHosts()).toHaveLength(1); // many small scrolls never close it
    });

    it("keeps to the side it opened on, instead of jumping as the page scrolls", async () => {
      const { move } = await openAt(700); // too low for the card to fit below: opens above
      expect(popoverHosts()[0]!.style.bottom).toBe("206px"); // 900 - 700 + 6
      move(300); // now there would be room below, but it stays above
      window.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(popoverHosts()[0]!.style.bottom).toBe("606px")); // 900 - 300 + 6
      expect(popoverHosts()[0]!.style.top).toBe("auto");
    });

    it("ignores scrolling inside the card itself", async () => {
      const { move } = await openAt(100);
      move(-500); // would be off-screen if the page had scrolled
      popoverHosts()[0]!.shadowRoot!.querySelector(".card")!.dispatchEvent(new Event("scroll"));
      await nextFrame();
      await nextFrame();
      expect(popoverHosts()).toHaveLength(1);
    });

    it("closes once its badge has scrolled out of view, or its tweet is removed", async () => {
      const { move } = await openAt(100);
      move(-200); // wholly above the viewport
      window.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(popoverHosts()).toHaveLength(0));

      const second = await openAt(100);
      second.move(2000); // wholly below it
      window.dispatchEvent(new Event("resize"));
      await vi.waitFor(() => expect(popoverHosts()).toHaveLength(0));

      await openAt(100);
      document.querySelector("article")!.remove(); // X unmounts tweets that scroll far away
      window.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(popoverHosts()).toHaveLength(0));
    });
  });

  describe("flipping a pick to show its tweet", () => {
    const rows = () => [...popoverHosts()[0]!.shadowRoot!.querySelectorAll(".pick")] as HTMLElement[];
    const flipButton = (i: number) => rows()[i]!.querySelector<HTMLButtonElement>(".front .flipbtn")!;

    async function openCard() {
      await start(async () => ready());
      click(badgeButton());
      await vi.waitFor(() => expect(rows()).toHaveLength(3));
    }

    it("turns one card over to show the tweet, and back again", async () => {
      await openCard();
      expect(rows()[0]!.classList.contains("flipped")).toBe(false);

      click(flipButton(0));
      await vi.waitFor(() => expect(rows()[0]!.classList.contains("flipped")).toBe(true));
      const back = rows()[0]!.querySelector(".back")!;
      expect(back.textContent).toContain("@alice");
      expect(back.textContent).toContain("Tweet number 1");
      expect(back.querySelector("a")!.getAttribute("href")).toBe("https://x.com/i/status/1001");
      expect(rows()[1]!.classList.contains("flipped")).toBe(false); // the others stay put
      expect(popoverHosts()).toHaveLength(1); // and the popover stays open

      click(back.querySelector<HTMLButtonElement>(".flipbtn")!);
      await vi.waitFor(() => expect(rows()[0]!.classList.contains("flipped")).toBe(false));
    });

    it("each pick links to its market on Gemini, in a new tab, without turning the card over", async () => {
      await openCard();
      const link = rows()[1]!.querySelector<HTMLAnchorElement>(".front a.marketlink")!;
      expect(link.getAttribute("href")).toBe("https://www.gemini.com/predictions/NCAAM-2611200300-G2-M");
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.textContent).toContain("View market");
      click(link);
      expect(rows()[1]!.classList.contains("flipped")).toBe(false);
      expect(popoverHosts()).toHaveLength(1);
    });

    it("shows no market link for a pick whose market is not known", async () => {
      await start(async () => ({ profile: profile("alice"), calls: [call(1, { marketTicker: undefined }), call(2)] }));
      click(badgeButton());
      await vi.waitFor(() => expect(rows()).toHaveLength(2));
      expect(rows()[0]!.querySelector("a.marketlink")).toBeNull();
      expect(rows()[1]!.querySelector("a.marketlink")).not.toBeNull();
    });

    it("only the face that is showing can be reached by keyboard", async () => {
      await openCard();
      const front = () => rows()[0]!.querySelector(".front") as HTMLElement & { inert: boolean };
      const back = () => rows()[0]!.querySelector(".back") as HTMLElement & { inert: boolean };
      expect([front().inert, back().inert]).toEqual([false, true]);
      click(flipButton(0));
      await vi.waitFor(() => expect([front().inert, back().inert]).toEqual([true, false]));
    });

    it("can show several tweets at once, and renders tweet text as plain text", async () => {
      const hostile = '<img src=x onerror="alert(1)"> & friends';
      await start(async () => ({ profile: profile("alice"), calls: [call(1, { tweetText: hostile }), call(2)] }));
      click(badgeButton());
      await vi.waitFor(() => expect(rows()).toHaveLength(2));
      click(flipButton(0));
      click(flipButton(1));
      await vi.waitFor(() => expect(rows().every((r) => r.classList.contains("flipped"))).toBe(true));
      const back = rows()[0]!.querySelector(".back")!;
      expect(back.querySelector("img")).toBeNull();
      expect(back.querySelector(".tweetcard-text")!.textContent).toBe(hostile);
    });
    it("draws the tweet the way X does: escapes decoded, the trailing t.co link dropped, links and mentions clickable", async () => {
      const raw = "21+ (18+ WY). T&amp;Cs apply. Gambling problem? Call 1-800-GAMBLER.\nVia @ActionNetworkHQ #NBA https://example.com/picks.\n  https://t.co/VXTYrphI6W";
      await start(async () => ({ profile: profile("alice"), calls: [call(1, { tweetText: raw }), call(2)] }));
      click(badgeButton());
      await vi.waitFor(() => expect(rows()).toHaveLength(2));
      click(flipButton(0));
      await vi.waitFor(() => expect(rows()[0]!.classList.contains("flipped")).toBe(true));
      const text = rows()[0]!.querySelector(".tweetcard-text")!;
      expect(text.textContent).toContain("T&Cs apply."); // not "T&amp;Cs"
      expect(text.textContent).not.toContain("&amp;");
      expect(text.textContent).not.toContain("t.co"); // the trailing short link is hidden
      const hrefs = [...text.querySelectorAll("a")].map((a) => a.getAttribute("href"));
      expect(hrefs).toEqual(["https://x.com/ActionNetworkHQ", "https://x.com/hashtag/NBA", "https://example.com/picks"]);
      expect([...text.querySelectorAll("a")].every((a) => a.getAttribute("rel") === "noopener noreferrer" && a.getAttribute("target") === "_blank")).toBe(true);
    });

    it("keeps the card flipped when a link in the tweet is clicked", async () => {
      await start(async () => ({ profile: profile("alice"), calls: [call(1, { tweetText: "see https://example.com/x" }), call(2)] }));
      click(badgeButton());
      await vi.waitFor(() => expect(rows()).toHaveLength(2));
      click(flipButton(0));
      await vi.waitFor(() => expect(rows()[0]!.classList.contains("flipped")).toBe(true));
      const link = rows()[0]!.querySelector<HTMLAnchorElement>(".tweetcard-text a")!;
      link.addEventListener("click", (e) => e.preventDefault()); // do not navigate in the test
      link.click();
      expect(rows()[0]!.classList.contains("flipped")).toBe(true);
    });
  });

  describe("the trade buttons", () => {
    const buttons = () => [...popoverHosts()[0]!.shadowRoot!.querySelectorAll<HTMLButtonElement>(".actions .tbtn")];
    const watchBtn = () => buttons()[0]!;
    const copyBtn = () => buttons()[1]!;
    const card = () => popoverHosts()[0]!.shadowRoot!;
    const toast = () => card().querySelector(".toast")?.textContent ?? null;
    const byText = (text: string) => [...card().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);

    function fakeTrading(initial: Partial<TradingState> = {}, over: Partial<TradingActions> = {}) {
      let state: TradingState = { signedIn: true, watching: false, copy: null, copyMode: "paper", ...initial };
      const actions = {
        state: vi.fn(async () => state),
        setWatch: vi.fn(async (_h: string, on: boolean) => void (state = { ...state, watching: on })),
        startCopy: vi.fn(async (_h: string, amountUsdc: number) => void (state = { ...state, copy: { active: true, amountUsdc } })),
        stopCopy: vi.fn(async () => void (state = { ...state, copy: state.copy && { ...state.copy, active: false } })),
        ...over,
      };
      return actions satisfies TradingActions;
    }

    async function openCard(trading?: TradingActions) {
      await start(async () => ready(), ["alice"], trading);
      click(badgeButton());
      await vi.waitFor(() => expect(buttons()).toHaveLength(2));
    }
    const loaded = () => new Promise((r) => setTimeout(r, 20)); // let the trading state arrive
    const openCopyPanel = async () => {
      click(copyBtn());
      await vi.waitFor(() => expect(card().querySelector(".panel")).not.toBeNull());
    };

    it("shows both buttons even when trading is not connected, and says so when one is pressed", async () => {
      await openCard(undefined);
      expect(watchBtn().textContent).toBe("Watch");
      expect(copyBtn().textContent).toContain("Copy trade");
      click(watchBtn());
      await vi.waitFor(() => expect(toast()).toBe("Trading isn't available yet."));
    });

    it("tells a signed-out user to sign in, and never calls the trading service", async () => {
      const trading = fakeTrading({ signedIn: false });
      await openCard(trading);
      await loaded();
      click(watchBtn());
      await vi.waitFor(() => expect(toast()).toBe("Sign in with X on coPAYMe, then come back here."));
      click(copyBtn());
      expect(trading.setWatch).not.toHaveBeenCalled();
      expect(card().querySelector(".panel")).toBeNull(); // no confirmation to start copying
    });

    it("picks up a sign-in made on the site without reloading x.com", async () => {
      let signedIn = false;
      const trading = fakeTrading({}, {
        state: vi.fn(async () => ({ signedIn, watching: false, copy: null, copyMode: "paper" as const })),
      });
      await openCard(trading);
      await loaded();
      signedIn = true; // the user signs in on coPAYMe in another tab
      click(watchBtn());
      await vi.waitFor(() => expect(trading.setWatch).toHaveBeenCalledWith("alice", true));
      expect(toast()).not.toBe("Sign in with X on coPAYMe, then come back here.");
    });

    it("re-checks the login when the user returns to the tab", async () => {
      const trading = fakeTrading({ signedIn: false });
      await openCard(trading);
      await loaded();
      const before = vi.mocked(trading.state).mock.calls.length;
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() => expect(vi.mocked(trading.state).mock.calls.length).toBeGreaterThan(before));
    });

    describe("watching", () => {
      it("adds to the watchlist, says so with a link to it, and toggles back", async () => {
        const trading = fakeTrading();
        await openCard(trading);
        await loaded();
        click(watchBtn());
        await vi.waitFor(() => expect(watchBtn().textContent).toBe("Watching"));
        expect(trading.setWatch).toHaveBeenLastCalledWith("alice", true);
        expect(watchBtn().getAttribute("aria-pressed")).toBe("true");
        expect(toast()).toContain("Added to your watchlist.");
        expect(card().querySelector(".toast a")!.getAttribute("href")).toMatch(/\/watchlist$/);
        // nothing else is left in the card: the watchlist lives on the website
        expect(card().querySelector('[aria-label="Watching"]')).toBeNull();

        click(watchBtn());
        await vi.waitFor(() => expect(watchBtn().textContent).toBe("Watch"));
        expect(trading.setWatch).toHaveBeenLastCalledWith("alice", false);
        expect(toast()).toBe("Removed from your watchlist.");
      });

      it("clears its confirmation by itself", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
          await openCard(fakeTrading());
          await vi.advanceTimersByTimeAsync(50);
          click(watchBtn());
          await vi.waitFor(() => expect(toast()).not.toBeNull());
          await vi.advanceTimersByTimeAsync(5100);
          await vi.waitFor(() => expect(toast()).toBeNull());
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("copy trading", () => {
      it("asks for an amount before copying, and nothing happens until it is confirmed", async () => {
        const trading = fakeTrading();
        await openCard(trading);
        await loaded();
        await openCopyPanel();
        expect(trading.startCopy).not.toHaveBeenCalled();
        const chips = [...card().querySelectorAll<HTMLButtonElement>(".chip")];
        expect(chips.map((c) => c.textContent)).toEqual(["$5", "$10", "$25"]);
        expect(chips[1]!.getAttribute("aria-pressed")).toBe("true"); // $10 by default
        click(chips[2]!);
        await vi.waitFor(() => expect(card().querySelector(".panel")!.textContent).toContain("$25"));

        click(byText("Start copying")!);
        await vi.waitFor(() => expect(copyBtn().textContent).toContain("Copying · $25"));
        expect(trading.startCopy).toHaveBeenCalledWith("alice", 25);
        expect(card().querySelector(".panel")).toBeNull();
        expect(toast()).toBe("Copying @alice at $25 per pick.");
      });

      it("accepts any amount the user types, not just the presets", async () => {
        const trading = fakeTrading();
        await openCard(trading);
        await loaded();
        await openCopyPanel();
        const input = card().querySelector<HTMLInputElement>(".amount input")!;
        const type = (text: string) => {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          set.call(input, text);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        type("7.50");
        await vi.waitFor(() => expect(card().querySelector(".panel")!.textContent).toContain("$7.50"));
        expect([...card().querySelectorAll(".chip")].every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true); // presets deselected
        click(byText("Start copying")!);
        await vi.waitFor(() => expect(trading.startCopy).toHaveBeenCalledWith("alice", 7.5));
      });

      it("will not start with an amount that is not a positive dollar amount, and says why", async () => {
        const trading = fakeTrading();
        await openCard(trading);
        await loaded();
        await openCopyPanel();
        const input = card().querySelector<HTMLInputElement>(".amount input")!;
        const type = (text: string) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        };
        for (const bad of ["0", "-5", "abc", "1.234", "1e3"]) {
          type(bad);
          await vi.waitFor(() => expect(card().querySelector(".hint")?.textContent).toContain("above $0"));
          expect(byText("Start copying")!.disabled).toBe(true);
        }
        expect(trading.startCopy).not.toHaveBeenCalled();
        type("$1,000");
        await vi.waitFor(() => expect(byText("Start copying")!.disabled).toBe(false));
        expect(card().querySelector(".hint")).toBeNull();
      });

      it("says plainly whether it is simulated or places real orders", async () => {
        await openCard(fakeTrading({ copyMode: "paper" }));
        await loaded();
        await openCopyPanel();
        expect(card().querySelector(".panel")!.textContent).toContain("This is simulated");
        expect(card().querySelector(".panel")!.textContent).toContain("No real money moves");
        expect(card().querySelector(".panel")!.textContent).not.toContain("real orders");

        stop();
        await openCard(fakeTrading({ copyMode: "live" }));
        await loaded();
        await openCopyPanel();
        expect(card().querySelector(".panel")!.textContent).toContain("This places real orders");
      });

      it("shows no panel while copying, just the pill with the amount, and a menu to change or stop", async () => {
        const trading = fakeTrading({ copy: { active: true, amountUsdc: 25 } });
        await openCard(trading);
        await vi.waitFor(() => expect(copyBtn().textContent).toContain("Copying · $25"));
        expect(card().querySelector('[aria-label="Copying"]')).toBeNull();
        expect(card().querySelector(".panel")).toBeNull();
        expect(card().querySelector(".menu")).toBeNull();

        click(copyBtn());
        await vi.waitFor(() => expect(card().querySelector(".menu")).not.toBeNull());
        click(byText("Stop copying")!);
        await vi.waitFor(() => expect(copyBtn().textContent).toContain("Copy trade"));
        expect(trading.stopCopy).toHaveBeenCalledWith("alice");
        expect(toast()).toBe("Stopped copying @alice. Picks already copied stay open.");
        expect(card().querySelector(".menu")).toBeNull();
      });

      it("changes the amount from where it is now, rather than starting over", async () => {
        const trading = fakeTrading({ copy: { active: true, amountUsdc: 40 } }); // not a preset
        await openCard(trading);
        await vi.waitFor(() => expect(copyBtn().textContent).toContain("Copying"));
        click(copyBtn());
        await vi.waitFor(() => expect(byText("Change amount")).toBeDefined());
        click(byText("Change amount")!);
        await vi.waitFor(() => expect(card().querySelector(".panel")).not.toBeNull());
        expect(card().querySelector<HTMLInputElement>(".amount input")!.value).toBe("40"); // starts from the current amount
        click(byText("Update amount")!);
        await vi.waitFor(() => expect(trading.startCopy).toHaveBeenCalledWith("alice", 40));
        await vi.waitFor(() => expect(toast()).toBe("Now copying @alice at $40 per pick."));
      });

      it("cancel closes the panel without placing anything", async () => {
        const trading = fakeTrading();
        await openCard(trading);
        await loaded();
        await openCopyPanel();
        click(byText("Cancel")!);
        await vi.waitFor(() => expect(card().querySelector(".panel")).toBeNull());
        expect(trading.startCopy).not.toHaveBeenCalled();
      });
    });

    it("shows the error and changes nothing when the trading service refuses", async () => {
      const trading = fakeTrading({}, { setWatch: vi.fn(async () => { throw new Error("market is closed"); }) });
      await openCard(trading);
      await loaded();
      click(watchBtn());
      await vi.waitFor(() => expect(toast()).toBe("market is closed"));
      expect(card().querySelector(".toast")!.classList.contains("error")).toBe(true);
      expect(watchBtn().getAttribute("aria-pressed")).toBe("false");
    });

    it("ignores a second press while the first is still running, and a double-click cannot start copying twice", async () => {
      let release!: () => void;
      const trading = fakeTrading({}, { setWatch: vi.fn(() => new Promise<void>((r) => (release = r))) });
      await openCard(trading);
      await loaded();
      click(watchBtn());
      click(watchBtn());
      click(watchBtn());
      expect(trading.setWatch).toHaveBeenCalledTimes(1);
      release();
      await vi.waitFor(() => expect(trading.state).toHaveBeenCalledTimes(2)); // re-read after the action
      expect(trading.setWatch).toHaveBeenCalledTimes(1);

      let releaseCopy!: () => void;
      const copyTrading = fakeTrading({}, { startCopy: vi.fn(() => new Promise<void>((r) => (releaseCopy = r))) });
      stop();
      await openCard(copyTrading);
      await loaded();
      await openCopyPanel();
      const start = byText("Start copying")!;
      click(start);
      click(start);
      expect(copyTrading.startCopy).toHaveBeenCalledTimes(1);
      releaseCopy();
    });
  });
});

describe("the flipped card looks like a tweet", () => {
  let stop: () => void;
  afterEach(() => stop?.());
  const lookup = async (handles: string[]): Promise<BadgesResponse> => Object.fromEntries(handles.map((h) => [h, badge]));
  const rows = () => [...popoverHosts()[0]!.shadowRoot!.querySelectorAll(".pick")] as HTMLElement[];

  async function openWith(background: string) {
    document.body.style.backgroundColor = background;
    document.body.innerHTML = `<main>${tweetHtml("ubc_conference")}</main>`;
    document.body.style.backgroundColor = background;
    stop = startBadges({
      lookup,
      loadProfile: async () => ({ profile: profile("ubc_conference"), calls: [call(1, { tweetText: "Registration is open for #UBC2026." })] }),
      webUrl: WEB,
      delayMs: 5,
    });
    await vi.waitFor(() => expect(badges().every((b) => b.shadowRoot?.querySelector("button"))).toBe(true));
    click(badgeButton());
    await vi.waitFor(() => expect(rows()).toHaveLength(1));
  }

  it("shows the tag, an avatar, the text and X's time format, like a tweet", async () => {
    await openWith("rgb(0, 0, 0)");
    const back = rows()[0]!.querySelector(".back")!;
    expect(back.querySelector(".tweetcard-av")!.textContent).toBe("U");
    expect(back.querySelector(".tweetcard-head b")!.textContent).toBe("@ubc_conference");
    expect(back.querySelector(".tweetcard-head span")!.textContent).toMatch(/^· Nov \d+$/);
    expect(back.querySelector(".tweetcard-text")!.textContent).toBe("Registration is open for #UBC2026.");
    expect(back.querySelector(".tweetcard-time")!.textContent).toMatch(/^\d+:\d{2} (AM|PM) · Nov \d+, 2026$/);
    expect(back.querySelector(".tweetcard-foot")!.textContent).toContain("Pick: UConn · YES · 62¢");
  });

  it("is painted with the exact background of the page it sits on, so it matches X's own tweets", async () => {
    for (const background of ["rgb(255, 255, 255)", "rgb(21, 32, 43)", "rgb(0, 0, 0)"]) {
      await openWith(background);
      expect(popoverHosts()[0]!.style.getPropertyValue("--tw-bg")).toBe(background);
      popoverHosts()[0]!.remove();
      stop();
    }
  });

  it("follows the user switching X's theme while it is open", async () => {
    await openWith("rgb(0, 0, 0)"); // Lights Out
    document.body.style.backgroundColor = "rgb(21, 32, 43)"; // Dim
    await vi.waitFor(() => expect(popoverHosts()[0]!.style.getPropertyValue("--tw-bg")).toBe("rgb(21, 32, 43)"));
    document.body.style.backgroundColor = "rgb(255, 255, 255)"; // Light
    await vi.waitFor(() => expect(popoverHosts()[0]!.style.getPropertyValue("--tw-bg")).toBe("rgb(255, 255, 255)"));
    expect(popoverHosts()[0]!.dataset.theme).toBe("light");
  });
});

describe("when the extension was reloaded under the page", () => {
  let stop: () => void;
  afterEach(() => stop?.());
  const lookup = async (handles: string[]): Promise<BadgesResponse> => Object.fromEntries(handles.map((h) => [h, badge]));
  const card = () => popoverHosts()[0]!.shadowRoot!;

  it("tells the user to refresh, instead of offering a Retry that cannot work", async () => {
    document.body.innerHTML = `<main>${tweetHtml("alice")}</main>`;
    stop = startBadges({
      lookup,
      loadProfile: async () => {
        throw new Error("Extension context invalidated.");
      },
      webUrl: WEB,
      delayMs: 5,
    });
    await vi.waitFor(() => expect(badges().every((b) => b.shadowRoot?.querySelector("button"))).toBe(true));
    click(badgeButton());
    await vi.waitFor(() => expect(popoverText()).toContain("coPAYMe was updated. Refresh this page"));
    expect(card().querySelector(".refresh")!.textContent).toBe("Refresh page");
    expect(card().querySelector(".retry")).toBeNull();
  });

  it("says the same on a trade button, instead of showing the raw error", async () => {
    document.body.innerHTML = `<main>${tweetHtml("alice")}</main>`;
    const trading: TradingActions = {
      state: async () => ({ signedIn: true, watching: false, copy: null, copyMode: "paper" as const }),
      setWatch: async () => {
        throw new Error("Extension context invalidated.");
      },
      startCopy: async () => {},
      stopCopy: async () => {},
    };
    stop = startBadges({
      lookup,
      loadProfile: async () => ({ profile: profile("alice"), calls: [] }),
      webUrl: WEB,
      trading,
      delayMs: 5,
    });
    await vi.waitFor(() => expect(badges().every((b) => b.shadowRoot?.querySelector("button"))).toBe(true));
    click(badgeButton());
    await vi.waitFor(() => expect(card().querySelectorAll(".actions .tbtn")).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 20));
    click(card().querySelector<HTMLButtonElement>(".actions .tbtn")!);
    await vi.waitFor(() => expect(card().querySelector(".toast")?.textContent).toContain("Refresh this page"));
    expect(card().querySelector(".toast")!.textContent).not.toContain("invalidated");
  });
});
