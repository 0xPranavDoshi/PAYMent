import { parseTweetText } from "@copayme/shared/tweet-text";

/** A tweet's text as X would show it: escapes decoded, links, mentions and hashtags clickable. */
export default function TweetText({ text }: { text: string }) {
  return (
    <>
      {parseTweetText(text).map((segment, i) =>
        segment.kind === "text" ? (
          segment.text
        ) : (
          <a key={i} href={segment.href} target="_blank" rel="noopener noreferrer">
            {segment.text}
          </a>
        ),
      )}
    </>
  );
}
