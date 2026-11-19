import Page from "./Page";
import Link from "next/link";

export default function SignInPrompt({ title, body }: { title: string; body: string }) {
  return (
    <Page><div className="narrow">
      <h1 style={{ fontSize: 32 }}>{title}</h1>
      <div className="card empty-card">
        <p className="muted">{body}</p>
        <Link href="/signin" className="btn primary" style={{ marginTop: 14 }}>Sign in</Link>
      </div>
    </div></Page>
  );
}
