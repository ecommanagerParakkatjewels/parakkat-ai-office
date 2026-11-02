// Read-only Shopify Admin API client. Server only.
//
// Access, in order of preference:
//   SHOPIFY_ADMIN_TOKEN                       a token from an existing custom app or an OAuth install
//   SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET  Dev Dashboard app in the same organisation as the store
//                                             (client credentials grant; token lives 24 h, cached here)
// SHOPIFY_STORE is the store's subdomain, without ".myshopify.com".
//
// Read-only is enforced in code, not just by scopes: the only operation allowed
// that is not a query is bulkOperationRunQuery, which itself only reads.
import "server-only";

export const SHOPIFY_API_VERSION = "2026-10";

let cached: { token: string; expiresAt: number } | null = null;

function store(): string {
  const s = (process.env.SHOPIFY_STORE ?? "").trim().replace(/\.myshopify\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error("SHOPIFY_STORE is not set");
  return s;
}

export function shopifyConfigured(): boolean {
  return !!process.env.SHOPIFY_STORE && (!!process.env.SHOPIFY_ADMIN_TOKEN || (!!process.env.SHOPIFY_CLIENT_ID && !!process.env.SHOPIFY_CLIENT_SECRET));
}

async function token(): Promise<string> {
  if (process.env.SHOPIFY_ADMIN_TOKEN) return process.env.SHOPIFY_ADMIN_TOKEN;
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const id = process.env.SHOPIFY_CLIENT_ID, secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Shopify access is not configured");
  const res = await fetch(`https://${store()}.myshopify.com/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Shopify token request failed (${res.status}${body.error ? ": " + body.error : ""})`);
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

const MUTATION_ALLOWED = /^\s*mutation\s*\w*\s*(\([^)]*\))?\s*\{\s*bulkOperationRunQuery\s*\(/;

/** Run one GraphQL document. Refuses anything that could change the store. */
export async function gql<T>(document: string, variables: Record<string, unknown> = {}): Promise<T> {
  const isMutation = /^\s*mutation\b/.test(document);
  if (isMutation && !MUTATION_ALLOWED.test(document)) throw new Error("refused: write operations are not allowed");
  if (!isMutation && !/^\s*(query\b|\{)/.test(document)) throw new Error("refused: only queries are allowed");
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://${store()}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await token() },
      body: JSON.stringify({ query: document, variables }),
    });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
    if (body.errors?.some((e) => e.extensions?.code === "THROTTLED")) { await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); continue; }
    if (!res.ok || body.errors?.length) throw new Error(`Shopify ${res.status}: ${body.errors?.map((e) => e.message).join("; ") ?? "request failed"}`);
    return body.data as T;
  }
  throw new Error("Shopify kept throttling the request");
}
