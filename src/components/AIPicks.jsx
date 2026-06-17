"use client";
import { useEffect, useState } from "react";
import useTradingStore from "@/store/tradingStore";
import { TrendingUp } from "lucide-react";
import Link from "next/link";

export default function AIPicks() {
  const { tradingMode } = useTradingStore();
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPicks();
  }, [tradingMode]);

  const fetchPicks = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ai-picks?mode=${tradingMode}`);
      const data = await res.json();
      setPicks(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  if (loading) return null;
  if (!picks.length) return null;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-emerald-400" />
        <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          AI Top Picks ({tradingMode})
        </h2>
      </div>

      <div className="flex flex-col gap-2">
        {picks.slice(0, 5).map((pick) => (
          <Link
            key={pick.symbol}
            href={`/stock/${pick.symbol}`}
            className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 shrink-0">
                BUY
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {pick.symbol?.replace(".NS", "").replace(".BO", "")}
                </div>
                <div className="text-xs text-zinc-500 truncate max-w-[200px]">
                  {pick.reason}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {pick.winRate != null && (
                <span
                  className={`text-xs font-medium ${pick.winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {pick.winRate}% WR
                </span>
              )}
              <span className="text-xs text-zinc-400">
                {pick.confidence}/10
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
