import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";

// Cache instruments globally (resets on server restart)
let cachedInstruments = null;
let cacheTime = null;

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const mode = searchParams.get("mode") || "swing"; // swing or intraday

  const session = await KiteSession.findOne({ userId: "default" });
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  kite.setAccessToken(session.accessToken);

  try {
    // Get instrument token
    const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");
    // const instruments = await kite.getInstruments("NSE");
    // const instrument = instruments.find((i) => i.tradingsymbol === cleanSymbol);

    // Inside GET handler, replace getInstruments call:
    if (!cachedInstruments || !cacheTime || Date.now() - cacheTime > 3600000) {
      cachedInstruments = await kite.getInstruments("NSE");
      cacheTime = Date.now();
    }

    const instrument = cachedInstruments.find(
      (i) => i.tradingsymbol === cleanSymbol,
    );

    if (!instrument)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const now = new Date();
    let fromDate, interval;

    if (mode === "intraday") {
      // Last 5 days, 5 min candles
      fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 5);
      interval = "5minute";
    } else {
      // Last 3 months, daily candles
      fromDate = new Date(now);
      fromDate.setMonth(fromDate.getMonth() - 3);
      interval = "day";
    }

    const data = await kite.getHistoricalData(
      instrument.instrument_token,
      interval,
      fromDate,
      now,
    );

    return NextResponse.json({
      candles: data.map((c) => ({
        date: new Date(c.date).toLocaleString("en-IN"),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
      mode,
      interval,
    });
  } catch (err) {
    console.error("Historical error:", err.message, err.stack);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
