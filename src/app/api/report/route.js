import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Trade from "@/models/Trade";
import Stock from "@/models/Stock";

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "both";

  const trades = await Trade.find({});
  const stocks = await Stock.find({});

  // Group trades by symbol
  const symbolMap = {};
  for (const trade of trades) {
    if (!symbolMap[trade.symbol]) {
      symbolMap[trade.symbol] = { buys: [], sells: [] };
    }
    if (trade.type === "BUY") symbolMap[trade.symbol].buys.push(trade);
    if (trade.type === "SELL") symbolMap[trade.symbol].sells.push(trade);
  }

  const report = stocks.map((stock) => {
    const trades = symbolMap[stock.symbol] || { buys: [], sells: [] };
    const totalBuys = trades.buys.length;
    const totalSells = trades.sells.length;
    const realizedPnL = trades.sells.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const wins = trades.sells.filter((t) => t.pnl > 0).length;
    const losses = trades.sells.filter((t) => t.pnl < 0).length;
    const winRate =
      totalSells > 0 ? ((wins / totalSells) * 100).toFixed(0) : null;

    const memory =
      mode === "intraday"
        ? stock.memoryIntraday
        : mode === "swing"
          ? stock.memorySwing
          : stock.memoryIntraday?.lastAnalysis ||
              stock.memorySwing?.lastAnalysis
            ? stock.memoryIntraday?.lastAnalysis?.date >
              stock.memorySwing?.lastAnalysis?.date
              ? stock.memoryIntraday
              : stock.memorySwing
            : null;

    return {
      symbol: stock.symbol,
      name: stock.name,
      totalTrades: totalBuys + totalSells,
      totalBuys,
      totalSells,
      realizedPnL: parseFloat(realizedPnL.toFixed(2)),
      wins,
      losses,
      winRate: winRate ? `${winRate}%` : "N/A",
      neverTraded: totalBuys === 0,
      lastSignal: memory?.lastAnalysis?.signal || null,
      lastConfidence: memory?.lastAnalysis?.confidence || null,
      lastSignalDate: memory?.lastAnalysis?.date || null,
      aiCharacter: memory?.character || null,
      aiBehavior: memory?.behavior || null,
    };
  });

  // Sort: traded stocks first, then by P&L descending
  report.sort((a, b) => {
    if (a.neverTraded && !b.neverTraded) return 1;
    if (!a.neverTraded && b.neverTraded) return -1;
    return b.realizedPnL - a.realizedPnL;
  });

  const summary = {
    totalStocks: report.length,
    tradedStocks: report.filter((r) => !r.neverTraded).length,
    neverTradedStocks: report.filter((r) => r.neverTraded).length,
    totalRealizedPnL: parseFloat(
      report.reduce((sum, r) => sum + r.realizedPnL, 0).toFixed(2),
    ),
    totalWins: report.reduce((sum, r) => sum + r.wins, 0),
    totalLosses: report.reduce((sum, r) => sum + r.losses, 0),
  };

  return NextResponse.json({ summary, stocks: report });
}
