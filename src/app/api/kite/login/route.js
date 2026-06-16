import { NextResponse } from "next/server";
import kite from "@/lib/kite";

export async function GET() {
  const loginUrl = kite.getLoginURL();
  return NextResponse.redirect(loginUrl);
}
