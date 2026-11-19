import Link from "next/link";
import { signOut } from "@/lib/actions";
import { getFollowerId } from "@/lib/session";
import Mark from "./Mark";
import NavLinks from "./NavLinks";

export default async function Nav() {
  const signedIn = (await getFollowerId()) !== null;
  return (
    <header className="nav">
      <div className="container">
        <Link href="/" className="brand">
          <span className="logo"><Mark /></span>
          coPAYMe
        </Link>
        <NavLinks />
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
