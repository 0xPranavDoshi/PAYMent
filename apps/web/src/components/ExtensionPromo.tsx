import { scoreHue } from "@/lib/format";
import Mark from "./Mark";

/** What the extension does, shown as the tweet it decorates. The install button waits for a store listing. */
export default function ExtensionPromo() {
  return (
    <section className="ext" aria-labelledby="ext-h">
      <div>
        <h2 id="ext-h">See the score where you read the picks</h2>
        <p>
          The coPAYMe extension puts a score badge beside every handle on X. Click it for their record and every pick, then
          watch or copy them without leaving the timeline.
        </p>
        <div className="ext-actions">
          <button className="btn" type="button" disabled>Add to Chrome</button>
          <span className="muted" style={{ fontSize: 13 }}>Coming soon</span>
        </div>
      </div>
      <article className="xtweet demo" aria-label="Example tweet with a coPAYMe badge">
        <div className="xt-av" aria-hidden="true">S</div>
        <div className="xt-body">
          <div className="xt-head">
            <b>@sharp_example</b>
            <span className="xbadge" style={{ ["--h" as string]: scoreHue(82) }}>
              <Mark />
              82
              <i>▲ 16</i>
            </span>
            <span>· 3h</span>
          </div>
          <p>Bucks −3.5 tonight. Their defence has been the story all week.</p>
        </div>
      </article>
    </section>
  );
}
