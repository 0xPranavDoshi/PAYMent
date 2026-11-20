import Link from "next/link";

/** The hero call-to-action pair. The install button waits for a store listing. */
export default function ExtensionPromo() {
  return (
    <div className="hm-cta">
      <button className="btn primary lg" type="button" disabled>Add to Chrome</button>
      <Link href="/leaderboard" className="btn lg">See the leaderboard</Link>
      <small>Coming soon</small>
    </div>
  );
}
