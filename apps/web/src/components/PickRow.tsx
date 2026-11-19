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
      <button type="button" className="seetweet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide tweet" : "See tweet"}
      </button>
      {open && <TweetCard className="inpick" handle={p.handle} text={p.tweetText} postedAt={p.postedAt} tweetId={p.tweetId} />}
    </div>
  );
}
