"use client";
import { useState } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import Link from "next/link";

export default function StockCard({ stock }) {
  const [loading, setLoading] = useState(false);
  const [news, setNews] = useState([]);
  const [signal, setSignal] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const { buyStock, sellStock, portfolio, removeFromWatchlist, tradingMode } =
    useTradingStore();

  const holding = portfolio.find((p) => p.symbol === stock.symbol);
  const [marketContext, setMarketContext] = useState(null);
  const [memory, setMemory] = useState(null);

  const analyzeStock = async () => {
    setLoading(true);
    try {
      const memoryRes = await fetch(`/api/memory?symbol=${stock.symbol}`);
      const memoryData = await memoryRes.json();
      setMemory(memoryData);
      const hasMemory = memoryData && memoryData.lastAnalysis;

      // Always fetch market context + news, chart only if no memoryData
      const fetchPromises = [
        fetch(`/api/news?symbol=${stock.symbol}`),
        fetch(`/api/market-context?symbol=${stock.symbol}`),
        ...(!hasMemory ? [fetch(`/api/chart?symbol=${stock.symbol}`)] : []),
      ];

      const responses = await Promise.all(fetchPromises);
      const newsData = await responses[0].json();
      const marketContextData = await responses[1].json();
      const chartData = !hasMemory ? await responses[2].json() : null;

      setNews(newsData);
      setMarketContext(marketContextData);

      const aiRes = await fetch("/api/ai-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockData: stock,
          news: newsData,
          chartData,
          memory: hasMemory ? memoryData : null,
          marketContext: marketContextData,
          tradingMode,
        }),
      });

      const aiData = await aiRes.json();
      if (!aiRes.ok) return toast.error(aiData.error || "AI analysis failed");
      setSignal(aiData);

      // Save memory
      if (aiData.memoryUpdate) {
        const newMemory = {
          ...memoryData,
          character: aiData.memoryUpdate.character,
          behavior: aiData.memoryUpdate.behavior,
          keyLevels: aiData.memoryUpdate.keyLevels,
          lastAnalysis: {
            signal: aiData.signal,
            confidence: aiData.confidence,
            rsi: chartData?.indicators?.rsi || memoryData?.lastAnalysis?.rsi,
            trend:
              chartData?.indicators?.trend || memoryData?.lastAnalysis?.trend,
            reason: aiData.reason,
            stopLoss: aiData.stopLoss,
            target: aiData.target,
            price: stock.price,
            date: new Date(),
          },
          signalHistory: [
            ...(memoryData?.signalHistory || []),
            {
              signal: aiData.signal,
              confidence: aiData.confidence,
              price: stock.price,
              date: new Date(),
              outcome: "PENDING",
            },
          ].slice(-20),
        };

        await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: stock.symbol, memory: newMemory }),
        });
      }

      toast.success(
        hasMemory ? "⚡ Quick analysis done!" : "🧠 Deep analysis done!",
      );
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const signalStyles = {
    BUY: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    SELL: "bg-red-500/20 text-red-400 border border-red-500/30",
    HOLD: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
      {/* Header */}
      <Link
        href={`/stock/${stock.symbol}`}
        className="block hover:opacity-80 transition-opacity"
      >
        <div className="flex justify-between items-start">
          <div>
            <h3 className="text-lg font-bold text-white">
              {stock.symbol?.replace(".NS", "").replace(".BO", "")}
            </h3>
            <p className="text-xs text-zinc-400 max-w-[140px] truncate">
              {stock.name}
            </p>
            <span className="text-xs text-zinc-500">
              {stock.exchange || "NSE"}
            </span>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-white">
              ₹{stock.price?.toFixed(2)}
            </div>
            <div
              className={`text-sm font-medium ${stock.change >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {stock.change >= 0 ? "▲" : "▼"}{" "}
              {Math.abs(stock.change).toFixed(2)}%
            </div>
          </div>
        </div>
      </Link>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        {[
          { label: "Open", value: `₹${stock.open?.toFixed(2)}` },
          { label: "Prev Close", value: `₹${stock.prevClose?.toFixed(2)}` },
          { label: "High", value: `₹${stock.high?.toFixed(2)}` },
          { label: "Low", value: `₹${stock.low?.toFixed(2)}` },
          {
            label: "52W High",
            value: `₹${stock.fiftyTwoWeekHigh?.toFixed(2)}`,
          },
          {
            label: "52W Low",
            value: `₹${stock.fiftyTwoWeekLow?.toFixed(2)}`,
          },
          { label: "Volume", value: stock.volume?.toLocaleString("en-IN") },
          {
            label: "Holding",
            value: holding ? `${holding.quantity} qty` : "None",
          },
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-800 rounded-lg px-3 py-2">
            <div className="text-zinc-500 text-xs">{label}</div>
            <div className="text-white font-medium text-sm">{value}</div>
          </div>
        ))}
      </div>

      {signal?.memoryUpdate && (
        <div className="bg-zinc-800/50 rounded-lg px-3 py-2 text-xs text-zinc-400 border border-zinc-700/50 flex justify-between items-center">
          <span>🧠 {signal.memoryUpdate.character}</span>
          {memory?.winRate && (
            <span
              className={`font-bold ${memory.winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}
            >
              {memory.winRate}% WR
            </span>
          )}
        </div>
      )}

      {/* AI Signal */}
      {signal && (
        <div className="bg-zinc-800 rounded-lg p-3 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <span
              className={`text-sm font-bold px-3 py-1 rounded-full ${signalStyles[signal.signal]}`}
            >
              {signal.signal}
            </span>
            <span className="text-xs text-zinc-400">
              Confidence: {signal.confidence}/10
            </span>
          </div>
          {signal && marketContext && (
            <div className="flex gap-2 text-xs flex-wrap">
              <span
                className={`px-2 py-0.5 rounded-full ${
                  marketContext.nifty?.change >= 0
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                NIFTY {marketContext.nifty?.change >= 0 ? "▲" : "▼"}
                {Math.abs(marketContext.nifty?.change || 0).toFixed(2)}%
              </span>
              <span
                className={`px-2 py-0.5 rounded-full ${
                  marketContext.sector?.change >= 0
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-red-500/20 text-red-400"
                }`}
              >
                {marketContext.sector?.name}{" "}
                {marketContext.sector?.change >= 0 ? "▲" : "▼"}
                {Math.abs(marketContext.sector?.change || 0).toFixed(2)}%
              </span>
            </div>
          )}
          <p className="text-sm text-zinc-300">{signal.reason}</p>
          <div className="flex gap-3 text-xs">
            <span className="text-red-400">Stop Loss: ₹{signal.stopLoss}</span>
            <span className="text-emerald-400">Target: ₹{signal.target}</span>
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-zinc-700">
            <span className="text-xs text-zinc-500">Risk:</span>
            <span
              className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                signal.riskLevel === "LOW"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : signal.riskLevel === "HIGH"
                    ? "bg-red-500/20 text-red-400"
                    : "bg-yellow-500/20 text-yellow-400"
              }`}
            >
              {signal.riskLevel}
            </span>
          </div>

          {/* News */}
          {news.length > 0 && (
            <div className="flex flex-col gap-1 pt-1 border-t border-zinc-700">
              <div className="text-xs text-zinc-500 font-medium mb-1">
                Recent News
              </div>
              {news.slice(0, 3).map((n, i) => (
                <a
                  key={i}
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-zinc-300 hover:text-white bg-zinc-900 rounded-lg px-3 py-2 leading-relaxed hover:bg-zinc-700 transition-colors"
                >
                  {n.title}
                  <span className="block text-zinc-500 mt-0.5">
                    {n.source} ·{" "}
                    {new Date(n.pubDate).toLocaleDateString("en-IN")}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Quantity + Actions */}
      <div className="flex gap-2 items-center">
        <input
          type="number"
          min={1}
          max={holding ? holding.quantity : undefined}
          value={quantity}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (isNaN(val) || val < 1) return setQuantity(1);
            if (holding && val > holding.quantity)
              return setQuantity(holding.quantity);
            setQuantity(val);
          }}
          className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-2 text-white text-sm text-center focus:outline-none focus:border-zinc-500"
        />
        <button
          onClick={analyzeStock}
          disabled={loading}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          {loading ? "Analyzing..." : "🤖 AI Analyze"}
        </button>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => buyStock(stock, quantity, stock.price)}
          className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Buy
        </button>
        <button
          onClick={async () => {
            if (!holding) return toast.error("No holding to sell");
            const result = await sellStock(stock.symbol, quantity, stock.price);
            if (result === "oversell")
              return toast.error(`You only have ${holding.quantity} qty!`);
            toast.success(
              `Sold ${quantity} × ${stock.symbol?.replace(".NS", "")}`,
            );
          }}
          disabled={!holding}
          className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Sell
        </button>
        <button
          onClick={() => removeFromWatchlist(stock.symbol)}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm px-3 py-2 rounded-lg transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
