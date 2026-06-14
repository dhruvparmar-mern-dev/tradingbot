"use client";
import useTradingStore from "@/store/tradingStore";

export default function AutoTradeSettings() {
  const {
    autoTrade,
    minConfidence,
    maxPerTrade,
    setAutoTrade,
    setMinConfidence,
    setMaxPerTrade,
  } = useTradingStore();

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-sm font-semibold text-white">Auto Trading</h3>
          <p className="text-xs text-zinc-500 mt-0.5">
            Bot trades automatically on AI signals
          </p>
        </div>
        <button
          onClick={() => setAutoTrade(!autoTrade)}
          className={`relative w-12 h-6 rounded-full transition-colors ${autoTrade ? "bg-emerald-500" : "bg-zinc-700"}`}
        >
          <div
            className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autoTrade ? "left-7" : "left-1"}`}
          />
        </button>
      </div>

      {autoTrade && (
        <div className="flex flex-col gap-3 pt-2 border-t border-zinc-800">
          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-400">Min Confidence</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={5}
                max={10}
                value={minConfidence}
                onChange={(e) => setMinConfidence(parseInt(e.target.value))}
                className="w-24"
              />
              <span className="text-xs text-white font-medium w-8">
                {minConfidence}/10
              </span>
            </div>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-zinc-400">Max per Trade</span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1000}
                max={50000}
                step={1000}
                value={maxPerTrade}
                onChange={(e) => setMaxPerTrade(parseInt(e.target.value))}
                className="w-24"
              />
              <span className="text-xs text-white font-medium w-16">
                ₹{maxPerTrade.toLocaleString("en-IN")}
              </span>
            </div>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2 text-xs text-yellow-400">
            ⚠️ Bot will auto buy when AI confidence ≥ {minConfidence}/10 and
            auto sell on target/stop loss
          </div>
        </div>
      )}
    </div>
  );
}
