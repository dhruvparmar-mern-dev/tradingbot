import { NextResponse } from "next/server";
import { SECTOR_MAP, SECTOR_ETF, fetchQuote } from "@/lib/sectors";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  const cleanSymbol = symbol?.replace(/\.(NS|BO)$/i, "").toUpperCase();
  const sector = SECTOR_MAP[cleanSymbol] || "UNKNOWN";
  const sectorSymbol = SECTOR_ETF[sector];

  try {
    // Fetch NIFTY 50 + sector in parallel
    const [nifty, sectorData] = await Promise.all([
      fetchQuote("^NSEI"),
      sectorSymbol ? fetchQuote(sectorSymbol) : Promise.resolve(null),
    ]);

    // Market sentiment. Threshold widened from 0.5% -- NIFTY's ordinary daily
    // noise routinely crosses +/-0.5%, so that bar was labeling normal flat
    // days as BEARISH/BULLISH and triggering the AI prompt's market-context
    // caution rule on days with no real risk-on/risk-off signal (confirmed
    // live 2026-07-14: NIFTY sat at -0.55% to -0.59% most of the day, an
    // ordinary drift, but was labeled BEARISH and cited in nearly every HOLD).
    let marketSentiment = "NEUTRAL";
    if (nifty?.change > 1.0) marketSentiment = "BULLISH";
    else if (nifty?.change < -1.0) marketSentiment = "BEARISH";

    // Sector sentiment
    let sectorSentiment = "NEUTRAL";
    if (sectorData?.change > 1.0) sectorSentiment = "BULLISH";
    else if (sectorData?.change < -1.0) sectorSentiment = "BEARISH";

    return NextResponse.json({
      nifty: {
        price: nifty?.price,
        change: nifty?.change,
        sentiment: marketSentiment,
      },
      sector: {
        name: sector,
        change: sectorData?.change || null,
        sentiment: sectorSentiment,
      },
      marketSentiment,
      summary: `NIFTY ${nifty?.change >= 0 ? "▲" : "▼"} ${Math.abs(nifty?.change || 0).toFixed(2)}% | ${sector} sector ${sectorData?.change >= 0 ? "▲" : "▼"} ${Math.abs(sectorData?.change || 0).toFixed(2)}%`,
    });
  } catch (err) {
    console.error("Market context error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
