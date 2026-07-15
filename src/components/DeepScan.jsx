"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import { Search, TrendingUp } from "lucide-react";
import Link from "next/link";
import { isMarketOpenNow } from "@/lib/attemptAutoBuy";
import MoverActions from "./MoverActions";

// Much heavier than MarketScan's today's-movers scan (quote-scans the whole
// market, then runs real chart checks on 40 candidates instead of 15), so
// this auto-scan runs far less often.
const AUTO_SCAN_INTERVAL_MS = 30 * 60 * 1000; // 30 min

export default function DeepScan() {
  const { tradingMode, watchlist, addToWatchlist } = useTradingStore();
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [repeatPicks, setRepeatPicks] = useState(null);
  const [autoScan, setAutoScan] = useState(true);
  const [analyzing, setAnalyzing] = useState(null);
  const [quickResults, setQuickResults] = useState({});
  const tradingModeRef = useRef(tradingMode);
  useEffect(() => {
    tradingModeRef.current = tradingMode;
  }, [tradingMode]);

  const watchlistSymbols = new Set(watchlist.map((s) => s.symbol));

  const loadRepeatPicks = async () => {
    try {
      const res = await fetch("/api/deep-scan");
      const data = await res.json();
      setRepeatPicks(data.repeatPicks || []);
      if (data.latestSnapshot && results === null) {
        setResults(data.latestSnapshot.results || []);
        setMeta({
          scanned: data.latestSnapshot.scannedCount,
          candidates: data.latestSnapshot.candidateCount,
        });
      }
    } catch (err) {
      console.error("Failed to load deep-scan repeat picks:", err);
    }
  };

  const handleAddToWatchlist = async (m) => {
    await addToWatchlist({ symbol: m.symbol, name: m.name, exchange: "NSE" });
    toast.success(`${m.symbol.replace(".NS", "")} added to watchlist`);
  };

  const handleQuickAnalyze = async (m) => {
    setAnalyzing(m.symbol);
    try {
      const { runAnalysis } = await import("@/lib/runAnalysis");
      const result = await runAnalysis(m, tradingModeRef.current, true);
      setQuickResults((prev) => ({
        ...prev,
        [m.symbol]: { signal: result.signal, confidence: result.confidence },
      }));
      toast.success(
        `${m.symbol.replace(".NS", "")}: ${result.signal} (confidence ${result.confidence}/10)`,
      );
    } catch (err) {
      toast.error(err.message || "Analysis failed");
    } finally {
      setAnalyzing(null);
    }
  };

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/deep-scan", { method: "POST" });
      const data = await res.json();
      if (data.error) return toast.error(data.error);

      setResults(data.results);
      setMeta({ scanned: data.scannedCount, candidates: data.candidateCount });
      const actionableCount = data.results.filter((r) => r.actionable).length;
      toast.success(
        `Deep-scanned ${data.checkedCount} of ${data.scannedCount} liquid stocks — ${actionableCount} worth trading`,
      );
      loadRepeatPicks();
    } catch (err) {
      toast.error("Deep scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- plain fetch-on-mount, same pattern as MarketScan
    loadRepeatPicks();
  }, []);

  useEffect(() => {
    if (!autoScan) return;
    const tick = () => {
      if (isMarketOpenNow()) runScan();
    };
    tick();
    const id = setInterval(tick, AUTO_SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoScan, runScan]);

  const actionable = results?.filter((r) => r.actionable) || [];

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-purple-400" />
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Deep Market Scan — whole NSE, not just today&apos;s movers
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScan}
              onChange={(e) => setAutoScan(e.target.checked)}
              className="accent-purple-500"
            />
            Auto-scan every 30min
          </label>
          <button
            onClick={runScan}
            disabled={scanning}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            {scanning ? "Scanning…" : "🔎 Deep Scan"}
          </button>
        </div>
      </div>

      {results === null && (
        <p className="text-xs text-zinc-500">
          Free, numeric-only check across the whole liquid NSE universe (price
          ≥ ₹20, volume ≥ 50,000 — penny/illiquid stocks filtered out). Unlike
          Today&apos;s Top Movers, this doesn&apos;t require a stock to already
          be up today — it checks the top 40 candidates by chart strength for
          a genuine volume+trend+MACD setup that clears the 1% cost floor. No
          AI spent. This is heavy (scans ~{meta?.scanned || "9,000+"} stocks),
          so it runs every 30 minutes, not continuously.
        </p>
      )}

      {results !== null && actionable.length === 0 && (
        <p className="text-xs text-zinc-500">
          Checked {results.length} candidates from {meta?.candidates} liquid
          stocks ({meta?.scanned} scanned) — none clear the bar right now.
        </p>
      )}

      {actionable.length > 0 && (
        <div className="flex flex-col gap-2 mb-2">
          <p className="text-[11px] text-zinc-400 mb-1">
            Checked {results.length} of {meta?.candidates} liquid candidates
            ({meta?.scanned} scanned) — {actionable.length} worth trading.
          </p>
          {actionable.map((m) => (
            <div
              key={m.symbol}
              className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-emerald-500/10 border border-emerald-700/50 hover:bg-emerald-500/15 rounded-lg px-3 py-2.5 transition-colors"
            >
              <Link href={`/stock/${m.symbol}`} className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">
                  {m.symbol?.replace(".NS", "")}{" "}
                  <span className={m.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}>
                    {m.changePercent >= 0 ? "+" : ""}
                    {m.changePercent}%
                  </span>
                </div>
                <div className="text-xs text-zinc-500 truncate">{m.name}</div>
                <div className="text-[11px] text-zinc-500 truncate">{m.actionableReason}</div>
              </Link>
              <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
                <span className="text-xs text-zinc-500 tabular-nums shrink-0">₹{m.price}</span>
                <MoverActions
                  m={m}
                  inWatchlist={watchlistSymbols.has(m.symbol)}
                  analyzing={analyzing}
                  quickResult={quickResults[m.symbol]}
                  onAdd={handleAddToWatchlist}
                  onAnalyze={handleQuickAnalyze}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {repeatPicks?.length > 0 && (
        <div className="mt-5 pt-4 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Repeat Picks — worth trading on 2+ separate days
            </h3>
          </div>
          <div className="flex flex-col gap-2">
            {repeatPicks.map((m) => (
              <div
                key={m.symbol}
                className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors"
              >
                <Link href={`/stock/${m.symbol}`} className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate">
                    {m.symbol?.replace(".NS", "")}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">{m.name}</div>
                </Link>
                <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
                  <span className="text-xs text-amber-400 tabular-nums shrink-0">
                    {m.daysAppeared} days
                  </span>
                  <MoverActions
                    m={m}
                    inWatchlist={watchlistSymbols.has(m.symbol)}
                    analyzing={analyzing}
                    quickResult={quickResults[m.symbol]}
                    onAdd={handleAddToWatchlist}
                    onAnalyze={handleQuickAnalyze}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
