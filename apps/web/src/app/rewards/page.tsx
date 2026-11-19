import Page from "@/components/Page";
import SignInPrompt from "@/components/SignInPrompt";
import RewardsPanel from "@/components/RewardsPanel";
import { getFollowerId } from "@/lib/session";
import { ocGetEarnings, ocGetUser } from "@/lib/onchain";
import type { AuthUser, EarningsSummary } from "@copayme/shared";

export const metadata = { title: "Rewards · coPAYMe" };

export default async function Rewards() {
  const id = await getFollowerId();
  if (!id) {
    return <SignInPrompt title="Rewards" body="Sign in to connect a wallet and cash out what your calls earn." />;
  }

  let user: AuthUser | null = null;
  let earnings: EarningsSummary | null = null;
  try {
    user = await ocGetUser(id);
    earnings = await ocGetEarnings(id);
  } catch {
    // on-chain service unreachable — fall through to the notice below
  }

  if (!user) {
    return (
      <Page><div className="narrow">
        <h1 className="ptitle">Rewards</h1>
        <div className="card empty-card">
          <p className="muted">We couldn't reach the on-chain service. Start it with <code>pnpm dev:onchain</code> and refresh.</p>
        </div>
      </div></Page>
    );
  }

  return (
    <Page>
      <RewardsPanel user={user} earnings={earnings} />
    </Page>
  );
}
