import Link from "next/link";

/** Traders get paid when people copy them. The numbers are the rule currently built into the rewards service. */
export default function RewardsPromo() {
  return (
    <section className="rw" aria-labelledby="rw-h">
      <div>
        <div className="kicker">Rewards</div>
        <h2 id="rw-h">Get paid when people copy your picks</h2>
        <p>
          If you post picks, you can earn from them. Sign in with X, connect a wallet and turn rewards on. Every time a follower
          copies one of your picks, a small share of what they put on it is credited to you. Cash out any time.
        </p>
        <ul className="rw-points">
          <li><b>2%</b> of the amount a follower puts on your pick, with a 1¢ minimum</li>
          <li>Paid in <b>USDC on Arc</b>, Circle&apos;s test network for now</li>
          <li>Copy trades are simulated today, so nothing real moves yet</li>
        </ul>
        <div className="ext-actions">
          <Link href="/rewards" className="btn primary">Set up rewards</Link>
        </div>
      </div>

      <div className="rw-ledger" aria-label="Example earnings">
        <div className="rw-head">
          <span>Example</span>
          <b>+$0.80</b>
        </div>
        {[
          ["A follower copies you with $10", "+$0.20"],
          ["A follower copies you with $25", "+$0.50"],
          ["A follower copies you with $5", "+$0.10"],
        ].map(([what, earned]) => (
          <div className="rw-row" key={what}>
            <span>{what}</span>
            <b>{earned}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
