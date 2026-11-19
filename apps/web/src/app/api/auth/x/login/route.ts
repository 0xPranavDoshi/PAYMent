import { NextResponse, type NextRequest } from "next/server";
import { createHash, randomBytes } from "node:crypto";

const b64url = (b: Buffer) => b.toString("base64url");

/** Start X OAuth 2.0 (Authorization Code + PKCE). Redirects the user to X to approve. */
export async function GET(req: NextRequest) {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI ?? new URL("/api/auth/x/callback", req.url).toString();
  if (!clientId) return NextResponse.redirect(new URL("/signin?error=x_unconfigured", req.url));

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const authUrl = new URL("https://x.com/i/oauth2/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "tweet.read users.read offline.access");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authUrl.toString());
  const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
  res.cookies.set("x_pkce", verifier, opts);
  res.cookies.set("x_state", state, opts);
  return res;
}
