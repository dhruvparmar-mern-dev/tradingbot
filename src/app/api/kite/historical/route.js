import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import { getNSEInstruments } from "@/lib/kiteInstruments";

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const mode = searchParams.get("mode") || "swing"; // swing or intraday
  const range = searchParams.get("range"); // '1D', '5D', '1M', '3M', '6M', '1Y'

  const session = await KiteSession.findOne({ userId: "default" });
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  kite.setAccessToken(session.accessToken);

  try {
    const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");
    const instruments = await getNSEInstruments();
    const instrument = instruments.find((i) => i.tradingsymbol === cleanSymbol);
    if (!instrument)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    const now = new Date();
    let fromDate, interval;

    if (mode === "intraday") {
      fromDate = new Date(now);
      const days = range === "1D" ? 1 : range === "5D" ? 5 : 5;
      fromDate.setDate(fromDate.getDate() - days);
      interval = "5minute";
    } else {
      fromDate = new Date(now);
      const months =
        range === "1M"
          ? 1
          : range === "3M"
            ? 3
            : range === "6M"
              ? 6
              : range === "1Y"
                ? 12
                : 3;
      fromDate.setMonth(fromDate.getMonth() - months);
      interval = "day";
    }

    const data = await kite.getHistoricalData(
      instrument.instrument_token,
      interval,
      fromDate,
      now,
    );

    // Log raw data sample
    console.log(
      "📈 Historical raw sample:",
      symbol,
      "interval:",
      interval,
      "total candles:",
      data.length,
      "first:",
      JSON.stringify(data[0]),
      "last:",
      JSON.stringify(data[data.length - 1]),
    );

    // Sanity check across all candles — flag any wild outlier vs median close
    const closes = data
      .map((c) => c.close)
      .filter(Boolean)
      .sort((a, b) => a - b);
    const median = closes[Math.floor(closes.length / 2)];
    const outliers = data.filter(
      (c) => c.high > median * 3 || c.low < median / 3,
    );
    if (outliers.length > 0) {
      console.error(
        "🔴 OUTLIER candles detected:",
        symbol,
        "median close:",
        median,
        "outliers:",
        JSON.stringify(outliers),
      );
    }

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
    console.error("Historical error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
