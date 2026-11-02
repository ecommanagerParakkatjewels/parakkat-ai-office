import { afterEach, describe, expect, it } from "vitest";
import { sslFor } from "../src/lib/db-ssl.mjs";

afterEach(() => { delete process.env.DATABASE_CA; });
const REMOTE = "postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres";

describe("database TLS", () => {
  it("leaves local development connections plain", () => {
    expect(sslFor("postgres://postgres@/office?host=/tmp/pgrun&port=5433")).toBeUndefined();
    expect(sslFor("postgres://u:p@localhost:5432/db")).toBeUndefined();
    expect(sslFor("postgres://u:p@127.0.0.1:5432/db")).toBeUndefined();
  });
  it("always verifies a remote server's certificate", () => {
    const s = sslFor(REMOTE);
    expect(s?.rejectUnauthorized).toBe(true);
  });
  it("uses DATABASE_CA when set, unescaping \\n", () => {
    process.env.DATABASE_CA = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";
    expect(sslFor(REMOTE)).toEqual({ ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----", rejectUnauthorized: true });
  });
  it("never returns an unverified remote connection", () => {
    for (const ca of [undefined, "", "x"]) {
      if (ca === undefined) delete process.env.DATABASE_CA; else process.env.DATABASE_CA = ca;
      expect(sslFor(REMOTE)?.rejectUnauthorized).toBe(true);
    }
  });
});
