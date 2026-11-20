"use client";

import { formatTweetTime, tweetUrl } from "@copayme/shared/tweet-text";
import { TweetText } from "@copayme/tweet-card";
import { useState } from "react";

export interface PickRowProps {
  handle: string;
  /** "NOV 19" */
  date: string;
  pick: string;
  event: string;
  /** "YES 52¢", or "YES" when the pick was not priced. */
  price: string;
  /** A result chip when the pick is settled, otherwise a plain tag ("PENDING", "VOID"). */
  result: { kind: "chip"; text: string; tone: "up" | "down" | "" } | { kind: "tag"; text: string };
  tweetText: string;
  tweetId: string;
  /** The market on Gemini, to check its price and result; omitted when the market is not known. */
  marketUrl?: string;
  /** When it was tweeted, ISO. */
  postedAt: string;
}

/** One pick. "See tweet" opens the tweet in place as a speech bubble from the trader, with what we read it as. */
export default function PickRow(p: PickRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pk-item">
      <div className="r">
        <span className="d">{p.date}</span>
        <div>
          <div className="t">{p.pick}</div>
          <div className="s">{p.event}</div>
          <div className="pickacts">
            <button type="button" className="seetweet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide tweet" : "See tweet"}
            </button>
            {p.marketUrl && (
              <a className="seetweet marketlink" href={p.marketUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${p.event} on Gemini (opens in a new tab)`}>
                View market ↗
              </a>
            )}
          </div>
        </div>
        <span className="chip mono pk-price">{p.price}</span>
        {p.result.kind === "chip" ? (
          <span className={`chip pk-res ${p.result.tone}`}>{p.result.text}</span>
        ) : (
          <span className="tag pk-res">{p.result.text}</span>
        )}
      </div>
      {open && (
        <div className="pk-tweet">
          <TweetBubble {...p} />
        </div>
      )}
    </div>
  );
}

function TweetBubble({ handle, tweetText, postedAt, tweetId, pick, price }: PickRowProps) {
  const when = formatTweetTime(postedAt);
  return (
    <article className="pk-bubble" aria-label={`Tweet from @${handle}`}>
      <div className="av" aria-hidden="true">
        {handle.charAt(0).toUpperCase()}
      </div>
      <div className="bub">
        <div className="h">
          <b>@{handle}</b> · {when.full}
        </div>
        <p className="tx">
          <TweetText text={tweetText} />
        </p>
        <div className="f">
          <span>
            We read this as <b>{pick} · {price}</b>
          </span>
          <a href={tweetUrl(tweetId)} target="_blank" rel="noopener noreferrer">
            Open on X ↗
          </a>
        </div>
      </div>
    </article>
  );
}
