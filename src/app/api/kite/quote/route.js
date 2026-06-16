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

    // Kite uses NSE:TCS format
    const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");
    const quote = await kite.getQuote([`NSE:${cleanSymbol}`]);
    const data = quote[`NSE:${cleanSymbol}`];

    const lastPrice = data.last_price;
    const prevClose = data.ohlc.close;
    const changeAmount = lastPrice - prevClose;
    const changePercent = (changeAmount / prevClose) * 100;

    return NextResponse.json({
      symbol,
      price: lastPrice,
      change: parseFloat(changePercent.toFixed(2)),
      changeAmount: parseFloat(changeAmount.toFixed(2)),
      high: data.ohlc.high,
      low: data.ohlc.low,
      open: data.ohlc.open,
      prevClose: prevClose,
      volume: data.volume_traded || data.volume || 0,
      fiftyTwoWeekHigh: data.upper_circuit_limit || null,
      fiftyTwoWeekLow: data.lower_circuit_limit || null,
    });
  } catch (err) {
    console.error("Kite quote error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
