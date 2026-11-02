// Applies db/migrations/*.sql in order, once each, then db/seed/*.sql (re-runnable).
// Usage: DATABASE_URL=postgres://... node scripts/migrate.mjs
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { sslFor } from "../src/lib/db-ssl.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
await client.connect();
try {
  await client.query(`create table if not exists public.schema_migrations (
    name text primary key, applied_at timestamptz not null default now())`);

  const dir = join(process.cwd(), "db", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await client.query("select 1 from public.schema_migrations where name = $1", [f]);
    if (done.rowCount) { console.log("skip   ", f); continue; }
    const sql = await readFile(join(dir, f), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.schema_migrations (name) values ($1)", [f]);
      await client.query("commit");
      console.log("applied", f);
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }

  const seedDir = join(process.cwd(), "db", "seed");
  for (const f of (await readdir(seedDir)).filter((x) => x.endsWith(".sql")).sort()) {
    await client.query(await readFile(join(seedDir, f), "utf8"));
    console.log("seeded ", f);
  }
} finally {
  await client.end();
}
