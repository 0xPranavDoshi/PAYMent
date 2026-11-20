import Page from "@/components/Page";
import Link from "next/link";
import { fetchCopyTrades, fetchTails } from "@/lib/api";
import { formatSignedPct, formatUsd, shortDate, tone } from "@/lib/format";
import { getFollowerId } from "@/lib/session";
import PnlChart from "@/components/PnlChart";
import { CopyTradeToggle } from "@/components/CopyTicket";
import SignInPrompt from "@/components/SignInPrompt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio · coPAYMe" };

export default async function PortfolioPage() {
  const followerId = await getFollowerId();
  if (!followerId) return <SignInPrompt title="Your portfolio" body="Sign in to see the trades you have copied and how they are doing." />;

  let tails: Awaited<ReturnType<typeof fetchTails>> = [];
  let copies: Awaited<ReturnType<typeof fetchCopyTrades>> = [];
  let error: string | null = null;
  try {
    [tails, copies] = await Promise.all([fetchTails(followerId), fetchCopyTrades(followerId)]);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load your portfolio.";
  }

  const pnlOf = (t: (typeof tails)[number]) => t.pnlUsdc ?? t.unrealizedPnlUsdc ?? 0;
  const total = tails.reduce((s, t) => s + pnlOf(t), 0);
  const invested = tails.reduce((s, t) => s + t.amountUsdc, 0);
  const open = tails.filter((t) => t.status !== "settled" && t.status !== "cancelled");
  const settled = tails.filter((t) => t.status === "settled");
  const wins = settled.filter((t) => (t.pnlUsdc ?? 0) > 0).length;

  let running = 0;
  const points = [...tails]
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))
    .map((t) => {
      running += pnlOf(t);
      return { label: t.createdAt ? shortDate(t.createdAt) : "", cumulative: Number(running.toFixed(2)) };
    });

  return (
    <Page>
      <h1 className="ptitle">Portfolio</h1>
      <p className="psub">
        Trades from the traders you copy and watch.
      </p>

      {error ? (
        <p className="down" style={{ marginTop: 20 }}>{error}</p>
      ) : (
        <>
          <div className="stats">
            <div><b className={tone(total)}>{formatUsd(total)}</b><span>Total P&amp;L</span></div>
            <div><b className={tone(invested > 0 ? total : null)}>{invested > 0 ? formatSignedPct((total / invested) * 100) : "–"}</b><span>Return</span></div>
            <div><b>{open.length}</b><span>Open trades</span></div>
            <div><b>{settled.length === 0 ? "–" : `${wins}–${settled.length - wins}`}</b><span>Settled (W–L)</span></div>
          </div>

          {points.length > 1 && (
            <section className="section">
              <h2 className="sect">Profit and loss</h2>
              <div className="card" style={{ marginTop: 14 }}>
                <PnlChart points={points} />
              </div>
            </section>
          )}

          <section className="section">
            <h2 className="sect">Copy trading</h2>
            <div className="board">
              {copies.length === 0 ? (
                <div className="empty">You are not copying anyone yet. Pick a trader from the <Link href="/leaderboard" className="u">leaderboard</Link>.</div>
              ) : (
                copies.map((c) => (
                  <div className="wrow" key={c.traderHandle}>
                    <div className="wmain">
                      <Link href={`/traders/${encodeURIComponent(c.traderHandle)}`} className="who">@{c.traderHandle}</Link>
                      <div className="wsub">
                        {c.active ? `${formatUsd(c.amountUsdc, false)} per pick` : "Paused"} · {c.nTrades} trade{c.nTrades === 1 ? "" : "s"} since {shortDate(c.createdAt)}
                      </div>
                    </div>
                    <div className="wpnl">
                      <b className={tone(c.livePnlUsdc)}>{c.livePnlUsdc === null ? "–" : formatUsd(c.livePnlUsdc)}</b>
                      <small className="muted">P&amp;L</small>
                    </div>
                    <div className="wact"><CopyTradeToggle handle={c.traderHandle} copy={{ active: c.active, amountUsdc: c.amountUsdc, since: c.createdAt }} signedIn nPicks={0} ticketPlacement="inline" /></div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="section">
            <h2 className="sect">Trades</h2>
            <div className="board">
              {tails.length === 0 ? (
                <div className="empty">No trades yet. They appear when a trader you copy or watch posts a new pick.</div>
              ) : (
                tails.map((t) => {
                  const pnl = pnlOf(t);
                  const done = t.status === "settled";
                  return (
                    <div className="trow" key={t.tailId}>
                      <div className="tmain">
                        <div className="event">{t.eventName ?? "Trade"}</div>
                        <div className="wsub">
                          {t.traderHandle ? <>@{t.traderHandle} · </> : null}
                          {t.pickLabel ?? ""}{t.side ? ` · ${t.side.toUpperCase()}` : ""} · bought at {Math.round(t.entryOdds * 100)}¢
                          {!done && t.markPrice != null ? <> · now {Math.round(t.markPrice * 100)}¢</> : null}
                        </div>
                      </div>
                      <span className={`chip ${done ? (pnl > 0 ? "up" : pnl < 0 ? "down" : "") : ""}`}>{done ? (pnl > 0 ? "Won" : pnl < 0 ? "Lost" : "Settled") : "Open"}</span>
                      <div className="wpnl">
                        <b className={tone(pnl)}>{formatUsd(pnl)}</b>
                        <small className="muted">{formatSignedPct((pnl / t.amountUsdc) * 100)} on {formatUsd(t.amountUsdc, false)}</small>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </>
      )}
    </Page>
  );
}
