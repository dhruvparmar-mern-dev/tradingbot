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

    // Sanity check — flag suspicious high/low values
    if (
      high > lastPrice * 1.5 ||
      low < lastPrice * 0.5 ||
      high < lastPrice * 0.5 ||
      low > lastPrice * 1.5
    ) {
      console.error(
        "🔴 SUSPICIOUS high/low:",
        symbol,
        "price:",
        lastPrice,
        "high:",
        high,
        "low:",
        low,
        "open:",
        open,
        "raw ohlc:",
        JSON.stringify(data.ohlc),
      );
    }

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
      fiftyTwoWeekHigh: data.upper_circuit_limit || null,
      fiftyTwoWeekLow: data.lower_circuit_limit || null,
    });
  } catch (err) {
    console.error("Kite quote error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
