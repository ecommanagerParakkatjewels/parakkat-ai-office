// TLS for the database connection.
// Local sockets and localhost stay plain (development and tests only).
// Every other host is encrypted AND the server's certificate is verified.
// There is deliberately no "encrypt but don't verify" mode: if the CA is
// missing or wrong, the connection fails loudly instead of silently trusting.
//
// The CA used is, in order: DATABASE_CA (PEM, "\n" escapes allowed), then
// the bundled provider CA in db-ca.mjs, then Node's default public roots.
import { BUNDLED_CA } from "./db-ca.mjs";

export function sslFor(url) {
  let host = "";
  try { host = new URL(url).hostname; } catch { return undefined; }
  const local = host === "" || host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (local || /[?&]host=\//.test(url)) return undefined;
  const ca = process.env.DATABASE_CA?.replace(/\\n/g, "\n") || BUNDLED_CA || undefined;
  return ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: true };
}
