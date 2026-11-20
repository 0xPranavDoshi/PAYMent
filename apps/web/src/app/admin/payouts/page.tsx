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
        <h1 className="ptitle">Daily payout</h1>
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
        <h1 className="ptitle">Daily payout</h1>
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
      <h1 className="ptitle">Daily payout</h1>
      <p className="psub">
        {ratePct} of each winning follower trade goes to the pick&apos;s creator — if they opted in before that
        day. Otherwise the treasury keeps it. Every trade is charged once; one run per day ({preview.day} UTC).
      </p>

      <div className="stats">
        <div><span>Trades to process</span><b className="num">{preview.tails}</b></div>
        <div><span>Follower profit</span><b className="num">{usd(preview.followerProfitUsdc)}</b></div>
        <div><span>To creators</span><b className="num" style={{ color: "var(--win)" }}>{usd(preview.feeCreditedUsdc, 4)}</b></div>
        <div><span>Treasury keeps</span><b className="num">{usd(preview.feeRetainedUsdc, 4)}</b></div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="rw-hero">
          <div>
            <span className="muted" style={{ fontSize: 13 }}>Treasury balance (pays creators&apos; cash-outs)</span>
            <div className="num" style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>
              {treasury?.balanceUsdc != null ? `${treasury.balanceUsdc.toFixed(2)} USDC` : "—"}
            </div>
          </div>
          <PayoutButton disabled={preview.alreadyRanToday || preview.tails === 0} label={label} />
        </div>
      </div>

      <div className="rw-cols">
        <div className="card">
          <h2 style={{ fontSize: 18 }}>Today&apos;s preview</h2>
          {preview.lines.length === 0 ? (
            <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>No new winning trades since the last run.</p>
          ) : (
            <table className="led" style={{ marginTop: 8 }}>
              <tbody>
                {preview.lines.map((l) => (
                  <tr key={`${l.creatorId}:${l.credited}`}>
                    <td>@{l.creatorHandle}<div className="muted" style={{ fontSize: 12 }}>{l.tails} trades · {usd(l.followerProfitUsdc)} profit</div></td>
                    <td className="num" style={{ textAlign: "right", fontWeight: 600 }}>{usd(l.feeUsdc, 4)}</td>
                    <td style={{ textAlign: "right" }}>
                      {l.credited ? <span className="chip up">Creator</span> : <span className="chip">Treasury</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: 18 }}>Past runs</h2>
          {runs.length === 0 ? (
            <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>No payouts yet.</p>
          ) : (
            <table className="led" style={{ marginTop: 8 }}>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.day}<div className="muted" style={{ fontSize: 12 }}>by @{r.runBy} · {r.tails} trades</div></td>
                    <td className="num" style={{ textAlign: "right" }}>
                      <span style={{ color: "var(--win)", fontWeight: 600 }}>{usd(r.feeCreditedUsdc, 4)}</span>
                      <div className="muted" style={{ fontSize: 12 }}>treasury {usd(r.feeRetainedUsdc, 4)}</div>
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
