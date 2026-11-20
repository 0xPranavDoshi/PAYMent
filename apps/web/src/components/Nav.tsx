import Link from "next/link";
import { signOut } from "@/lib/actions";
import { getFollowerId } from "@/lib/session";
import { ocGetUser } from "@/lib/onchain";
import Mark from "./Mark";
import NavLinks from "./NavLinks";
import SearchBox from "./SearchBox";

export default async function Nav() {
  const followerId = await getFollowerId();
  const signedIn = followerId !== null;
  let handle: string | null = null;
  if (followerId) {
    try {
      handle = (await ocGetUser(followerId))?.handle ?? null;
    } catch {
      handle = null;
    }
  }
  const label = handle ? `@${handle}` : "Account";
  const initial = (handle ?? "Account").charAt(0).toUpperCase();
  return (
    <header className="nav">
      <div className="container">
        <Link href="/" className="brand">
          <span className="logo"><Mark /></span>
          <span className="brand-name">coPAYMe</span>
        </Link>
        <SearchBox />
        <NavLinks />
        <div className="spacer" />
        {signedIn ? (
          <form action={signOut}>
            <Link href="/portfolio" className="acct" aria-label="Your portfolio">
              <i>{initial}</i>
              <span>{label}</span>
            </Link>
            <button className="btn sm" type="submit">Sign out</button>
          </form>
        ) : (
          <Link href="/signin" className="btn sm primary">Sign in</Link>
        )}
      </div>
    </header>
  );
}
