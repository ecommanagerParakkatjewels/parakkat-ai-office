// Runs before every request: refreshes the session cookie and keeps signed-out
// visitors on the login page. Single user for now; roles arrive with user two.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/auth", "/api/health", "/ds"];

export async function proxy(req: NextRequest) {
  // Let server layouts know the path, for the active nav item.
  req.headers.set("x-pathname", req.nextUrl.pathname);
  let res = NextResponse.next({ request: req });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return res;

  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));

  if (!data.user && !isPublic) {
    const to = req.nextUrl.clone();
    to.pathname = "/login";
    to.search = "";
    return NextResponse.redirect(to);
  }
  if (data.user && path === "/login") {
    const to = req.nextUrl.clone();
    to.pathname = "/";
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
