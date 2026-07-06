"use client";
import { X, TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function ReportModal({ report, onClose }) {
  if (!report) return null;
  const { summary, stocks } = report;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 overflow-auto p-4">
      <div className="max-w-4xl mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">Portfolio Report</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            {
              label: "Total Realized P&L",
              value: `${summary.totalRealizedPnL >= 0 ? "+" : ""}₹${summary.totalRealizedPnL}`,
              color:
                summary.totalRealizedPnL >= 0
                  ? "text-emerald-400"
                  : "text-red-400",
            },
            {
              label: "Win Rate",
              value: `${((summary.totalWins / (summary.totalWins + summary.totalLosses)) * 100 || 0).toFixed(0)}%`,
              color: "text-white",
            },
            {
              label: "Traded Stocks",
              value: `${summary.tradedStocks}/${summary.totalStocks}`,
              color: "text-white",
            },
            {
              label: "Never Traded",
              value: summary.neverTradedStocks,
              color: "text-zinc-400",
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-zinc-800 rounded-xl p-3">
              <div className="text-xs text-zinc-500 mb-1">{label}</div>
              <div className={`text-lg font-bold ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Stocks list */}
        <div className="flex flex-col gap-2">
          {stocks.map((stock) => (
            <div
              key={stock.symbol}
              className={`border rounded-xl p-4 ${
                stock.neverTraded
                  ? "border-zinc-800 bg-zinc-800/30 opacity-60"
                  : stock.realizedPnL >= 0
                    ? "border-emerald-900/50 bg-emerald-900/10"
                    : "border-red-900/50 bg-red-900/10"
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">
                      {stock.symbol?.replace(".NS", "")}
                    </span>
                    {stock.neverTraded && (
                      <span className="text-xs bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded-full">
                        Never traded
                      </span>
                    )}
                    {stock.lastSignal && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          stock.lastSignal === "BUY"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : stock.lastSignal === "SELL"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-yellow-500/20 text-yellow-400"
                        }`}
                      >
                        AI: {stock.lastSignal} {stock.lastConfidence}/10
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {stock.name}
                  </div>
                </div>
                {!stock.neverTraded && (
                  <div className="text-right">
                    <div
                      className={`font-bold ${stock.realizedPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {stock.realizedPnL >= 0 ? "+" : ""}₹{stock.realizedPnL}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {stock.wins}W / {stock.losses}L · {stock.winRate} WR
                    </div>
                  </div>
                )}
              </div>

              {stock.aiCharacter && (
                <p className="text-xs text-zinc-400 mt-1 line-clamp-2">
                  🧠 {stock.aiCharacter}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
