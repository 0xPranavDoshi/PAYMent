import Page from "@/components/Page";
import ScoreCurve from "@/components/ScoreCurve";
import ScoreTile from "@/components/ScoreTile";
export const metadata = { title: "How scoring works · coPAYMe" };

const TOC = ["Points per pick", "Small samples", "Points to score", "New traders", "What counts"];

/** A row of record squares: w = win, l = loss, p = phantom pick. */
function Squares({ seq, cols, gap }: { seq: string; cols: number; gap?: number }) {
  return (
    <div className="sqg" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, ...(gap ? { gap } : null) }} aria-hidden="true">
      {[...seq].map((c, i) => <i key={i} className={c} />)}
    </div>
  );
}

const STEADY = "wwwwwwllllwwwwwwwlllwwwwwwllllwwwwwwwlll" + "p".repeat(10);

export default function HowScoring() {
  return (
    <Page>
      <div className="hw-hero">
        <h1>How scoring works</h1>
        <p>The score answers one question: does this person <mark>beat the market</mark>, or just pick favourites?</p>
        <div className="toc">
          {TOC.map((t, i) => <span key={t}><b>{String(i + 1).padStart(2, "0")}</b>{t}</span>)}
        </div>
      </div>

      <section className="hsec">
        <div>
          <span className="n">1</span>
          <h2>Points per pick</h2>
          <p>
            When a trader tweets a pick, we record the market&apos;s price for it at that moment. A $1 contract bought at
            that price pays <b>$1</b> if the pick wins. So a pick earns <span className="formula">outcome <em>−</em> price</span>.
          </p>
          <p>Someone who wins exactly as often as the odds say averages <b>zero</b>, however high their hit rate looks.</p>
        </div>
        <div className="card vis">
          <div className="contract">
            <div className="ct"><span>Favourite at 85¢</span><span className="mono">$1 contract</span></div>
            <div className="bar"><span className="paid" style={{ width: "85%" }}>paid 85¢</span><span className="gain" style={{ width: "15%" }}>15¢</span></div>
            <div className="res"><span className="chip up">WIN +15¢</span><span className="chip down">LOSE −85¢</span></div>
          </div>
          <div className="contract">
            <div className="ct"><span>Underdog at 35¢</span><span className="mono">$1 contract</span></div>
            <div className="bar"><span className="paid" style={{ width: "35%" }}>paid 35¢</span><span className="gain" style={{ width: "65%" }}>+65¢ if it wins</span></div>
            <div className="res"><span className="chip up">WIN +65¢</span><span className="chip down">LOSE −35¢</span></div>
          </div>
        </div>
      </section>

      <section className="hsec">
        <div>
          <span className="n">2</span>
          <h2>Shrinking small samples</h2>
          <p>
            A few lucky picks should not top the board. We add <b>10 phantom picks worth zero points</b> to every record, so a
            short streak counts for little and a long track record counts for a lot.
          </p>
        </div>
        <div className="card vis">
          <div className="who2">3 lucky wins <span>avg +50¢ → +11.5¢ after shrinking</span></div>
          <Squares seq={"www" + "p".repeat(10)} cols={13} />
          <div className="who2" style={{ marginTop: 20 }}>40 picks, steady edge <span>avg +15¢ → +12¢ after shrinking</span></div>
          <Squares seq={STEADY} cols={25} gap={4} />
          <div className="legend2">
            <span><i style={{ background: "#2fbf6b" }} />Win</span>
            <span><i style={{ background: "#ff6b57" }} />Loss</span>
            <span><i style={{ borderStyle: "dashed", borderColor: "rgba(17,17,17,.45)" }} />Phantom pick (0 points)</span>
          </div>
        </div>
      </section>

      <section className="hsec">
        <div>
          <span className="n">3</span>
          <h2>From points to a score</h2>
          <p>
            The average is mapped onto 0 to 100. A score of <b>50</b> means no edge over the market; a sustained <b>15¢ edge per pick</b> is about <b>88</b>.
          </p>
          <div className="formula">score = 50 + 50 · tanh(edge <em>/</em> 0.15)</div>
        </div>
        <div className="card vis"><ScoreCurve /></div>
      </section>

      <section className="hsec">
        <div>
          <span className="n">4</span>
          <h2>New traders</h2>
          <p>Until a trader has <b>5 resolved picks</b> they show as <b>New</b> instead of a number.</p>
        </div>
        <div className="card vis new-flow">
          <ScoreTile score={null} size="sm" />
          <span className="arrow" aria-hidden="true">→</span>
          <span className="mono step">5 resolved picks</span>
          <span className="arrow" aria-hidden="true">→</span>
          <ScoreTile score={47} size="sm" />
        </div>
      </section>

      <section className="hsec">
        <div>
          <span className="n">5</span>
          <h2>What counts</h2>
        </div>
        <div className="checks">
          <div><i className="y">✓</i>Only picks on markets we can price at the time of the tweet are scored.</div>
          <div><i className="y">✓</i>If the same pick is tweeted twice, the earlier tweet counts.</div>
          <div><i className="n">✕</i>Voided markets are left out.</div>
        </div>
      </section>

      <div className="callout2">
        <span className="chip up">▲ 16</span>
        <span>The 14-day arrow beside a score compares it with the score two weeks ago, and only shows for changes of 2 points or more.</span>
      </div>
    </Page>
  );
}
