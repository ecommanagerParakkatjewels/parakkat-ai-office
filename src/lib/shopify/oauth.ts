// Shopify OAuth (authorization code grant) for a Dev Dashboard app installed
// on our own store. Pure helpers here; the routes live in app/api/shopify.
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const READ_SCOPES = "read_products";

export function storeDomain(): string {
  const s = (process.env.SHOPIFY_STORE ?? "").trim().replace(/\.myshopify\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]*$/.test(s)) throw new Error("SHOPIFY_STORE is not set");
  return `${s}.myshopify.com`;
}

/** Shopify signs the callback query string with the app's client secret. */
export function validHmac(params: URLSearchParams, secret: string): boolean {
  const given = params.get("hmac") ?? "";
  const msg = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const want = createHmac("sha256", secret).update(msg).digest("hex");
  const a = Buffer.from(given, "utf8"), b = Buffer.from(want, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Every granted scope must be a read scope; anything else is refused, not stored. */
export function onlyReadScopes(scope: string): boolean {
  const list = scope.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length > 0 && list.every((s) => /^(unauthenticated_)?read_[a-z_]+$/.test(s));
}
