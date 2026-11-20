import { TweetCard } from "@copayme/tweet-card";
import Link from "next/link";
import { scoreHue } from "@/lib/format";
import Mark from "./Mark";

/** What the extension does, shown as the tweet it decorates, with a way to install it today. */
export default function ExtensionPromo() {
  return (
    <section className="ext" aria-labelledby="ext-h">
      <div>
        <div className="kicker">The extension</div>
        <h2 id="ext-h">See the score where you read the picks</h2>
        <p>
          The coPAYMe extension puts a score badge beside every handle on X. Click it for their record and every pick, then
          watch or copy them without leaving the timeline.
        </p>
        <div className="ext-actions">
          <Link href="/extension" className="btn primary">Install the extension</Link>
          <a className="muted" href="/coPAYMe-extension.zip" download style={{ fontSize: 13 }}>or download the .zip</a>
        </div>
      </div>
      <TweetCard
        className="demo"
        handle="sharp_example"
        text="Bucks −3.5 tonight. Their defence has been the story all week."
        postedAt={new Date(Date.now() - 3 * 3_600_000).toISOString()}
        tweetId="0"
        afterName={
          <span className="xbadge" style={{ ["--h" as string]: scoreHue(82) }}>
            <Mark />
            82
            <i>▲ 16</i>
          </span>
        }
      />
    </section>
  );
}
