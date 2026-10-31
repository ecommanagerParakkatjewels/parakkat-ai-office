import "server-only";
import { query } from "./db";

export type Tenant = { id: string; slug: string; name: string };

/** The one business this deployment serves. A second brand becomes a setting, not a rebuild. */
export async function currentTenant(): Promise<Tenant> {
  const slug = process.env.TENANT_SLUG ?? "jewels";
  const rows = await query<Tenant>("select id, slug, name from office.tenants where slug = $1", [slug]);
  const t = rows[0];
  if (!t) throw new Error(`No tenant with slug "${slug}". Run npm run db:migrate.`);
  return t;
}
