// Server-only database access. The browser never sees DATABASE_URL.
import "server-only";
import { Pool, type PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __officePool: Pool | undefined;
}

function pool(): Pool {
  if (!globalThis.__officePool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.__officePool = new Pool({ connectionString: url, max: 5 });
  }
  return globalThis.__officePool;
}

/** Run work in one transaction with the acting user recorded for the audit log. */
export async function withActor<T>(actor: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.actor', $1, true)", [actor]);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

export async function query<R extends Record<string, unknown>>(text: string, params: unknown[] = []): Promise<R[]> {
  const r = await pool().query(text, params);
  return r.rows as R[];
}
