import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Optimistic redirect only: it checks that a session cookie EXISTS, not that it
// is valid. Real authorisation happens in requireOwner()/requireOwnerPage() on
// every page, action and route handler.
export function proxy(request: NextRequest) {
  if (!getSessionCookie(request, { cookiePrefix: "ledger" })) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|api|_next/static|_next/image|icons/|manifest.webmanifest|favicon.ico|robots.txt).*)"],
};
