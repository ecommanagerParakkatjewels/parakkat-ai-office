// AES-256-GCM for stored credentials. The key lives only in TOKEN_ENCRYPTION_KEY:
// any random string of 32+ characters (e.g. from a password manager), turned
// into a 256-bit key with SHA-256. Without it nothing can be stored or read.
import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY ?? "";
  if (raw.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY must be at least 32 random characters");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

export function open(sealed: string): string {
  const b = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
