import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import Stock from "@/models/Stock";
import Trade from "@/models/Trade";
import { getNSEInstruments } from "@/lib/kiteInstruments";

// Free, numeric-only watchlist health check — no AI spent. Surfaces three
// things a user can't easily eyeball from the plain watchlist list: stocks
// never analyzed at all, stocks whose real trades have been consistently
// losing, and stocks never analyzed whose real chart move since being added
// would have been profitable anyway (a missed-opportunity signal).
const MISSED_OPPORTUNITY_MIN_PCT = 3; // only flag if the move is non-trivial

export async function GET() {
  await connectDB();
  const stocks = await Stock.find({ inWatchlist: { $ne: false } }).lean();

  const neverAnalyzed = [];
  const analyzedSymbols = [];
  for (const s of stocks) {
    const swingCount = s.memorySwing?.signalHistory?.length || 0;
    const intradayCount = s.memoryIntraday?.signalHistory?.length || 0;
    if (swingCount === 0 && intradayCount === 0) {
      neverAnalyzed.push({ symbol: s.symbol, name: s.name, addedAt: s.addedAt });
    } else {
      analyzedSymbols.push(s.symbol);
    }
  }

  // Losing stocks — aggregate real Trade P&L per symbol, only for symbols
  // that actually have completed (SELL) trades.
  const tradeStats = await Trade.aggregate([
    { $match: { type: "SELL", pnl: { $exists: true }, symbol: { $in: stocks.map((s) => s.symbol) } } },
    {
      $group: {
        _id: "$symbol",
        totalPnl: { $sum: "$pnl" },
        tradeCount: { $sum: 1 },
        wins: { $sum: { $cond: [{ $gt: ["$pnl", 0] }, 1, 0] } },
      },
    },
  ]);
  const losingStocks = tradeStats
    .filter((t) => t.totalPnl < 0)
    .map((t) => ({
      symbol: t._id,
      name: stocks.find((s) => s.symbol === t._id)?.name,
      totalPnl: parseFloat(t.totalPnl.toFixed(2)),
      tradeCount: t.tradeCount,
      winRate: parseFloat(((t.wins / t.tradeCount) * 100).toFixed(0)),
    }))
    .sort((a, b) => a.totalPnl - b.totalPnl);

  // Missed opportunity — for never-analyzed stocks only, check real daily
  // candles since being added (or last 30 days, whichever is shorter) for a
  // genuine move that would have been worth trading.
  const missedOpportunity = [];
  if (neverAnalyzed.length) {
    const session = await KiteSession.findOne({ userId: "default" });
    if (session?.accessToken) {
      kite.setAccessToken(session.accessToken);
      const instruments = (await getNSEInstruments()).filter((i) => i.instrument_type === "EQ");
      for (const s of neverAnalyzed) {
        const cleanSymbol = s.symbol.replace(".NS", "").replace(".BO", "");
        const inst = instruments.find((i) => i.tradingsymbol === cleanSymbol);
        if (!inst) continue;
        try {
          const to = new Date();
          const from = new Date(Math.max(new Date(s.addedAt || to).getTime(), to.getTime() - 30 * 24 * 60 * 60 * 1000));
          const candles = await kite.getHistoricalData(inst.instrument_token, "day", from, to);
          if (candles.length < 2) continue;
          const first = candles[0].open;
          const last = candles.at(-1).close;
          const changePct = ((last - first) / first) * 100;
          if (Math.abs(changePct) >= MISSED_OPPORTUNITY_MIN_PCT) {
            missedOpportunity.push({
              symbol: s.symbol,
              name: s.name,
              changePct: parseFloat(changePct.toFixed(2)),
              sinceDate: from.toISOString().slice(0, 10),
            });
          }
        } catch (err) {
          console.error(`Missed-opportunity check failed for ${s.symbol}:`, err.message);
        }
      }
      missedOpportunity.sort((a, b) => b.changePct - a.changePct);
    }
  }

  return NextResponse.json({ neverAnalyzed, losingStocks, missedOpportunity });
}
