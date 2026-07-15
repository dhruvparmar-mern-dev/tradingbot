"use client";
import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertCircle, TrendingDown, Eye } from "lucide-react";
import useTradingStore from "@/store/tradingStore";

export default function WatchlistInsights() {
  const { tradingMode } = useTradingStore();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [analyzing, setAnalyzing] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist-insights");
      const json = await res.json();
      setData(json);
    } catch (err) {
      toast.error("Failed to load watchlist insights");
    } finally {
      setLoading(false);
    }
  };

  const quickAnalyze = async (stock) => {
    setAnalyzing(stock.symbol);
    try {
      const { runAnalysis } = await import("@/lib/runAnalysis");
      const result = await runAnalysis(
        { symbol: stock.symbol, name: stock.name },
        tradingMode,
        true,
      );
      toast.success(
        `${stock.symbol.replace(".NS", "")}: ${result.signal} (confidence ${result.confidence}/10)`,
      );
    } catch (err) {
      toast.error(err.message || "Analysis failed");
    } finally {
      setAnalyzing(null);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Watchlist Health Check
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {loading ? "Checking…" : "🔍 Check Watchlist"}
        </button>
      </div>

      {!data && !loading && (
        <p className="text-xs text-zinc-500">
          Free, numeric-only check across your active watchlist — no AI spent.
          Finds stocks you never analyze, stocks that keep losing real money,
          and stocks you&apos;ve skipped that moved well anyway.
        </p>
      )}

      {data && (
        <div className="flex flex-col gap-5">
          {/* Losing stocks */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wider">
                Consistently Losing ({data.losingStocks.length})
              </h3>
            </div>
            {data.losingStocks.length === 0 ? (
              <p className="text-xs text-zinc-500">
                No watchlist stock has a net-negative real trade record.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.losingStocks.map((s) => (
                  <Link
                    key={s.symbol}
                    href={`/stock/${s.symbol}`}
                    className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white truncate">
                        {s.symbol?.replace(".NS", "")}
                      </div>
                      <div className="text-[11px] text-zinc-500">
                        {s.tradeCount} trades · {s.winRate}% win rate
                      </div>
                    </div>
                    <span className="text-xs text-red-400 tabular-nums shrink-0">
                      ₹{s.totalPnl}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Never analyzed */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Eye className="w-4 h-4 text-zinc-400" />
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Never Analyzed ({data.neverAnalyzed.length})
              </h3>
            </div>
            {data.neverAnalyzed.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Every watchlist stock has been analyzed at least once.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.neverAnalyzed.map((s) => (
                  <div
                    key={s.symbol}
                    className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors gap-3"
                  >
                    <Link href={`/stock/${s.symbol}`} className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white truncate">
                        {s.symbol?.replace(".NS", "")}
                      </div>
                      <div className="text-[11px] text-zinc-500 truncate">{s.name}</div>
                    </Link>
                    <button
                      onClick={() => quickAnalyze(s)}
                      disabled={analyzing === s.symbol}
                      className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 px-2 py-1 rounded-md hover:bg-blue-500/10 transition-colors shrink-0"
                    >
                      {analyzing === s.symbol ? "Analyzing…" : "Analyze"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Missed opportunity */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                Missed Opportunity ({data.missedOpportunity.length})
              </h3>
            </div>
            <p className="text-[11px] text-zinc-500 mb-2">
              Never analyzed, but the real chart moved meaningfully since being added.
            </p>
            {data.missedOpportunity.length === 0 ? (
              <p className="text-xs text-zinc-500">None right now.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.missedOpportunity.map((s) => (
                  <div
                    key={s.symbol}
                    className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors gap-3"
                  >
                    <Link href={`/stock/${s.symbol}`} className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white truncate">
                        {s.symbol?.replace(".NS", "")}
                      </div>
                      <div className="text-[11px] text-zinc-500">since {s.sinceDate}</div>
                    </Link>
                    <span
                      className={`text-xs tabular-nums shrink-0 ${s.changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {s.changePct >= 0 ? "+" : ""}
                      {s.changePct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
