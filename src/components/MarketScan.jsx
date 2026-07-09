"use client";
import { useState } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import Link from "next/link";

export default function MarketScan() {
  const { tradingMode } = useTradingStore();
  const [scanning, setScanning] = useState(false);
  const [picks, setPicks] = useState(null);
  const [meta, setMeta] = useState(null);

  const scanMarket = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/market-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: tradingMode }),
      });
      const data = await res.json();
      if (data.error) return toast.error(data.error);

      setPicks(data.picks.filter((p) => p.signal === "BUY"));
      setMeta({ scanned: data.scannedCount, candidates: data.candidateCount });
      toast.success(
        `Scanned ${data.scannedCount} stocks — ${data.candidateCount} passed the filter`,
      );
    } catch (err) {
      toast.error("Market scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-purple-400" />
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Market Scan ({tradingMode})
          </h2>
        </div>
        <button
          onClick={scanMarket}
          disabled={scanning}
          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {scanning ? "Scanning market..." : "🔍 Scan Whole Market"}
        </button>
      </div>

      {picks === null && (
        <p className="text-xs text-zinc-500">
          Scans the full NSE list for today&apos;s top movers, then runs AI
          analysis on the top {15}.
        </p>
      )}

      {picks?.length === 0 && (
        <p className="text-xs text-zinc-500">
          No BUY signals from today&apos;s scan ({meta?.candidates} stocks passed
          the numeric filter out of {meta?.scanned} scanned).
        </p>
      )}

      {picks?.length > 0 && (
        <div className="flex flex-col gap-2">
          {picks.map((pick) => (
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
                    {pick.symbol?.replace(".NS", "")}
                  </div>
                  <div className="text-xs text-zinc-500 truncate max-w-55">
                    {pick.reason}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-emerald-400 tabular-nums">
                  +{pick.changePercent}%
                </span>
                <span className="text-xs text-zinc-400">
                  {pick.confidence}/10
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
