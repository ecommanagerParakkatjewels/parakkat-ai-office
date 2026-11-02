// Starts (or completes, after Shopify's own install screen) the OAuth handshake.
// Behind the sign-in gate: only an allowed user can connect the store.
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { currentUser } from "@/lib/supabase/server";
import { READ_SCOPES, storeDomain } from "@/lib/shopify/oauth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!(await currentUser())) return NextResponse.redirect(new URL("/login", req.url));
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!clientId) return NextResponse.json({ ok: false, error: "SHOPIFY_CLIENT_ID is not set" }, { status: 503 });
  const shop = storeDomain();
  const state = randomBytes(24).toString("hex");
  const redirectUri = new URL("/api/shopify/callback", req.url).toString();
  const to = new URL(`https://${shop}/admin/oauth/authorize`);
  to.search = new URLSearchParams({ client_id: clientId, scope: READ_SCOPES, redirect_uri: redirectUri, state }).toString();
  const res = NextResponse.redirect(to);
  res.cookies.set("shopify_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/shopify", maxAge: 600 });
  return res;
}
