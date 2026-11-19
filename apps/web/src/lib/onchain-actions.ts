"use server";

import { revalidatePath } from "next/cache";
import { getFollowerId } from "./session";
import { ocLinkWallet, ocRedeem, ocSetOptIn } from "./onchain";

export interface OnchainResult {
  ok: boolean;
  error?: string;
  amountUsdc?: number;
  txHash?: string;
}

export async function linkWalletAction(address: string): Promise<OnchainResult> {
  const id = await getFollowerId();
  if (!id) return { ok: false, error: "Sign in first." };
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { ok: false, error: "That doesn't look like a wallet address." };
  try {
    await ocLinkWallet(id, address);
    revalidatePath("/rewards");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't link that wallet." };
  }
}

export async function setOptInAction(on: boolean): Promise<OnchainResult> {
  const id = await getFollowerId();
  if (!id) return { ok: false, error: "Sign in first." };
  try {
    await ocSetOptIn(id, on);
    revalidatePath("/rewards");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't update rewards." };
  }
}

export async function redeemAction(): Promise<OnchainResult> {
  const id = await getFollowerId();
  if (!id) return { ok: false, error: "Sign in first." };
  try {
    const r = await ocRedeem(id);
    revalidatePath("/rewards");
    return { ok: true, amountUsdc: r.amountUsdc, txHash: r.txHash };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't cash out." };
  }
}
