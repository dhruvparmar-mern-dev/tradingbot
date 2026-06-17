import { NextResponse } from "next/server";
// import jwt from "jsonwebtoken";

export async function middleware(request) {
  const token = request.cookies.get("auth_token")?.value;
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isAuthApi = request.nextUrl.pathname.startsWith("/api/auth");
  const isKiteApi = request.nextUrl.pathname.startsWith("/api/kite");

  // Allow auth APIs always
  if (isAuthApi || isKiteApi) return NextResponse.next();

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
