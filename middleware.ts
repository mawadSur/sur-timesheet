import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const secret = process.env.AUTH_SECRET || "";
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const authed = Boolean(secret) && (await verifySessionToken(secret, token));

  if (authed) return NextResponse.next();

  const { pathname, search } = req.nextUrl;

  // API calls get a clean 401 instead of an HTML redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: "Please log in first." },
      { status: 401 }
    );
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

// Protect everything except the login screen, its API, logout, and static assets.
export const config = {
  matcher: [
    "/((?!login|api/login|api/logout|_next/static|_next/image|favicon.ico).*)",
  ],
};
