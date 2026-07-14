import { NextResponse } from "next/server";
import { SECTOR_ETF, fetchQuote } from "@/lib/sectors";

// Free (Yahoo, no Kite/AI cost) overview of NIFTY sub-sector indices, so the
// user can see which sectors are actually hot today without eyeballing the
// top-movers list stock by stock.
export async function GET() {
  const sectors = Object.keys(SECTOR_ETF);
  const quotes = await Promise.all(sectors.map((s) => fetchQuote(SECTOR_ETF[s])));

  const results = sectors
    .map((name, i) => ({ name, change: quotes[i]?.change ?? null }))
    .filter((s) => s.change !== null)
    .sort((a, b) => b.change - a.change);

  return NextResponse.json({ sectors: results });
}
