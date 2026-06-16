import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";

export async function GET() {
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
