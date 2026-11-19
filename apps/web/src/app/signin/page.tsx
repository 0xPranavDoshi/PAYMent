import Page from "@/components/Page";
import { signInWithId } from "@/lib/actions";

export const metadata = { title: "Sign in · coPAYMe" };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <Page><div className="narrow">
      <h1 className="ptitle">Sign in</h1>
      <p className="psub">Sign in with X to track your calls and cash out your rewards.</p>

      <div className="card" style={{ marginTop: 24 }}>
        <a className="btn primary" href="/api/auth/x/login" style={{ width: "100%", justifyContent: "center" }}>
          Continue with X
        </a>
        {error === "x" && <p className="fine bad" style={{ marginTop: 10 }}>X sign-in didn&apos;t complete. Try again.</p>}
        {error === "x_unconfigured" && (
          <p className="fine bad" style={{ marginTop: 10 }}>X login isn&apos;t configured on this server yet.</p>
        )}
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
