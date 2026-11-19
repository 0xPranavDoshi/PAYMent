import Page from "@/components/Page";
export const metadata = { title: "How scoring works · coPAYMe" };

export default function HowScoring() {
  return (
    <Page><div className="prose">
      <h1 className="ptitle">How scoring works</h1>
      <p>The score answers one question: does this person beat the market, or just pick favourites?</p>

      <h2>Points per pick</h2>
      <p>
        When a trader tweets a pick, we record the market&apos;s price for it at that moment. A $1 contract bought at
        that price pays $1 if the pick wins. So a pick earns <span className="formula">outcome − price</span>.
      </p>
      <ul>
        <li>Win a 85¢ favourite: <code>+15¢</code>. Lose it: <code>−85¢</code>.</li>
        <li>Win a 35¢ underdog: <code>+65¢</code>.</li>
      </ul>
      <p>Someone who wins exactly as often as the odds say averages zero, however high their hit rate looks.</p>

      <h2>Shrinking small samples</h2>
      <p>
        A few lucky picks should not top the board. We add 10 phantom picks worth zero points to every record, so a
        short streak counts for little and a long track record counts for a lot.
      </p>

      <h2>From points to a score</h2>
      <p>
        The average is mapped onto 0 to 100 with <span className="formula">50 + 50 · tanh(edge / 0.15)</span>. A score
        of 50 means no edge over the market; a sustained 15¢ edge per pick is about 88.
      </p>

      <h2>New traders</h2>
      <p>Until a trader has 5 resolved picks they show as New instead of a number.</p>

      <h2>What counts</h2>
      <ul>
        <li>Only picks on markets we can price at the time of the tweet are scored.</li>
        <li>If the same pick is tweeted twice, the earlier tweet counts.</li>
        <li>Voided markets are left out.</li>
      </ul>
      <div className="callout">
        The 14-day arrow beside a score compares it with the score two weeks ago, and only shows for changes of 2 points or more.
      </div>
    </div></Page>
  );
}
