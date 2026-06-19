import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Trade from "@/models/Trade";

export async function GET() {
  await connectDB();
  const trades = await Trade.find().sort({ time: -1 }); // newest first
  return NextResponse.json(trades);
}

export async function POST(request) {
  await connectDB();
  const body = await request.json();
  const trade = await Trade.create(body);
  return NextResponse.json(trade);
}
