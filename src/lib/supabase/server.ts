// Supabase is used for sign-in only. Business data never goes through it from the browser.
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isAllowed } from "@/lib/allow";

export async function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase env vars are not set");
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are refreshed by the proxy instead.
        }
      },
    },
  });
}

/** The signed-in user, or null — also null for a signed-in account not on ALLOWED_EMAILS. */
export async function currentUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user || !isAllowed(data.user.email)) return null;
  return data.user;
}
