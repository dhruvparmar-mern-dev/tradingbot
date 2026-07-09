import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";

export async function GET(request) {
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
