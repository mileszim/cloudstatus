import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE, isValidSession } from "@/lib/auth/session";

/**
 * Gate for the admin dashboard. Unauthenticated requests are redirected to the
 * login page with a `next` parameter so they land where they were headed.
 *
 * The login page and its Server Action must stay reachable, or signing in
 * would require already being signed in.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/admin/login") return NextResponse.next();

  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  // Server Actions POST to the page they were rendered from. Returning a
  // redirect for those would silently swallow the action, so answer 401.
  if (request.method === "POST") {
    return new NextResponse("Session expired. Reload the page and sign in again.", {
      status: 401,
    });
  }

  const login = new URL("/admin/login", request.url);
  login.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*"],
};
