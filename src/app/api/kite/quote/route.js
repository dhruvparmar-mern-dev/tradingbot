import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  try {
    await connectDB();
    const session = await KiteSession.findOne({ userId: "default" });
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Not connected" }, { status: 401 });
    }

    kite.setAccessToken(session.accessToken);

    const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");
    const quote = await kite.getQuote([`NSE:${cleanSymbol}`]);
    const data = quote[`NSE:${cleanSymbol}`];

    if (!data) {
      return NextResponse.json({ error: "Stock not found" }, { status: 404 });
    }

    const lastPrice = data.last_price;
    const prevClose = data.ohlc.close;
    const changeAmount = lastPrice - prevClose;
    const changePercent = (changeAmount / prevClose) * 100;

    const high = data.ohlc.high;
    const low = data.ohlc.low;
    const open = data.ohlc.open;

    console.log(
      "📊 Quote data:",
      symbol,
      "price:",
      lastPrice,
      "high:",
      high,
      "low:",
      low,
      "open:",
      open,
      "prevClose:",
      prevClose,
      "raw ohlc:",
      JSON.stringify(data.ohlc),
    );

    return NextResponse.json({
      symbol,
      price: lastPrice,
      change: parseFloat(changePercent.toFixed(2)),
      changeAmount: parseFloat(changeAmount.toFixed(2)),
      high,
      low,
      open,
      prevClose,
      volume: data.volume_traded || data.volume || 0,
      // Kite's quote API doesn't return 52-week range — upper/lower_circuit_limit
      // are daily circuit bands, not the 52-week high/low, so don't conflate them.
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
    });
  } catch (err) {
    console.error("Kite quote error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
