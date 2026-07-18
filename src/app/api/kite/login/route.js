import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { getUser } from "@/lib/auth";

export async function GET(request) {
  // Without this, anyone could hit this route directly, complete Zerodha's
  // OAuth with their own account, and have /api/kite/callback overwrite the
  // app's single KiteSession with their session -- hijacking/breaking the
  // real connection. Requiring our own app login first means only an
  // already-authenticated session can kick off this flow.
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const loginUrl = kite.getLoginURL();
  return NextResponse.redirect(loginUrl);
}
