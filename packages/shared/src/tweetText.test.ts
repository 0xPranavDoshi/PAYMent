import { describe, expect, it } from "vitest";
import { decodeHtmlEntities, parseTweetText, plainTweetText } from "./tweetText.js";

describe("decodeHtmlEntities", () => {
  it("decodes the escapes X puts in tweet text", () => {
    expect(decodeHtmlEntities("21+ (18+ WY). T&amp;Cs apply.")).toBe("21+ (18+ WY). T&Cs apply.");
    expect(decodeHtmlEntities("a &lt; b &gt; c &quot;d&quot; &#39;e&#39; &apos;f&apos;")).toBe(`a < b > c "d" 'e' 'f'`);
    expect(decodeHtmlEntities("&#127936; &#x1F3C0; Texas A&amp;M")).toBe("🏀 🏀 Texas A&M");
  });

  it("decodes once, so an escaped escape stays an escape", () => {
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
  });

  it("leaves what is not an escape alone", () => {
    for (const s of ["Fish & chips", "AT&T", "R&B &", "&notanentity;", "&#0;", "&#1114112;", "&#xD800;"]) {
      expect(decodeHtmlEntities(s)).toBe(s);
    }
  });
});

describe("plainTweetText", () => {
  it("drops the trailing t.co link, which X hides, and the blank lines before it", () => {
    expect(plainTweetText("Under 44 👇\nBet now\nhttps://t.co/Y65avPxeHa\n")).toBe("Under 44 👇\nBet now");
    expect(plainTweetText("21+. T&amp;Cs apply. Gambling problem? Call 1-800-GAMBLER.\nhttps://t.co/VXTYrphI6W")).toBe(
      "21+. T&Cs apply. Gambling problem? Call 1-800-GAMBLER.",
    );
    expect(plainTweetText("text https://t.co/aaa https://t.co/bbb")).toBe("text");
  });

  it("keeps a t.co link that is not at the end, and other trailing links", () => {
    expect(plainTweetText("see https://t.co/aaa for more")).toBe("see https://t.co/aaa for more");
    expect(plainTweetText("more at https://example.com/x")).toBe("more at https://example.com/x");
  });
});

describe("parseTweetText", () => {
  const kinds = (raw: string) => parseTweetText(raw).map((s) => `${s.kind}:${s.text}`);

  it("marks links, mentions and hashtags and keeps the text between them", () => {
    expect(kinds("Via @ActionNetworkHQ: #NBA picks at https://example.com/picks today")).toEqual([
      "text:Via ",
      "mention:@ActionNetworkHQ",
      "text:: ",
      "hashtag:#NBA",
      "text: picks at ",
      "link:example.com/picks",
      "text: today",
    ]);
  });

  it("points mentions and hashtags at X, and links at themselves", () => {
    const segs = parseTweetText("@dana #Lakers https://example.com/a?b=1&amp;c=2");
    expect(segs.filter((s) => s.kind !== "text").map((s) => (s as { href: string }).href)).toEqual([
      "https://x.com/dana",
      "https://x.com/hashtag/Lakers",
      "https://example.com/a?b=1&c=2", // the escape inside the link is decoded too
    ]);
  });

  it("does not take trailing punctuation as part of a link", () => {
    expect(kinds("Read https://example.com/post.")).toEqual(["text:Read ", "link:example.com/post", "text:."]);
    expect(kinds("(https://example.com/x), then")).toEqual(["text:(", "link:example.com/x", "text:), then"]);
  });

  it("labels an unexpanded t.co link in the middle rather than showing a random short code", () => {
    expect(kinds("see https://t.co/AbC123 now")).toEqual(["text:see ", "link:link", "text: now"]);
  });

  it("leaves emails, C#, and plain text alone", () => {
    expect(kinds("mail me@example.com about C# and 100%")).toEqual(["text:mail me@example.com about C# and 100%"]);
    expect(kinds("#1 pick, #2025 too")).toEqual(["text:#1 pick, #2025 too"]); // numbers are not hashtags
  });

  it("never produces markup: hostile text stays text", () => {
    const hostile = '<img src=x onerror="alert(1)"> & friends';
    expect(parseTweetText(hostile)).toEqual([{ kind: "text", text: hostile }]);
    expect(parseTweetText("javascript:alert(1) data:text/html,<b>")).toEqual([{ kind: "text", text: "javascript:alert(1) data:text/html,<b>" }]);
  });

  it("handles empty text and a text that is only a link", () => {
    expect(parseTweetText("")).toEqual([]);
    expect(parseTweetText("https://t.co/onlylink")).toEqual([]);
  });

  it("keeps the real example from the demo intact", () => {
    const raw = "21+ (18+ WY). T&amp;Cs apply. Gambling problem? Call 1-800-GAMBLER.\n  https://t.co/VXTYrphI6W";
    expect(parseTweetText(raw)).toEqual([{ kind: "text", text: "21+ (18+ WY). T&Cs apply. Gambling problem? Call 1-800-GAMBLER." }]);
  });
});
