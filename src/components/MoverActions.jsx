"use client";

// Shared inline row-actions (Add to Watchlist + Analyze) used by both the
// today's-movers scan (MarketScan) and the whole-market deep scan (DeepScan)
// — same free-standing quick-analyze + watchlist-add flow either way.
export default function MoverActions({ m, inWatchlist, analyzing, quickResult, onAdd, onAnalyze }) {
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
