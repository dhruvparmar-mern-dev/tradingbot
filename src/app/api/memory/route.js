import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Stock from "@/models/Stock";
import { resolvePendingOutcomes } from "@/lib/resolveSignalOutcomes";

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const mode = searchParams.get("mode") || "swing";
  const field = `memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
  const stock = await Stock.findOne({ symbol });
  const memory = stock?.[field];

  // Before handing memory back (this is what every AI prompt is built from),
  // check any old-enough PENDING signals against real candle data. Without
  // this, non-traded signals stay "PENDING" forever and the AI's own
  // self-reported memory of whether a past call was right goes unchecked.
  if (memory?.signalHistory?.length) {
    try {
      const { history, changed } = await resolvePendingOutcomes(
        symbol,
        mode,
        memory.signalHistory,
      );
      if (changed) {
        memory.signalHistory = history;
        await Stock.updateOne(
          { symbol },
          { $set: { [`${field}.signalHistory`]: history } },
        );
      }
    } catch (err) {
      console.error(`Signal outcome resolution failed for ${symbol}:`, err.message);
    }
  }

  return NextResponse.json(memory || null);
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
