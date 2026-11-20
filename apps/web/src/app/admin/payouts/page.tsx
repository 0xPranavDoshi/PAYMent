import Page from "@/components/Page";
import PayoutButton from "@/components/PayoutButton";
import { getAdmin } from "@/lib/admin";
import { ocPayoutPreview, ocPayoutRuns, ocTreasury } from "@/lib/onchain";

export const metadata = { title: "Daily payout · coPAYMe" };
export const dynamic = "force-dynamic";

const usd = (n: number, dp = 2) => `$${n.toFixed(dp)}`;

export default async function Payouts() {
  const admin = await getAdmin();
  if (!admin) {
    return (
      <Page><div className="narrow">
        <h1 className="pt">Daily payout</h1>
        <div className="card empty-card">
          <p className="muted">This page is for coPAYMe admins. Sign in with an admin X account.</p>
        </div>
      </div></Page>
    );
  }

  let preview, runs, treasury;
  try {
    [preview, runs, treasury] = await Promise.all([
      ocPayoutPreview(),
      ocPayoutRuns(),
      ocTreasury().catch(() => null),
    ]);
  } catch {
    return (
      <Page><div className="narrow">
        <h1 className="pt">Daily payout</h1>
        <div className="card empty-card">
          <p className="muted">We couldn&apos;t reach the on-chain service. Start it with <code>pnpm dev:onchain</code> and refresh.</p>
        </div>
      </div></Page>
    );
  }

  const ratePct = `${Math.round(preview.feeRate * 10000) / 100}%`;
  const label = preview.alreadyRanToday
    ? "Today's payout already ran"
    : preview.tails === 0
      ? "Nothing to pay out yet"
      : `Run today's payout (${usd(preview.feeCreditedUsdc, 4)} to creators)`;

  return (
    <Page>
      <h1 className="pt">Daily payout</h1>
      <p className="psub">
        {ratePct} of each winning follower trade goes to the pick&apos;s creator — if they opted in before that
        day. Otherwise the treasury keeps it. Every trade is charged once; one run per day ({preview.day} UTC).
      </p>

      <div className="payout">
        <div className="pmain">
          <div className="lbl2">TREASURY BALANCE · PAYS CREATORS&apos; CASH-OUTS</div>
          <div className="amt-big">
            {treasury?.balanceUsdc != null ? treasury.balanceUsdc.toFixed(2) : "—"}
            {treasury?.balanceUsdc != null && <small>USDC</small>}
          </div>
        </div>
        <div className="pstub2">
          <PayoutButton disabled={preview.alreadyRanToday || preview.tails === 0} label={label} />
          <div className="to">{preview.tails} trades · <b>{preview.day} UTC</b></div>
        </div>
      </div>

      <div className="card strip rw-strip">
        <div><span>Trades to process</span><b>{preview.tails}</b></div>
        <div><span>Follower profit</span><b>{usd(preview.followerProfitUsdc)}</b></div>
        <div><span>To creators</span><b className="up">{usd(preview.feeCreditedUsdc, 4)}</b></div>
        <div><span>Treasury keeps</span><b>{usd(preview.feeRetainedUsdc, 4)}</b></div>
      </div>

      <div className="rcols ap-cols">
        <div className="card pane">
          <h3>Today&apos;s preview</h3>
          {preview.lines.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>No new winning trades since the last run.</p>
          ) : (
            <table className="ledger">
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={`${l.creatorId}:${l.credited}`}>
                    <td className="r">
                      @{l.creatorHandle}
                      <div className="ap-sub">{l.tails} trades · {usd(l.followerProfitUsdc)} profit</div>
                    </td>
                    <td className="a">{usd(l.feeUsdc, 4)}</td>
                    <td className="ap-to">{l.credited ? <span className="chip up">CREATOR</span> : <span className="tag">TREASURY</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card pane">
          <h3>Past runs</h3>
          {runs.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>No payouts yet.</p>
          ) : (
            <table className="ledger">
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="r">
                      {r.day}
                      <div className="ap-sub">by @{r.runBy} · {r.tails} trades</div>
                    </td>
                    <td className="a">
                      <span className="up">{usd(r.feeCreditedUsdc, 4)}</span>
                      <div className="ap-sub">treasury {usd(r.feeRetainedUsdc, 4)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Page>
  );
}
