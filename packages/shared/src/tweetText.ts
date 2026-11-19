/**
 * Turns a stored tweet's text into what X would show. The text arrives exactly as X returned it: HTML
 * escaped ("T&amp;Cs"), with a t.co short link for every link, card or attachment. Both clients draw a
 * tweet from it, so they share this one parser. It returns plain segments, never HTML, so a client
 * renders them as ordinary text and anchors and nothing in the tweet can inject markup.
 */

export type TweetSegment =
  | { kind: "text"; text: string }
  | { kind: "link" | "mention" | "hashtag"; text: string; href: string };

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes the HTML escapes X puts in tweet text, once (so "&amp;lt;" becomes "&lt;", not "<"). */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi, (whole, dec?: string, hex?: string, name?: string) => {
    if (name) return NAMED[name.toLowerCase()] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex as string, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

const TRAILING_TCO = /\s*https?:\/\/t\.co\/\w+\s*$/;

/**
 * The tweet as plain text: escapes decoded and the trailing t.co link dropped. X hides that final link
 * (it stands for an attached card, image or quoted tweet), so showing it only adds noise.
 */
export function plainTweetText(raw: string): string {
  let text = decodeHtmlEntities(raw).trimEnd();
  while (TRAILING_TCO.test(text)) text = text.replace(TRAILING_TCO, "");
  return text.trim();
}

// A link, an @mention, or a #hashtag. Mentions and hashtags must not follow a word character, so an
// email address or "C#" inside a word is left alone.
const TOKEN = /(https?:\/\/[^\s<>"']+)|((?<![\w@])@[A-Za-z0-9_]{1,15}\b)|((?<![\w#&])#[\p{L}\p{N}_]*[\p{L}_][\p{L}\p{N}_]*)/gu;
const URL_TAIL = /[.,;:!?)\]}'"…]+$/;

/** The tweet as segments: plain text, with links, mentions and hashtags marked so they can be made clickable. */
export function parseTweetText(raw: string): TweetSegment[] {
  const text = plainTweetText(raw);
  const out: TweetSegment[] = [];
  let last = 0;
  const pushText = (s: string) => {
    if (!s) return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += s;
    else out.push({ kind: "text", text: s });
  };

  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    pushText(text.slice(last, start));
    let token = match[0];
    let tail = "";
    if (match[1]) {
      tail = URL_TAIL.exec(token)?.[0] ?? "";
      token = token.slice(0, token.length - tail.length);
    }
    last = start + token.length + tail.length;

    if (match[1]) {
      let href: string;
      try {
        href = new URL(token).href;
      } catch {
        pushText(token + tail);
        continue;
      }
      // Shown as its address without the scheme, like X does when it has no better name for it. (X's
      // expanded destination is not in the data we receive, so a t.co link keeps its short address.)
      out.push({ kind: "link", text: token.replace(/^https?:\/\//, "").replace(/\/$/, ""), href });
      pushText(tail);
    } else if (match[2]) {
      out.push({ kind: "mention", text: token, href: `https://x.com/${token.slice(1)}` });
    } else {
      out.push({ kind: "hashtag", text: token, href: `https://x.com/hashtag/${encodeURIComponent(token.slice(1))}` });
    }
  }
  pushText(text.slice(last));
  return out;
}

/** A tweet's permalink on X. */
export function tweetUrl(tweetId: string): string {
  return `https://x.com/i/status/${encodeURIComponent(tweetId)}`;
}

/** A tweet's time the way X writes it: "Nov 19" beside the name, "7:03 AM · Nov 19, 2026" under the text. */
export function formatTweetTime(iso: string): { short: string; full: string } {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const year = date.toLocaleDateString("en-US", { year: "numeric" });
  return { short: day, full: `${time} · ${day}, ${year}` };
}
