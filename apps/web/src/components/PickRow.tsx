"use client";

import { TweetCard } from "@copayme/tweet-card";
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

/** One pick. Clicking the row opens the tweet in place, drawn by the same card the extension uses. */
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
          <TweetCard className="inpick" handle={p.handle} text={p.tweetText} postedAt={p.postedAt} tweetId={p.tweetId} />
        </div>
      )}
    </div>
  );
}
