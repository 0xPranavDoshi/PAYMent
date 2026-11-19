import Link from "next/link";
import Mark from "./Mark";

export default function Nav() {
  return (
    <header className="nav">
      <div className="container">
        <Link href="/" className="brand">
          <Mark />
          coPAYMe
        </Link>
        <div className="spacer" />
        <Link href="/leaderboard" className="link">Leaderboard</Link>
        <Link href="/how-scoring" className="link hide-sm">How scoring works</Link>
        <Link href="/watchlist" className="link">Watchlist</Link>
        <Link href="/activity" className="link hide-sm">Activity</Link>
      </div>
    </header>
  );
}
