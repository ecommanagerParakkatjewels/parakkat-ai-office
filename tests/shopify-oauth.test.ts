import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
process.env.SHOPIFY_STORE = "666ef0-2";
const { validHmac, onlyReadScopes, storeDomain } = await import("../src/lib/shopify/oauth");
const { seal, open } = await import("../src/lib/crypto");

const SECRET = "shpss_test_secret";
function signed(q: Record<string, string>) {
  const msg = Object.keys(q).sort().map((k) => `${k}=${q[k]}`).join("&");
  return new URLSearchParams({ ...q, hmac: createHmac("sha256", SECRET).update(msg).digest("hex") });
}

describe("Shopify OAuth guards", () => {
  it("accepts Shopify's signature and rejects any tampering", () => {
    const p = signed({ code: "abc", shop: "666ef0-2.myshopify.com", state: "s1", timestamp: "1700000000" });
    expect(validHmac(p, SECRET)).toBe(true);
    const t = new URLSearchParams(p); t.set("shop", "evil.myshopify.com");
    expect(validHmac(t, SECRET)).toBe(false);
    expect(validHmac(p, "other-secret")).toBe(false);
    const n = new URLSearchParams(p); n.delete("hmac");
    expect(validHmac(n, SECRET)).toBe(false);
  });
  it("only read scopes are acceptable", () => {
    expect(onlyReadScopes("read_products")).toBe(true);
    expect(onlyReadScopes("read_products,read_orders")).toBe(true);
    expect(onlyReadScopes("read_products,write_products")).toBe(false);
    expect(onlyReadScopes("")).toBe(false);
  });
  it("store domain is built from SHOPIFY_STORE", () => {
    expect(storeDomain()).toBe("666ef0-2.myshopify.com");
  });
  it("refuses a short encryption key", async () => {
    const keep = process.env.TOKEN_ENCRYPTION_KEY;
    process.env.TOKEN_ENCRYPTION_KEY = "short";
    expect(() => seal("x")).toThrow(/32/);
    process.env.TOKEN_ENCRYPTION_KEY = keep;
  });
  it("tokens are encrypted, and tampering is detected", () => {
    const s = seal("shpat_example");
    expect(s).not.toContain("shpat");
    expect(open(s)).toBe("shpat_example");
    const b = Buffer.from(s, "base64"); b.writeUInt8(b.readUInt8(b.length - 1) ^ 1, b.length - 1);
    expect(() => open(b.toString("base64"))).toThrow();
  });
  it("the database refuses to store a write scope", async () => {
    const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    const t = (await db.query(`select id from office.tenants where slug='jewels'`)).rows[0].id;
    await expect(db.query(`insert into office.integrations (tenant_id, provider, account, scopes, token_enc, installed_by) values ($1,'shopify','x','read_products,write_products','e','t')`, [t])).rejects.toThrow(/check/);
    await db.end();
  });
});
