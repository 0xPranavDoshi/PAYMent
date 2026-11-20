// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TWEET_CARD_CSS, TweetCard, type TweetCardProps } from "./index";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base: TweetCardProps = {
  handle: "pickswise",
  text: "Our pick: Wizards +6.5\nT&amp;Cs apply. Via @ActionNetworkHQ https://example.com/a.\n  https://t.co/VXTYrphI6W",
  postedAt: "2026-11-19T12:03:00.000Z",
  tweetId: "2123176566800715914",
};

function render(props: Partial<TweetCardProps> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<TweetCard {...base} {...props} />));
  return { host, unmount: () => act(() => root.unmount()) };
}

afterEach(() => (document.body.innerHTML = ""));

describe("TweetCard", () => {
  it("draws the author, the text as X shows it, the time and the link to the tweet", () => {
    const { host } = render();
    expect(host.querySelector(".tweetcard-av")!.textContent).toBe("P");
    expect(host.querySelector(".tweetcard-head b")!.textContent).toBe("@pickswise");
    const text = host.querySelector(".tweetcard-text")!;
    expect(text.textContent).toContain("T&Cs apply."); // escapes decoded
    expect(text.textContent).not.toContain("VXTYrphI6W"); // the trailing t.co is hidden
    expect([...text.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toEqual(["https://x.com/ActionNetworkHQ", "https://example.com/a"]);
    expect(host.querySelector(".tweetcard-time")!.textContent).toMatch(/\d{1,2}:\d{2} (AM|PM) · Nov \d{1,2}, 2026/);
    const open = host.querySelector<HTMLAnchorElement>(".tweetcard-acts a")!;
    expect(open.getAttribute("href")).toBe("https://x.com/i/status/2123176566800715914");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows a t.co link in the middle of the text by its address", () => {
    const { host } = render({ text: "bet here https://t.co/AbC123 now" });
    const link = host.querySelector<HTMLAnchorElement>(".tweetcard-text a")!;
    expect(link.textContent).toBe("t.co/AbC123");
    expect(link.getAttribute("href")).toBe("https://t.co/AbC123");
  });

  it("has slots for a badge beside the name, a note, and extra actions in the footer", () => {
    const { host } = render({ afterName: <i className="badge">82</i>, note: "Pick: UConn · YES", actions: <button className="back">Back</button> });
    expect(host.querySelector(".tweetcard-head .badge")!.textContent).toBe("82");
    expect(host.querySelector(".tweetcard-note")!.textContent).toBe("Pick: UConn · YES");
    expect(host.querySelector(".tweetcard-acts .back")).not.toBeNull();
  });

  it("keeps hostile text as text, and a link click does not reach the element around the card", () => {
    const hostile = '<img src=x onerror="alert(1)"> & friends https://example.com/x';
    const { host } = render({ text: hostile });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".tweetcard-text")!.textContent).toBe('<img src=x onerror="alert(1)"> & friends example.com/x');
    let reached = false;
    host.parentElement!.addEventListener("click", () => (reached = true)); // something around the card
    const link = host.querySelector<HTMLAnchorElement>(".tweetcard-text a")!;
    link.addEventListener("click", (e) => e.preventDefault());
    link.click();
    expect(reached).toBe(false);
  });
});

describe("TWEET_CARD_CSS", () => {
  it("is themed only through --tweetcard-* variables, so a host cannot restyle it by accident", () => {
    const vars = new Set([...TWEET_CARD_CSS.matchAll(/var\((--[a-z-]+)/g)].map((m) => m[1]));
    expect([...vars].every((v) => v!.startsWith("--tweetcard-"))).toBe(true);
    expect(vars.size).toBeGreaterThanOrEqual(8);
  });
});
