import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";

// export async function GET() {
//   await connectDB();
//   const session = await KiteSession.findOne({ userId: "default" });

//   if (!session) return NextResponse.json({ connected: false });

//   // Kite tokens expire daily, check if today's token
//   const tokenDate = new Date(session.createdAt);
//   const today = new Date();
//   const isToday = tokenDate.toDateString() === today.toDateString();

//   return NextResponse.json({
//     connected: isToday,
//     createdAt: session.createdAt,
//   });
// }

export async function GET() {
  await connectDB();
  const session = await KiteSession.findOne({ userId: "default" });

  if (!session?.accessToken) {
    return NextResponse.json({ connected: false });
  }

  kite.setAccessToken(session.accessToken);

  try {
    // Lightweight real check — will throw if token invalid/expired
    await kite.getProfile();
    return NextResponse.json({ connected: true, createdAt: session.createdAt });
  } catch (err) {
    console.error("Kite token invalid:", err.message);
    return NextResponse.json({ connected: false, reason: err.message });
  }
}
