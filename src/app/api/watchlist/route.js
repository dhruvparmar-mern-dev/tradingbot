import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Stock from "@/models/Stock";

export async function GET() {
  await connectDB();
  const stocks = await Stock.find(
    { inWatchlist: { $ne: false } },
    { symbol: 1, name: 1, exchange: 1 },
  );
  return NextResponse.json(stocks);
}

export async function POST(request) {
  await connectDB();
  const body = await request.json();
  try {
    // Re-adding a previously-archived stock un-archives it and keeps its
    // existing memory/signalHistory rather than starting fresh.
    const stock = await Stock.findOneAndUpdate(
      { symbol: body.symbol },
      {
        $set: { inWatchlist: true },
        $setOnInsert: {
          symbol: body.symbol,
          name: body.name,
          exchange: body.exchange,
        },
      },
      { upsert: true, new: true },
    );
    return NextResponse.json(stock);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Archives the stock instead of deleting it — memory/signalHistory is kept
// in case it's re-added later. Use a separate cleanup path if a document
// genuinely needs to be purged.
export async function DELETE(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  await Stock.updateOne({ symbol }, { $set: { inWatchlist: false } });
  return NextResponse.json({ success: true });
}
