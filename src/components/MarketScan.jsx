"use client";
import { useState } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import { Radar } from "lucide-react";
import Link from "next/link";

export default function MarketScan() {
  const { tradingMode } = useTradingStore();
  const [scanning, setScanning] = useState(false);
  const [movers, setMovers] = useState(null);
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

      setMovers(data.movers);
      setMeta({ scanned: data.scannedCount, candidates: data.candidateCount });
      toast.success(`Scanned ${data.scannedCount} stocks — no AI spent yet`);
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
            Today&apos;s Top Movers
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

      {movers === null && (
        <p className="text-xs text-zinc-500">
          Numeric filter only — no AI involved, zero cost. Scans the full NSE
          list for today&apos;s biggest movers still near their day&apos;s high.
          This is NOT an AI recommendation — a stock showing up here has
          already moved, so it may well be a HOLD or even overextended. Click
          into any stock to run AI analysis yourself if it looks interesting.
        </p>
      )}

      {movers?.length === 0 && (
        <p className="text-xs text-zinc-500">
          No stocks passed today&apos;s numeric filter ({meta?.candidates} of{" "}
          {meta?.scanned} scanned).
        </p>
      )}

      {movers?.length > 0 && (
        <div className="flex flex-col gap-2">
          {movers.map((m) => (
            <Link
              key={m.symbol}
              href={`/stock/${m.symbol}`}
              className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {m.symbol?.replace(".NS", "")}
                </div>
                <div className="text-xs text-zinc-500 truncate">
                  {m.name}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-emerald-400 tabular-nums">
                  +{m.changePercent}%
                </span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  ₹{m.price}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
