import Page from "@/components/Page";
import { marketUrl } from "@copayme/shared/market";
import Link from "next/link";
import { fetchCopyTrades, fetchLeaderboard, fetchTails } from "@/lib/api";
import { formatSignedPct, formatUsd, shortDate, tone } from "@/lib/format";
import { getFollowerId } from "@/lib/session";
import PnlChart from "@/components/PnlChart";
import PortfolioCopies from "@/components/PortfolioCopies";
import SignInPrompt from "@/components/SignInPrompt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio · coPAYMe" };

export default async function PortfolioPage() {
  const followerId = await getFollowerId();
  if (!followerId) return <SignInPrompt title="Your portfolio" body="Sign in to see the trades you have copied and how they are doing." />;

  // Only trades placed by copy trading. Watching a trader also records $1 tracking trades (they feed the
  // Watchlist's projected P&L), but those are not trades you are making and do not belong here.
  let tails: Awaited<ReturnType<typeof fetchTails>> = [];
  let copies: Awaited<ReturnType<typeof fetchCopyTrades>> = [];
  let error: string | null = null;
  const board = await fetchLeaderboard().catch(() => []);
  const byHandle = new Map(board.map((e) => [e.handle.toLowerCase(), e]));
  try {
    [tails, copies] = await Promise.all([fetchTails(followerId, "copy"), fetchCopyTrades(followerId)]);
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
      return { label: t.createdAt ? shortDate(t.createdAt) : "", cumulative: Number(running.toFixed(2)), at: t.createdAt ?? undefined, amount: t.amountUsdc };
    });

  return (
    <Page live>
      <h1 className="pt">Portfolio</h1>
      <p className="psub">Trades from the traders you copy.</p>

      {error ? (
        <p className="down" style={{ marginTop: 20 }}>{error}</p>
      ) : (
        <>
          <div className="card strip" style={{ marginTop: 28, background: "var(--surface)" }}>
            <div><span>Total P&amp;L</span><b className={tone(total)}>{formatUsd(total)}</b></div>
            <div><span>Return</span><b className={tone(invested > 0 ? total : null)}>{invested > 0 ? formatSignedPct((total / invested) * 100) : "–"}</b></div>
            <div><span>Open trades</span><b>{open.length}</b></div>
            <div>
              <span>Settled W–L</span>
              <b>{settled.length === 0 ? "–" : <><span className="up">{wins}</span>–<span className="down">{settled.length - wins}</span></>}</b>
            </div>
          </div>

          {points.length > 1 && (
            <>
              <div className="sech"><h2 className="h2">Profit and loss</h2></div>
              <PnlChart points={points} />
            </>
          )}

          <div className="sech"><h2 className="h2">Copy trading</h2></div>
          {copies.length === 0 ? (
            <div className="card hm-rows pf-rows"><div className="empty">You are not copying anyone yet. Pick a trader from the <Link href="/leaderboard" className="u">leaderboard</Link>.</div></div>
          ) : (
            <PortfolioCopies
              viewerId={followerId}
              rows={copies.map((c) => {
                const e = byHandle.get(c.traderHandle.toLowerCase());
                return {
                  handle: c.traderHandle,
                  score: e && e.tier !== "new" ? e.score : null,
                  nPicks: e?.nResolved ?? 0,
                  active: c.active,
                  amountUsdc: c.amountUsdc,
                  nTrades: c.nTrades,
                  createdAt: c.createdAt,
                  pnl: c.livePnlUsdc,
                };
              })}
            />
          )}

          <div className="sech"><h2 className="h2">Trades</h2></div>
          <div className="card hm-rows pf-rows">
            {tails.length === 0 ? (
              <div className="empty">No trades yet. They appear when a trader you copy posts a new pick.</div>
            ) : (
              tails.map((t, i) => {
                const pnl = pnlOf(t);
                const done = t.status === "settled";
                return (
                  <div className={`r${i === 0 ? " flush" : ""}`} key={t.tailId}>
                    <div>
                      <div className="t">
                        {t.eventName ?? "Trade"}
                        {t.marketTicker && (
                          <a className="marketlink" href={marketUrl(t.marketTicker)} target="_blank" rel="noopener noreferrer" aria-label={`View ${t.eventName ?? "this market"} on Gemini (opens in a new tab)`}>
                            View market ↗
                          </a>
                        )}
                      </div>
                      <div className="s mono">
                        {t.traderHandle ? `@${t.traderHandle} · ` : ""}
                        {t.pickLabel ?? ""}{t.side ? ` · ${t.side.toUpperCase()}` : ""} · bought {Math.round(t.entryOdds * 100)}¢
                        {!done && t.markPrice != null ? ` · now ${Math.round(t.markPrice * 100)}¢` : ""}
                      </div>
                    </div>
                    <span className={`chip ${done ? (pnl > 0 ? "up" : pnl < 0 ? "down" : "") : ""}`}>{done ? (pnl > 0 ? "Won" : pnl < 0 ? "Lost" : "Settled") : "Open"}</span>
                    <div className="pnl">
                      <b className={tone(pnl)}>{formatUsd(pnl)}</b>
                      <small>{formatSignedPct((pnl / t.amountUsdc) * 100)} on {formatUsd(t.amountUsdc, false)}</small>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </Page>
  );
}
