import Link from "next/link";
import { signOut } from "@/lib/actions";
import { getFollowerId } from "@/lib/session";
import Mark from "./Mark";

export default async function Nav() {
  const signedIn = (await getFollowerId()) !== null;
  return (
    <header className="nav">
      <div className="container">
        <Link href="/" className="brand">
          <Mark />
          coPAYMe
        </Link>
        <nav className="links" aria-label="Main">
          <Link href="/leaderboard" className="link">Leaderboard</Link>
          <Link href="/watchlist" className="link">Watchlist</Link>
          <Link href="/portfolio" className="link">Portfolio</Link>
          <Link href="/how-scoring" className="link hide-sm">How it works</Link>
        </nav>
        <div className="spacer" />
        {signedIn ? (
          <form action={signOut}>
            <button className="btn sm" type="submit">Sign out</button>
          </form>
        ) : (
          <Link href="/signin" className="btn sm primary">Sign in</Link>
        )}
      </div>
    </header>
  );
}
