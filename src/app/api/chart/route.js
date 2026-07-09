import { NextResponse } from "next/server";
import { computeIndicators } from "@/lib/indicators";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let symbol = searchParams.get("symbol")?.toUpperCase().trim();

  if (!symbol.includes(".")) symbol = `${symbol}.NS`;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    );

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return NextResponse.json({ error: "No chart data" }, { status: 404 });
    }

    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    const closes = quotes.close;
    const highs = quotes.high;
    const lows = quotes.low;
    const volumes = quotes.volume;

    // Build candles array
    const candles = timestamps
      .map((t, i) => ({
        date: new Date(t * 1000).toLocaleDateString("en-IN", {
          timeZone: "Asia/Kolkata",
        }),
        open: quotes.open[i]?.toFixed(2),
        high: highs[i]?.toFixed(2),
        low: lows[i]?.toFixed(2),
        close: closes[i]?.toFixed(2),
        volume: volumes[i],
      }))
      .filter((c) => c.close !== null);

    const indicators = computeIndicators({ closes, highs, lows, volumes });

    return NextResponse.json({
      candles: candles.slice(-30), // last 30 days for chart
      indicators,
    });
  } catch (err) {
    console.error("Chart error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
