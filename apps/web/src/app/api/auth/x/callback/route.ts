import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { ocUpsertXUser } from "@/lib/onchain";

/** X OAuth callback: exchange the code, read the handle, upsert the user, and sign in
 *  by setting the site's copayme_uid cookie to that user's id. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = req.cookies.get("x_state")?.value;
  const verifier = req.cookies.get("x_pkce")?.value;
  const fail = (reason: string) => NextResponse.redirect(new URL(`/signin?error=${reason}`, req.url));

  if (!code || !state || !verifier || state !== savedState) return fail("x");

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URI ?? new URL("/api/auth/x/callback", req.url).toString();
  if (!clientId) return fail("x_unconfigured");

  try {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
    });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    if (clientSecret) headers.Authorization = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokRes = await fetch("https://api.x.com/2/oauth2/token", { method: "POST", headers, body: form });
    if (!tokRes.ok) return fail("x");
    const tok = (await tokRes.json()) as { access_token?: string };
    if (!tok.access_token) return fail("x");

    const meRes = await fetch("https://api.x.com/2/users/me", { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (!meRes.ok) return fail("x");
    const me = (await meRes.json()) as { data?: { id?: string; username?: string } };
    if (!me.data?.id || !me.data.username) return fail("x");

    const user = await ocUpsertXUser(me.data.id, me.data.username);

    const res = NextResponse.redirect(new URL("/rewards", req.url));
    res.cookies.set(SESSION_COOKIE, user.userId, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
    res.cookies.delete("x_pkce");
    res.cookies.delete("x_state");
    return res;
  } catch {
    return fail("x");
  }
}
