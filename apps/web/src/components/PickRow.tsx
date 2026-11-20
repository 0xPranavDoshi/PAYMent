"use client";

import { TweetCard } from "@copayme/tweet-card";
import { useState } from "react";

export interface PickRowProps {
  handle: string;
  event: string;
  pick: string;
  result: string;
  tone: "w" | "l" | "muted";
  outcome: string;
  tweetText: string;
  tweetId: string;
  /** The market on Gemini, to check its price and result; omitted when the market is not known. */
  marketUrl?: string;
  /** When it was tweeted, ISO. */
  postedAt: string;
}

/** One pick. "See tweet" opens the tweet in place, drawn by the same card the extension uses. */
export default function PickRow(p: PickRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pick">
      <div className="top">
        <span className="event">{p.event}</span>
        <span className={`res ${p.tone}`}>{p.result}</span>
      </div>
      <div className="sub">
        {p.pick} · {p.outcome}
      </div>
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
      {open && <TweetCard className="inpick" handle={p.handle} text={p.tweetText} postedAt={p.postedAt} tweetId={p.tweetId} />}
    </div>
  );
}
