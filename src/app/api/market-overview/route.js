import { NextResponse } from "next/server";

async function fetchQuote(symbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const change =
      ((meta.regularMarketPrice - meta.chartPreviousClose) /
        meta.chartPreviousClose) *
      100;
    return {
      price: meta.regularMarketPrice,
      change: parseFloat(change.toFixed(2)),
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      prevClose: meta.chartPreviousClose,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const [nifty, bankNifty, sensex, niftyIT, niftyMidcap] = await Promise.all([
      fetchQuote("^NSEI"),
      fetchQuote("^NSEBANK"),
      fetchQuote("^BSESN"),
      fetchQuote("NIFTY_IT.NS"),
      fetchQuote("^NSEMDCP50"),
    ]);

    return NextResponse.json({
      nifty,
      bankNifty,
      sensex,
      niftyIT,
      niftyMidcap,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
