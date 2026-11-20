"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser, EarningsSummary } from "@copayme/shared";
import { linkWalletAction, redeemAction, setOptInAction } from "@/lib/onchain-actions";
import { ARC, useWallets, type DiscoveredWallet } from "@/lib/useWallets";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const REASON: Record<string, string> = { copy_reward: "Copy reward", tail_reward: "Tail reward", redeem: "Cashed out" };
const WEEK = 7 * 24 * 60 * 60 * 1000;

export default function RewardsPanel({ user, earnings }: { user: AuthUser; earnings: EarningsSummary | null }) {
  const router = useRouter();
  const { wallets, address, activeName, busy: walletBusy, error: walletErr, connect, disconnect } = useWallets();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const available = earnings?.availableUsdc ?? 0;
  const linked = user.walletAddress;
  const ready = Boolean(linked && user.rewardsOptIn);
  // Rewards earned in the last 7 days (cash-outs are not earnings).
  const week = (earnings?.rows ?? [])
    .filter((r) => r.reason !== "redeem" && Date.now() - new Date(r.createdAt).getTime() <= WEEK)
    .reduce((sum, r) => sum + r.amountUsdc, 0);
  const differs = address && address.toLowerCase() !== linked?.toLowerCase();

  async function act(
    name: string,
    fn: () => Promise<{ ok: boolean; error?: string; amountUsdc?: number }>,
    onOk?: (r: { amountUsdc?: number }) => void,
  ) {
    setBusy(name); setErr(null); setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) { setErr(r.error ?? "Something went wrong."); return; }
      onOk?.(r);
      router.refresh();
    } finally { setBusy(null); }
  }

  async function pick(w: DiscoveredWallet) {
    setPicking(false);
    await connect(w);
  }

  return (
    <>
      <h1 className="pt">Rewards</h1>
      <p className="psub">Earn USDC on Arc every time someone copies or tails one of your picks.</p>

      <div className="payout">
        <div className="pmain">
          <div className="lbl2">AVAILABLE TO CASH OUT</div>
          <div className="amt-big">${available.toFixed(2)}<small>USDC</small></div>
          {week > 0 && <div className="meta2"><span className="chip up">+${week.toFixed(2)} this week</span></div>}
        </div>
        <div className="pstub2">
          {ready ? (
            <>
              <button className="btn primary xl" disabled={busy !== null || available <= 0}
                onClick={() => act("redeem", redeemAction, (r) => setMsg(`Cashed out $${(r.amountUsdc ?? 0).toFixed(2)} to your wallet.`))}>
                {busy === "redeem" ? "Cashing out…" : available > 0 ? "Cash out to wallet" : "Nothing to cash out"}
              </button>
              <div className="to">to <b>{short(linked!)}</b> on Arc</div>
            </>
          ) : (
            <p className="guide">
              {linked ? "Turn on rewards to start earning." : "Connect a wallet and turn on rewards to start earning."}
            </p>
          )}
        </div>
      </div>
      {msg && <p className="rw-note win">{msg}</p>}
      {err && <p className="rw-note loss">{err}</p>}

      <div className="card strip rw-strip">
        <div><span>Earned</span><b>${(earnings?.totalEarnedUsdc ?? 0).toFixed(2)}</b></div>
        <div><span>Cashed out</span><b>${(earnings?.redeemedUsdc ?? 0).toFixed(2)}</b></div>
        <div><span>Rewards</span><b className={user.rewardsOptIn ? "up" : "muted"}>{user.rewardsOptIn ? "On" : "Off"}</b></div>
        <div><span>Wallet</span><b className="wal">{linked ? short(linked) : "—"}</b></div>
      </div>

      <div className="rcols">
        <div className="card pane">
          <h3>Payout wallet {linked && <span className="chip up">Linked</span>}</h3>
          {linked && <div className="addr">{linked}</div>}
          {address && differs && <div className="addr">Connected: {address}</div>}

          {!address || picking ? (
            <div className="wpick">
              {wallets.length === 0 && (
                <p className="muted">No wallet found. Install MetaMask, Rabby, Coinbase, or Brave Wallet.</p>
              )}
              {wallets.map((w) => (
                <button key={w.info.rdns} type="button" onClick={() => pick(w)} disabled={walletBusy}>
                  {w.info.icon ? <img src={w.info.icon} alt="" /> : <span className="ic">◆</span>}
                  <span>{w.info.name}</span>
                  <span className="go">Connect</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="addr">{activeName}: {short(address)}</div>
              <div className="brow">
                {differs && (
                  <button className="btn sm primary" disabled={busy !== null}
                    onClick={() => act("link", () => linkWalletAction(address))}>
                    {busy === "link" ? "Saving…" : linked ? "Use for payouts" : "Link wallet"}
                  </button>
                )}
                <button className="btn sm" onClick={() => setPicking(true)} disabled={walletBusy}>Change wallet</button>
                <button className="btn sm" onClick={disconnect}>Disconnect</button>
              </div>
            </>
          )}
          {walletErr && <p className="rw-note loss">{walletErr}</p>}

          <div className="divider" />
          <h3>
            Earn from your picks
            <button type="button" role="switch" aria-checked={user.rewardsOptIn} aria-label="Earn from your picks"
              className={`tgl${user.rewardsOptIn ? "" : " off"}`}
              disabled={busy !== null || (!linked && !user.rewardsOptIn)}
              onClick={() => act("optin", () => setOptInAction(!user.rewardsOptIn))}>
              <i />
            </button>
          </h3>
          <p className="tgl-note">
            {user.rewardsOptIn ? "On. You get 2% of every copied or tailed pick, at least 1¢ each." : "Off. Turn on to get 2% of every copied or tailed pick, at least 1¢ each."}
          </p>
        </div>

        <div className="card pane">
          <h3>Activity</h3>
          {!earnings || earnings.rows.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>Nothing yet. Rewards appear here when someone tails your calls.</p>
          ) : (
            <table className="ledger">
              <tbody>
                {earnings.rows.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td className="d">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}</td>
                    <td className="r">{REASON[r.reason] ?? r.reason.replace(/_/g, " ")}</td>
                    <td className={`a${r.amountUsdc >= 0 ? " up" : ""}`}>
                      {r.amountUsdc >= 0 ? "+" : "−"}${Math.abs(r.amountUsdc).toFixed(2)}
                    </td>
                    <td className="x">
                      {r.txHash ? <a href={`${ARC.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer">tx ↗</a> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="sech"><h2 className="h2">How you earn</h2></div>
      <div className="earn">
        <div className="card"><b>2%</b><p>of every pick someone copies or tails from you, paid in USDC.</p></div>
        <div className="card"><b>1¢</b><p>minimum per pick, so even a $1 tail shows up in your balance.</p></div>
        <div className="card"><b>Any time</b><p>Cash out to your linked wallet on Arc whenever you like. No minimum.</p></div>
      </div>
    </>
  );
}
