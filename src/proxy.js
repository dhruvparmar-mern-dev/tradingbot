import { NextResponse } from "next/server";
// import jwt from "jsonwebtoken";

export async function proxy(request) {
  const token = request.cookies.get("auth_token")?.value;
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth");

  // /api/kite/* used to be exempt entirely, which let anyone on the internet
  // hit /api/kite/websocket and read the live Kite accessToken + apiKey
  // (full brokerage account access), and hit /api/kite/login to trigger the
  // OAuth flow and overwrite the single KiteSession doc with their own
  // Zerodha account. Now subject to the same cookie-presence gate as every
  // other route; the genuinely sensitive kite routes additionally verify the
  // JWT for real via getUser() (see their route handlers).
  if (isAuthApi) return NextResponse.next();

  // Not logged in → redirect to login
  if (!token) {
    if (isLoginPage) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Verify token
  try {
    // await jwt.verify(token, process.env.JWT_SECRET);
    // Logged in → don't show login page

    if (isLoginPage) return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  } catch {
    // Invalid token → redirect to login
    if (isLoginPage) return NextResponse.next();
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
