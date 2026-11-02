import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Shell } from "@/components/Shell";
import { currentUser } from "@/lib/supabase/server";
import { currentTenant } from "@/lib/tenant";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const tenant = await currentTenant();
  const [open] = await query<{ n: string }>(
    `select count(*)::text as n from office.findings where tenant_id = $1 and status in ('new','triaged','fix_reported','verifying','recurred')`,
    [tenant.id]
  );
  const path = (await headers()).get("x-pathname") ?? "/";
  return (
    <Shell current={path.startsWith("/findings") ? "/findings" : path.startsWith("/agents") ? "/agents" : "/"} tenantName={tenant.name} email={user.email ?? ""} openCount={Number(open?.n ?? 0)}>
      {children}
    </Shell>
  );
}
