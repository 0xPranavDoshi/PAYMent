"use client";

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
  short: string;
  full: string;
}

/** One pick. "See tweet" opens the tweet in place, drawn the way X draws it. */
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
      {open && (
        <article className="xtweet" aria-label={`Tweet from @${p.handle}`}>
          <div className="xt-av" aria-hidden="true">{p.handle[0]?.toUpperCase()}</div>
          <div className="xt-body">
            <div className="xt-head">
              <b>@{p.handle}</b>
              <span>· {p.short}</span>
            </div>
            <p>{p.tweetText}</p>
            <div className="xt-time">{p.full}</div>
            <a href={`https://x.com/i/status/${encodeURIComponent(p.tweetId)}`} target="_blank" rel="noopener noreferrer">
              Open on X ↗
            </a>
          </div>
        </article>
      )}
    </div>
  );
}
