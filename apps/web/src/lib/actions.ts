"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addWatch, removeWatch, startCopyTrade, stopCopyTrade } from "./api";
import { getFollowerId, isUuid, SESSION_COOKIE } from "./session";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function setSession(id: string) {
  (await cookies()).set(SESSION_COOKIE, id, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
}

/** Signs in as the demo user configured for this deployment (DEFAULT_FOLLOWER_ID). */
export async function signInDemo(): Promise<void> {
  const id = process.env.DEFAULT_FOLLOWER_ID;
  if (!id || !isUuid(id)) redirect("/signin?error=demo");
  await setSession(id);
  redirect("/watchlist");
}

/** Developer sign-in with a raw user id, until X login exists. */
export async function signInWithId(formData: FormData): Promise<void> {
  const id = String(formData.get("userId") ?? "").trim();
  if (!isUuid(id)) redirect("/signin?error=id");
  await setSession(id);
  redirect("/watchlist");
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  revalidatePath("/", "layout");
  redirect("/");
}

async function run(action: (followerId: string) => Promise<unknown>): Promise<ActionResult> {
  const followerId = await getFollowerId();
  if (!followerId) return { ok: false, error: "Sign in first." };
  try {
    await action(followerId);
    revalidatePath("/watchlist");
    revalidatePath("/portfolio");
    revalidatePath("/traders/[handle]", "page");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}

export async function watchTrader(handle: string, on: boolean): Promise<ActionResult> {
  return run((id) => (on ? addWatch(id, handle) : removeWatch(id, handle)));
}

export async function startCopy(handle: string, amountUsdc: number): Promise<ActionResult> {
  return run((id) => startCopyTrade(id, handle, amountUsdc));
}

export async function stopCopy(handle: string): Promise<ActionResult> {
  return run((id) => stopCopyTrade(id, handle));
}
