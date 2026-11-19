"use client";

import { useCallback, useEffect, useState } from "react";

// Multi-wallet discovery via EIP-6963: every injected wallet announces itself, so we
// can show the user a picker (MetaMask, Brave, Rabby, Coinbase…) instead of guessing
// at a single window.ethereum. Falls back to window.ethereum for older wallets.

export interface WalletInfo {
  uuid: string;
  name: string;
  icon: string; // data URI
  rdns: string;
}
export interface EthProvider {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
}
export interface DiscoveredWallet {
  info: WalletInfo;
  provider: EthProvider;
}

export const ARC = {
  idDec: 5042002,
  name: "Arc Testnet",
  rpc: "https://rpc.testnet.arc.network",
  explorer: "https://explorer.testnet.arc.io",
};
const arcHex = "0x" + ARC.idDec.toString(16);

export function useWallets() {
  const [found, setFound] = useState<DiscoveredWallet[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const map = new Map<string, DiscoveredWallet>();
    const onAnnounce = (e: Event) => {
      const d = (e as CustomEvent).detail as DiscoveredWallet;
      if (d?.info?.uuid) {
        map.set(d.info.rdns || d.info.uuid, d);
        setFound([...map.values()]);
      }
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
  }, []);

  const connect = useCallback(async (wallet: DiscoveredWallet) => {
    setBusy(true);
    setError(null);
    try {
      const accts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accts[0]) { setBusy(false); return; }
      setAddress(accts[0]);
      setActiveName(wallet.info.name);
      try {
        await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: arcHex }] });
      } catch (e) {
        if ((e as { code?: number })?.code === 4902) {
          await wallet.provider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: arcHex, chainName: ARC.name,
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [ARC.rpc], blockExplorerUrls: [ARC.explorer],
            }],
          });
        }
      }
    } catch (e) {
      const code = (e as { code?: number })?.code;
      if (code !== 4001) setError((e as Error).message ?? "Couldn't connect.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setActiveName(null);
  }, []);

  // Older wallets that don't support EIP-6963 still expose window.ethereum.
  const legacy = typeof window !== "undefined" ? (window as unknown as { ethereum?: EthProvider }).ethereum : undefined;
  const wallets: DiscoveredWallet[] =
    found.length > 0
      ? found
      : legacy
        ? [{ info: { uuid: "legacy", name: "Browser wallet", icon: "", rdns: "legacy" }, provider: legacy }]
        : [];

  return { wallets, address, activeName, busy, error, connect, disconnect };
}
