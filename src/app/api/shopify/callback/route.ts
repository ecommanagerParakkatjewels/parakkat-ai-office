// Shopify sends the browser back here with a one-time code. Every check must
// pass before the code is exchanged, and the token is stored only if it is
// read-only, encrypted, for our own store.
import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/supabase/server";
import { currentTenant } from "@/lib/tenant";
import { onlyReadScopes, storeDomain, validHmac } from "@/lib/shopify/oauth";
import { seal } from "@/lib/crypto";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

function back(req: NextRequest, msg: string) {
  const u = new URL("/agents", req.url);
  u.searchParams.set("shopify", msg);
  const res = NextResponse.redirect(u);
  res.cookies.delete({ name: "shopify_oauth_state", path: "/api/shopify" });
  return res;
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const p = req.nextUrl.searchParams;
  const secret = process.env.SHOPIFY_CLIENT_SECRET, clientId = process.env.SHOPIFY_CLIENT_ID;
  if (!secret || !clientId) return back(req, "not_configured");
  if (!validHmac(p, secret)) return back(req, "bad_signature");
  if (p.get("shop") !== storeDomain()) return back(req, "wrong_store");
  const state = req.cookies.get("shopify_oauth_state")?.value;
  if (!state || state !== p.get("state")) return back(req, "bad_state");
  const code = p.get("code");
  if (!code) return back(req, "no_code");

  const r = await fetch(`https://${storeDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: secret, code }),
  });
  const body = (await r.json().catch(() => ({}))) as { access_token?: string; scope?: string };
  if (!r.ok || !body.access_token) return back(req, "exchange_failed");
  if (!onlyReadScopes(body.scope ?? "")) return back(req, "write_scope_refused");

  const tenant = await currentTenant();
  await query(
    `insert into office.integrations (tenant_id, provider, account, scopes, token_enc, installed_by)
     values ($1, 'shopify', $2, $3, $4, $5)
     on conflict (tenant_id, provider) do update set account = excluded.account, scopes = excluded.scopes,
       token_enc = excluded.token_enc, installed_by = excluded.installed_by, installed_at = now()`,
    [tenant.id, storeDomain(), body.scope, seal(body.access_token), user.email ?? user.id],
  );
  return back(req, "connected");
}
