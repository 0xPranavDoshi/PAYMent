"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUser, EarningsSummary } from "@copayme/shared";
import { linkWalletAction, redeemAction, setOptInAction } from "@/lib/onchain-actions";

const ARC = {
  idDec: 5042002,
  name: "Arc Testnet",
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://explorer.testnet.arc.io",
};
const arcHex = "0x" + ARC.idDec.toString(16);

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };
const getEth = (): Eth | undefined =>
  typeof window !== "undefined" ? (window as unknown as { ethereum?: Eth }).ethereum : undefined;

export default function RewardsPanel({ user, earnings }: { user: AuthUser; earnings: EarningsSummary | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [connected, setConnected] = useState<string | null>(null);

  const available = earnings?.availableUsdc ?? 0;
  const linked = user.walletAddress;
  const ready = Boolean(user.walletAddress && user.rewardsOptIn);
  const differs = connected && connected.toLowerCase() !== linked?.toLowerCase();

  async function connect() {
    const eth = getEth();
    if (!eth) { setErr("No wallet found. Install any browser wallet (MetaMask, Rabby, Coinbase, Brave…)."); return; }
    setBusy("connect"); setErr(null); setMsg(null);
    try {
      try { await eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }); }
      catch (e) { if ((e as { code?: number })?.code === 4001) { setBusy(null); return; } }
      const accts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      setConnected(accts[0] ?? null);
      try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: arcHex }] }); }
      catch (e) {
        if ((e as { code?: number })?.code === 4902) {
          await eth.request({ method: "wallet_addEthereumChain", params: [{
            chainId: arcHex, chainName: ARC.name,
            nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
            rpcUrls: [ARC.rpc], blockExplorerUrls: [ARC.explorer],
          }] });
        }
      }
    } catch (e) { setErr((e as Error).message ?? "Couldn't connect."); }
    finally { setBusy(null); }
  }

  async function act(name: string, fn: () => Promise<{ ok: boolean; error?: string; amountUsdc?: number; txHash?: string }>, done?: (r: { amountUsdc?: number }) => void) {
    setBusy(name); setErr(null); setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) { setErr(r.error ?? "Something went wrong."); return; }
      done?.(r);
      router.refresh();
    } finally { setBusy(null); }
  }

  return (
    <>
      <h1 className="ptitle">Rewards</h1>
      <p className="psub">@{user.handle} — paid in USDC on Arc when people tail your calls.</p>

      <div className="card" style={{ marginTop: 20, textAlign: "center" }}>
        <p className="fine muted" style={{ margin: 0 }}>Available to cash out</p>
        <div className="num" style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em", margin: "6px 0 14px" }}>
          ${available.toFixed(2)}
        </div>
        {ready ? (
          <button className="btn primary" style={{ width: "100%", justifyContent: "center" }}
            disabled={busy !== null || available <= 0}
            onClick={() => act("redeem", redeemAction, (r) => setMsg(`Cashed out $${(r.amountUsdc ?? 0).toFixed(2)} to your wallet.`))}>
            {busy === "redeem" ? "Cashing out…" : available > 0 ? "Cash out to wallet" : "Nothing to cash out yet"}
          </button>
        ) : (
          <p className="fine muted" style={{ margin: 0 }}>
            {user.walletAddress ? "Turn on rewards below to start earning." : "Connect a wallet and turn on rewards to start earning."}
          </p>
        )}
        <div className="row" style={{ justifyContent: "center", gap: 24, marginTop: 14 }}>
          <span className="fine muted">Earned <b className="num">${(earnings?.totalEarnedUsdc ?? 0).toFixed(2)}</b></span>
          <span className="fine muted">Cashed out <b className="num">${(earnings?.redeemedUsdc ?? 0).toFixed(2)}</b></span>
        </div>
        {msg && <p className="fine" style={{ marginTop: 10 }}>{msg}</p>}
        {err && <p className="fine bad" style={{ marginTop: 10 }}>{err}</p>}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <b>Payout wallet</b>
          {linked && <span className="chip">Linked</span>}
        </div>
        {linked && <p className="fine muted num" style={{ margin: "8px 0 0", wordBreak: "break-all" }}>{linked}</p>}
        {differs && <p className="fine muted num" style={{ margin: "6px 0 0", wordBreak: "break-all" }}>Connected: {connected}</p>}
        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn sm" onClick={connect} disabled={busy !== null}>
            {busy === "connect" ? "Connecting…" : connected ? "Change wallet" : "Connect wallet"}
          </button>
          {differs && (
            <button className="btn sm primary" disabled={busy !== null}
              onClick={() => act("link", () => linkWalletAction(connected!))}>
              {busy === "link" ? "Saving…" : linked ? "Use this wallet" : "Link wallet"}
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <b>Rewards</b>
            <p className="fine muted" style={{ margin: "4px 0 0" }}>
              {user.rewardsOptIn ? "On. You earn when people tail your calls." : "Turn on payouts for your calls."}
            </p>
          </div>
          <button className={`btn sm ${user.rewardsOptIn ? "" : "primary"}`}
            disabled={busy !== null || (!user.walletAddress && !user.rewardsOptIn)}
            onClick={() => act("optin", () => setOptInAction(!user.rewardsOptIn))}>
            {busy === "optin" ? "…" : user.rewardsOptIn ? "Turn off" : "Turn on"}
          </button>
        </div>
        {!user.walletAddress && !user.rewardsOptIn && <p className="fine muted" style={{ marginTop: 8 }}>Connect a wallet first so rewards have somewhere to land.</p>}
      </div>

      {earnings && earnings.rows.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <b>Activity</b>
          <table className="tb" style={{ width: "100%", marginTop: 8, borderCollapse: "collapse" }}>
            <tbody>
              {earnings.rows.slice(0, 8).map((r) => (
                <tr key={r.id}>
                  <td className="fine muted" style={{ padding: "8px 0" }}>{new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                  <td className="fine" style={{ padding: "8px 0", textTransform: "capitalize" }}>{r.reason.replace(/_/g, " ")}</td>
                  <td className="fine num" style={{ padding: "8px 0", textAlign: "right", fontWeight: 600 }}>
                    {r.amountUsdc >= 0 ? "+" : "−"}${Math.abs(r.amountUsdc).toFixed(2)}
                  </td>
                  <td style={{ padding: "8px 0", textAlign: "right" }}>
                    {r.txHash ? <a className="fine muted" href={`${ARC.explorer}/tx/${r.txHash}`} target="_blank" rel="noreferrer">tx ↗</a> : <span className="fine muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
