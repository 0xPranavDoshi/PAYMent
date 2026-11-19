import Page from "@/components/Page";
import { signInDemo, signInWithId } from "@/lib/actions";

export const metadata = { title: "Sign in · coPAYMe" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const demoConfigured = Boolean(process.env.DEFAULT_FOLLOWER_ID);
  return (
    <Page><div className="narrow">
      <h1 style={{ fontSize: 32 }}>Sign in</h1>
      <p className="muted" style={{ marginTop: 8 }}>Sign in to keep a watchlist and copy traders.</p>

      <div className="card" style={{ marginTop: 24 }}>
        <button className="btn" disabled style={{ width: "100%", justifyContent: "center" }}>
          Continue with X
          <span className="chip" style={{ marginLeft: 6 }}>Coming soon</span>
        </button>
        <p className="fine" style={{ marginTop: 10 }}>
          X login is not available yet. Until it is, use the demo account below.
        </p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <form action={signInDemo}>
          <button className="btn primary" type="submit" disabled={!demoConfigured} style={{ width: "100%", justifyContent: "center" }}>
            Continue as demo user
          </button>
        </form>
        {!demoConfigured && <p className="fine" style={{ marginTop: 10 }}>No demo user is set up on this server (DEFAULT_FOLLOWER_ID).</p>}
        {error === "demo" && <p className="fine bad" style={{ marginTop: 10 }}>The demo user is not configured correctly.</p>}
      </div>

      <details style={{ marginTop: 18 }}>
        <summary className="muted" style={{ cursor: "pointer", fontSize: 14 }}>Developer: sign in with a user id</summary>
        <form action={signInWithId} className="card" style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <input name="userId" className="field" placeholder="00000000-0000-0000-0000-000000000000" aria-label="User id" />
          <button className="btn sm" type="submit" style={{ justifySelf: "start" }}>Use this id</button>
          {error === "id" && <p className="fine bad">That is not a valid user id.</p>}
        </form>
      </details>
    </div></Page>
  );
}
