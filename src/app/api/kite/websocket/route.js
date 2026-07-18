import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import { getUser } from "@/lib/auth";

export async function GET() {
  // This returns the live Kite accessToken + apiKey -- full brokerage
  // account access. Was reachable by anyone, unauthenticated, since
  // proxy.js used to exempt all of /api/kite/*. getUser() does a real JWT
  // verification (unlike the middleware's cookie-presence-only check).
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const session = await KiteSession.findOne({ userId: "default" });

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  return NextResponse.json({
    accessToken: session.accessToken,
    apiKey: process.env.KITE_API_KEY,
  });
}
