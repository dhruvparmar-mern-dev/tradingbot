import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Stock from "@/models/Stock";

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const mode = searchParams.get("mode") || "swing";
  const stock = await Stock.findOne({ symbol });
  return NextResponse.json(
    stock?.[`memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`] || null,
  );
}

export async function POST(request) {
  await connectDB();
  const { symbol, memory, mode } = await request.json();
  const field = `memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
  await Stock.findOneAndUpdate({ symbol }, { $set: { [field]: memory } });
  return NextResponse.json({ success: true });
}
