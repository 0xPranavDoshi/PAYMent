"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser, EarningsSummary } from "@copayme/shared";
import { linkWalletAction, redeemAction, setOptInAction } from "@/lib/onchain-actions";
import { ARC, useWallets, type DiscoveredWallet } from "@/lib/useWallets";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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
      <div className="thead">
        <div className="avatar">{user.handle.slice(0, 1).toUpperCase()}</div>
        <div>
          <h1>@{user.handle}</h1>
          <div className="meta"><span className="chip">Signed in</span>Rewards paid in USDC on Arc</div>
        </div>
      </div>

      {/* Hero: available to cash out */}
      <div className="card" style={{ marginTop: 24 }}>
        <div className="rw-hero">
          <div>
            <span className="muted" style={{ fontSize: 13 }}>Available to cash out</span>
            <div className="rw-amt">${available.toFixed(2)}</div>
          </div>
          {ready ? (
            <button className="btn primary lg" disabled={busy !== null || available <= 0}
              onClick={() => act("redeem", redeemAction, (r) => setMsg(`Cashed out $${(r.amountUsdc ?? 0).toFixed(2)} to your wallet.`))}>
              {busy === "redeem" ? "Cashing out…" : available > 0 ? "Cash out to wallet" : "Nothing to cash out"}
            </button>
          ) : (
            <span className="muted" style={{ fontSize: 14, maxWidth: 220 }}>
              {linked ? "Turn on rewards to start earning." : "Connect a wallet and turn on rewards to start earning."}
            </span>
          )}
        </div>
        {msg && <p className="fine" style={{ color: "var(--win)", marginTop: 12 }}>{msg}</p>}
        {err && <p className="fine" style={{ color: "var(--coral)", marginTop: 12 }}>{err}</p>}
      </div>

      {/* Stats */}
      <div className="stats">
        <div><span>Earned</span><b className="num">${(earnings?.totalEarnedUsdc ?? 0).toFixed(2)}</b></div>
        <div><span>Cashed out</span><b className="num">${(earnings?.redeemedUsdc ?? 0).toFixed(2)}</b></div>
        <div><span>Rewards</span><b style={{ color: user.rewardsOptIn ? "var(--win)" : "var(--ink-3)" }}>{user.rewardsOptIn ? "On" : "Off"}</b></div>
        <div><span>Wallet</span><b className="num">{linked ? short(linked) : "—"}</b></div>
      </div>

      {/* Two columns: wallet + rewards | activity */}
      <div className="rw-cols">
        <div className="card">
          <div className="rw-row">
            <h2 style={{ fontSize: 18 }}>Payout wallet</h2>
            {linked && <span className="chip up">Linked</span>}
          </div>
          {linked && <p className="muted num" style={{ fontSize: 13, marginTop: 10, wordBreak: "break-all" }}>{linked}</p>}
          {address && differs && <p className="muted num" style={{ fontSize: 13, marginTop: 6, wordBreak: "break-all" }}>Connected: {address}</p>}

          {!address || picking ? (
            <div className="wallets">
              {wallets.length === 0 && (
                <p className="muted" style={{ fontSize: 13 }}>No wallet found. Install MetaMask, Rabby, Coinbase, or Brave Wallet.</p>
              )}
              {wallets.map((w) => (
                <button key={w.info.rdns} className="wallet-btn" onClick={() => pick(w)} disabled={walletBusy}>
                  {w.info.icon ? <img src={w.info.icon} alt="" /> : <span className="dot">◆</span>}
                  <span>{w.info.name}</span>
                  <span className="muted" style={{ marginLeft: "auto", fontSize: 12 }}>Connect</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div className="rw-row">
                <span className="num" style={{ fontSize: 13 }}>{activeName}: {short(address)}</span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                {differs && (
                  <button className="btn sm primary" disabled={busy !== null}
                    onClick={() => act("link", () => linkWalletAction(address))}>
                    {busy === "link" ? "Saving…" : linked ? "Use for payouts" : "Link wallet"}
                  </button>
                )}
                <button className="btn sm" onClick={() => setPicking(true)} disabled={walletBusy}>Change wallet</button>
                <button className="btn sm" onClick={disconnect}>Disconnect</button>
              </div>
            </div>
          )}
          {walletErr && <p className="fine" style={{ color: "var(--coral)", marginTop: 10 }}>{walletErr}</p>}

          <div className="rw-row" style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
            <div>
              <h2 style={{ fontSize: 18 }}>Rewards</h2>
              <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {user.rewardsOptIn ? "On — you earn when people tail your calls." : "Turn on to earn from your calls."}
              </p>
            </div>
            <button className={`btn sm ${user.rewardsOptIn ? "" : "primary"}`}
              disabled={busy !== null || (!linked && !user.rewardsOptIn)}
              onClick={() => act("optin", () => setOptInAction(!user.rewardsOptIn))}>
              {busy === "optin" ? "…" : user.rewardsOptIn ? "Turn off" : "Turn on"}
            </button>
          </div>
        </div>

        <div className="card">
          <h2 style={{ fontSize: 18 }}>Activity</h2>
          {!earnings || earnings.rows.length === 0 ? (
            <p className="muted" style={{ fontSize: 14, marginTop: 12 }}>Nothing yet. Rewards appear here when someone tails your calls.</p>
          ) : (
            <table className="led" style={{ marginTop: 8 }}>
              <tbody>
                {earnings.rows.slice(0, 8).map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                    <td style={{ textTransform: "capitalize" }}>{r.reason.replace(/_/g, " ")}</td>
                    <td className="num" style={{ textAlign: "right", fontWeight: 600, color: r.amountUsdc >= 0 ? "var(--win)" : "var(--ember)" }}>
                      {r.amountUsdc >= 0 ? "+" : "−"}${Math.abs(r.amountUsdc).toFixed(2)}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {r.txHash ? <a className="muted" style={{ fontSize: 12 }} href={`${ARC.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer">tx ↗</a> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
