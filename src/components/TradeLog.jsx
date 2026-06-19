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
      {[...tradeLog]
        .sort((a, b) => new Date(b.time) - new Date(a.time))
        .map((trade) => (
          <div
            key={trade._id || trade.id}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-3 flex justify-between items-center"
          >
            <div className="flex items-center gap-3">
              <span
                className={`text-xs font-bold px-2 py-1 rounded-full ${trade.type === "BUY" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
              >
                {trade.type}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium text-sm">
                    {trade.symbol?.replace(".NS", "").replace(".BO", "")}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${trade.mode === "intraday" ? "bg-orange-500/20 text-orange-400" : "bg-blue-500/20 text-blue-400"}`}
                  >
                    {trade.mode === "intraday" ? "⚡ Intraday" : "📅 Swing"}
                  </span>
                </div>
                <div className="text-zinc-500 text-xs tabular-nums">
                  {trade.quantity} qty @ ₹{trade.price?.toFixed(2)} ·{" "}
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
              <div className="text-white text-sm font-medium tabular-nums">
                ₹{trade.total?.toFixed(2)}
              </div>
              {trade.pnl !== undefined && trade.pnl !== null && (
                <div
                  className={`text-xs font-medium tabular-nums ${trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
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
