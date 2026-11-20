"use server";

import { revalidatePath } from "next/cache";
import { getFollowerId } from "./session";
import { ocLinkWallet, ocPayoutRun, ocRedeem, ocSetOptIn } from "./onchain";
import { getAdmin } from "./admin";

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

/** Runs today's payout. Admins only (ADMIN_X_HANDLES). */
export async function runPayoutAction(): Promise<OnchainResult & { message?: string }> {
  const admin = await getAdmin();
  if (!admin) return { ok: false, error: "Only admins can run payouts." };
  try {
    const r = await ocPayoutRun(admin.handle);
    revalidatePath("/admin/payouts");
    revalidatePath("/rewards");
    if (!r.ran) return { ok: true, message: r.reason ?? "Nothing to pay out." };
    return {
      ok: true,
      message: `Paid $${r.feeCreditedUsdc.toFixed(4)} to creators; treasury kept $${r.feeRetainedUsdc.toFixed(4)} from ${r.tails} trades.`,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't run the payout." };
  }
}
