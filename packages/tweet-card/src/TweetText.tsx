import { parseTweetText } from "@copayme/shared/tweet-text";

/** A tweet's text as X would show it: escapes decoded, links, mentions and hashtags clickable. */
export function TweetText({ text }: { text: string }) {
  return (
    <>
      {parseTweetText(text).map((segment, i) =>
        segment.kind === "text" ? (
          segment.text
        ) : (
          // A click on a link in the tweet must not reach whatever the card sits inside (a flip, a link).
          <a key={i} href={segment.href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
            {segment.text}
          </a>
        ),
      )}
    </>
  );
}
