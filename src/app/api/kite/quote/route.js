import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";

function shapeQuote(symbol, data) {
  const lastPrice = data.last_price;
  const prevClose = data.ohlc.close;
  const changeAmount = lastPrice - prevClose;
  const changePercent = (changeAmount / prevClose) * 100;

  return {
    symbol,
    price: lastPrice,
    change: parseFloat(changePercent.toFixed(2)),
    changeAmount: parseFloat(changeAmount.toFixed(2)),
    high: data.ohlc.high,
    low: data.ohlc.low,
    open: data.ohlc.open,
    prevClose,
    volume: data.volume_traded || data.volume || 0,
    // Kite's quote API doesn't return 52-week range — upper/lower_circuit_limit
    // are daily circuit bands, not the 52-week high/low, so don't conflate them.
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const symbolsParam = searchParams.get("symbols");

  try {
    await connectDB();
    const session = await KiteSession.findOne({ userId: "default" });
    if (!session?.accessToken) {
      return NextResponse.json({ error: "Not connected" }, { status: 401 });
    }

    kite.setAccessToken(session.accessToken);

    // Batched mode — one Kite call for the whole watchlist/portfolio instead
    // of one request per stock (was firing ~30 concurrent single-symbol
    // requests on page load, see AppShell.jsx).
    if (symbolsParam) {
      const symbols = symbolsParam.split(",").filter(Boolean);
      const cleanMap = new Map(
        symbols.map((s) => [s, s.replace(".NS", "").replace(".BO", "")]),
      );
      const quote = await kite.getQuote(
        [...cleanMap.values()].map((clean) => `NSE:${clean}`),
      );

      const result = {};
      for (const [original, clean] of cleanMap) {
        const data = quote[`NSE:${clean}`];
        result[original] = data ? shapeQuote(original, data) : null;
      }
      return NextResponse.json(result);
    }

    const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");
    const quote = await kite.getQuote([`NSE:${cleanSymbol}`]);
    const data = quote[`NSE:${cleanSymbol}`];

    if (!data) {
      return NextResponse.json({ error: "Stock not found" }, { status: 404 });
    }

    return NextResponse.json(shapeQuote(symbol, data));
  } catch (err) {
    console.error("Kite quote error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
