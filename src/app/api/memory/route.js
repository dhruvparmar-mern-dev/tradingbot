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
  const { symbol, memory, mode, name } = await request.json();
  const field = `memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`;

  // A symbol analyzed from outside the watchlist (e.g. a top-mover "quick
  // look") shouldn't silently join the active watchlist just because it now
  // has memory -- default new documents to archived. Existing docs (already
  // in the watchlist, or previously archived) are untouched.
  const updated = await Stock.findOneAndUpdate(
    { symbol },
    {
      $set: { [field]: memory },
      $setOnInsert: { symbol, name, inWatchlist: false },
    },
    { upsert: true, new: true },
  );

  return NextResponse.json({ success: true, saved: updated[field] });
}
