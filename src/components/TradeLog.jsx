"use client";
import useTradingStore from "@/store/tradingStore";

export default function TradeLog() {
  const { tradeLog } = useTradingStore();

  if (tradeLog.length === 0)
    return (
      <div className="text-center text-zinc-500 py-10 text-sm">
        No trades yet
      </div>
    );

  return (
    <div className="flex flex-col gap-2">
      {[...tradeLog].reverse().map((trade) => (
        <div
          key={trade.id}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex justify-between items-center"
        >
          <div className="flex items-center gap-3">
            <span
              className={`text-xs font-bold px-2 py-1 rounded-full ${trade.type === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
            >
              {trade.type}
            </span>
            <div>
              <div className="text-white font-medium text-sm">
                {trade.symbol?.replace(".NS", "").replace(".BO", "")}
              </div>
              <div className="text-zinc-500 text-xs">
                {new Date(trade.time).toLocaleString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-white text-sm font-medium">
              ₹{trade.total?.toFixed(2)}
            </div>
            {trade.pnl !== undefined && (
              <div
                className={`text-xs font-medium ${trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
              >
                {trade.pnl >= 0 ? "+" : ""}₹{trade.pnl?.toFixed(2)}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
