import type { ReactNode } from "react";
import { formatTweetTime, tweetUrl } from "@copayme/shared/tweet-text";
import { TweetText } from "./TweetText";

export interface TweetCardProps {
  /** The author, without the @. */
  handle: string;
  /** The tweet's text exactly as stored (escapes and t.co links are handled here). */
  text: string;
  /** When it was tweeted, ISO. */
  postedAt: string;
  tweetId: string;
  /** Beside the @handle, e.g. a coPAYMe score badge. */
  afterName?: ReactNode;
  /** The footer's left side, e.g. which pick this tweet made. */
  note?: ReactNode;
  /** After "Open on X" in the footer, e.g. a Back button. */
  actions?: ReactNode;
  className?: string;
}

/**
 * A tweet drawn the way X draws it. This is the only place a tweet is drawn: the extension's popover
 * and the website both render this component with its one stylesheet (TWEET_CARD_CSS), so they cannot
 * drift apart. The host themes it with --tweetcard-* variables.
 */
export function TweetCard({ handle, text, postedAt, tweetId, afterName, note, actions, className }: TweetCardProps) {
  const when = formatTweetTime(postedAt);
  return (
    <article className={className ? `tweetcard ${className}` : "tweetcard"} aria-label={`Tweet from @${handle}`}>
      <div className="tweetcard-row">
        <div className="tweetcard-av" aria-hidden="true">
          {handle.charAt(0).toUpperCase()}
        </div>
        <div className="tweetcard-main">
          <div className="tweetcard-head">
            <b>@{handle}</b>
            {afterName}
            <span>· {when.short}</span>
          </div>
          <p className="tweetcard-text">
            <TweetText text={text} />
          </p>
          <div className="tweetcard-time">{when.full}</div>
        </div>
      </div>
      <div className="tweetcard-foot">
        <span className="tweetcard-note">{note}</span>
        <span className="tweetcard-acts">
          <a href={tweetUrl(tweetId)} target="_blank" rel="noopener noreferrer">
            Open on X ↗
          </a>
          {actions}
        </span>
      </div>
    </article>
  );
}
