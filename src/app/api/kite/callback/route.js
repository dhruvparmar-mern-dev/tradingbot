import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import { getUser } from "@/lib/auth";

export async function GET(request) {
  // Defense in depth alongside /api/kite/login's check -- Zerodha's login
  // URL only needs our public api_key, so someone could complete OAuth with
  // their own Zerodha account and hit this callback directly, overwriting
  // the app's single KiteSession. Requiring our own app auth here means that
  // can't succeed even if /login is bypassed some other way. The real
  // connect flow always has this cookie (same browser, same-origin
  // redirect), so this doesn't affect normal usage.
  const user = await getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const { searchParams } = new URL(request.url);
  const requestToken = searchParams.get("request_token");
  const status = searchParams.get("status");

  console.log("Kite callback received");
  console.log("Status:", status);
  console.log("Request token:", requestToken);

  try {
    const session = await kite.generateSession(
      requestToken,
      process.env.KITE_API_SECRET,
    );
    console.log("Session generated:", session.access_token ? "yes" : "no");

    await connectDB();
    const saved = await KiteSession.findOneAndUpdate(
      { userId: "default" },
      {
        accessToken: session.access_token,
        publicToken: session.public_token,
        userId: "default",
        createdAt: new Date(),
      },
      { upsert: true, new: true },
    );
    console.log("Saved token:", saved.accessToken);
    console.log("Saved at:", saved.createdAt);
    // Redirect to dashboard with success
    return NextResponse.redirect(new URL("/?kite=connected", request.url));
  } catch (err) {
    console.error("Kite auth error:", err);
    return NextResponse.redirect(new URL("/?kite=error", request.url));
  }
}
