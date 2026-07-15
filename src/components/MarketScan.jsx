"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import { Radar, TrendingUp, Target } from "lucide-react";
import Link from "next/link";
import { isMarketOpenNow } from "@/lib/attemptAutoBuy";
import SectorOverview from "./SectorOverview";

const AUTO_SCAN_INTERVAL_MS = 10 * 60 * 1000; // 10 min — full-market scan, no need for tighter

function MoverActions({ m, inWatchlist, analyzing, quickResult, onAdd, onAnalyze }) {
  const signalColor =
    quickResult?.signal === "BUY"
      ? "text-emerald-400"
      : quickResult?.signal === "SELL"
        ? "text-red-400"
        : "text-amber-400";
  return (
    <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.preventDefault()}>
      {quickResult && (
        <span className={`text-[11px] font-medium ${signalColor}`}>
          {quickResult.signal} {quickResult.confidence}/10
        </span>
      )}
      <button
        onClick={() => onAnalyze(m)}
        disabled={analyzing === m.symbol}
        title="Run AI analysis"
        className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 px-2 py-1 rounded-md hover:bg-blue-500/10 transition-colors"
      >
        {analyzing === m.symbol ? "Analyzing…" : "Analyze"}
      </button>
      <button
        onClick={() => onAdd(m)}
        disabled={inWatchlist}
        title={inWatchlist ? "Already in watchlist" : "Add to watchlist"}
        className="text-xs text-purple-400 hover:text-purple-300 disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded-md hover:bg-purple-500/10 transition-colors"
      >
        {inWatchlist ? "In watchlist" : "+ Watchlist"}
      </button>
    </div>
  );
}

export default function MarketScan() {
  const { tradingMode, watchlist, addToWatchlist } = useTradingStore();
  const [scanning, setScanning] = useState(false);
  const [movers, setMovers] = useState(null);
  const [meta, setMeta] = useState(null);
  const [repeatMovers, setRepeatMovers] = useState(null);
  const [autoScan, setAutoScan] = useState(true);
  const [analyzing, setAnalyzing] = useState(null); // symbol currently being analyzed
  const [quickResults, setQuickResults] = useState({}); // symbol -> {signal, confidence}
  const tradingModeRef = useRef(tradingMode);
  useEffect(() => {
    tradingModeRef.current = tradingMode;
  }, [tradingMode]);

  const watchlistSymbols = new Set(watchlist.map((s) => s.symbol));

  const loadRepeatMovers = async () => {
    try {
      const res = await fetch("/api/market-scan");
      const data = await res.json();
      setRepeatMovers(data.repeatMovers || []);
      // Hydrate from the last scan's snapshot so a tab revisit shows
      // something immediately instead of blank until the next auto-scan.
      if (data.latestSnapshot && movers === null) {
        setMovers(data.latestSnapshot.movers || []);
        setMeta({
          scanned: data.latestSnapshot.scannedCount,
          candidates: data.latestSnapshot.candidateCount,
        });
      }
    } catch (err) {
      console.error("Failed to load repeat movers:", err);
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

  const scanMarket = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/market-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: tradingModeRef.current }),
      });
      const data = await res.json();
      if (data.error) return toast.error(data.error);

      setMovers(data.movers);
      setMeta({ scanned: data.scannedCount, candidates: data.candidateCount });
      toast.success(`Scanned ${data.scannedCount} stocks — no AI spent yet`);
      loadRepeatMovers();
    } catch (err) {
      toast.error("Market scan failed");
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- plain fetch-on-mount, matches the pattern already used elsewhere (StockCard's loadExistingSignal)
    loadRepeatMovers();
  }, []);

  // Only runs while this tab is open in a browser — same client-side-poll
  // limitation as useAutoTrader (no server cron on the free Vercel tier).
  useEffect(() => {
    if (!autoScan) return;
    const tick = () => {
      if (isMarketOpenNow()) scanMarket();
    };
    tick();
    const id = setInterval(tick, AUTO_SCAN_INTERVAL_MS);
    return () => clearInterval(id);
  }, [autoScan, scanMarket]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <SectorOverview />
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-purple-400" />
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Today&apos;s Top Movers
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
            Auto-scan every 10min
          </label>
          <button
            onClick={scanMarket}
            disabled={scanning}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            {scanning ? "Scanning market..." : "🔍 Scan Whole Market"}
          </button>
        </div>
      </div>

      {movers === null && (
        <p className="text-xs text-zinc-500">
          Numeric filter only — no AI involved, zero cost. Scans the full NSE
          list for today&apos;s biggest movers still near their day&apos;s high.
          This is NOT an AI recommendation — a stock showing up here has
          already moved, so it may well be a HOLD or even overextended. Click
          into any stock to run AI analysis yourself if it looks interesting.
          Auto-scan only runs while this tab is open in your browser.
        </p>
      )}

      {movers?.some((m) => m.actionable) && (
        <div className="mb-4 rounded-xl border border-emerald-700/50 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              Bot&apos;s Pick — worth a look today
            </h3>
          </div>
          <p className="text-[11px] text-zinc-400 mb-3">
            Free numeric check only (no AI spent) — volume, trend, and MACD
            all aligned, and the target clears the 1% cost floor. Click through
            and run AI analysis yourself for the full reasoning before buying.
          </p>
          <div className="flex flex-col gap-2">
            {movers.filter((m) => m.actionable).map((m) => (
              <div
                key={m.symbol}
                className="flex items-center justify-between bg-zinc-900/60 hover:bg-zinc-900 rounded-lg px-3 py-2.5 transition-colors gap-3"
              >
                <Link href={`/stock/${m.symbol}`} className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate">
                    {m.symbol?.replace(".NS", "")}{" "}
                    <span className="text-emerald-400">+{m.changePercent}%</span>
                  </div>
                  <div className="text-[11px] text-zinc-500 truncate">
                    {m.actionableReason}
                  </div>
                </Link>
                <span className="text-xs text-zinc-500 tabular-nums shrink-0">
                  ₹{m.price}
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
            ))}
          </div>
        </div>
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
            <div
              key={m.symbol}
              className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors gap-3"
            >
              <Link href={`/stock/${m.symbol}`} className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">
                  {m.symbol?.replace(".NS", "")}
                </div>
                <div className="text-xs text-zinc-500 truncate">
                  {m.name}
                </div>
              </Link>
              <span className="text-xs text-emerald-400 tabular-nums shrink-0">
                +{m.changePercent}%
              </span>
              <span className="text-xs text-zinc-500 tabular-nums shrink-0">
                ₹{m.price}
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
          ))}
        </div>
      )}

      {repeatMovers?.length > 0 && (
        <div className="mt-5 pt-4 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              All-Time Top Movers — repeat appearances
            </h3>
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            Stocks that have shown up in the scan on 2+ separate days — a
            repeat appearance is a stronger momentum signal than a single
            day&apos;s move.
          </p>
          <div className="flex flex-col gap-2">
            {repeatMovers.map((m) => (
              <div
                key={m.symbol}
                className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors gap-3"
              >
                <Link href={`/stock/${m.symbol}`} className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white truncate">
                    {m.symbol?.replace(".NS", "")}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {m.name}
                  </div>
                </Link>
                <span className="text-xs text-amber-400 tabular-nums shrink-0">
                  {m.daysAppeared} days
                </span>
                <span className="text-xs text-zinc-500 tabular-nums shrink-0">
                  best +{m.bestChangePercent}%
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
