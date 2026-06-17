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

  if (!session) return NextResponse.json({ connected: false });

  // Compare dates in IST
  const tokenDate = new Date(session.createdAt);
  const now = new Date();

  // Check if token was created today (within last 24 hours is fine)
  const hoursDiff = (now - tokenDate) / (1000 * 60 * 60);
  console.log("Hours since token created:", hoursDiff);

  const isValid = hoursDiff < 24;

  return NextResponse.json({
    connected: isValid,
    createdAt: session.createdAt,
    hoursDiff,
  });
}
