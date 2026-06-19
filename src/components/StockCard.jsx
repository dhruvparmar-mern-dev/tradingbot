"use client";
import { useState, useEffect } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import Link from "next/link";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { ExternalLink, Newspaper, RefreshCw, X } from "lucide-react";
import { ScrollArea } from "./ui/scroll-area";
import { runAnalysis } from "@/lib/runAnalysis";

export default function StockCard({ stock }) {
  const [loading, setLoading] = useState(false);
  const [news, setNews] = useState([]);
  const [signal, setSignal] = useState(null);
  const [memory, setMemory] = useState(null);
  const { buyStock, sellStock, portfolio, removeFromWatchlist, tradingMode } =
    useTradingStore();
  const [quantity, setQuantity] = useState(1);

  const holding = portfolio.find((p) => p.symbol === stock.symbol);

  useEffect(() => {
    loadExistingSignal();
  }, [tradingMode]);

  const loadExistingSignal = async () => {
    try {
      const res = await fetch(
        `/api/memory?symbol=${stock.symbol}&mode=${tradingMode}`,
      );
      const data = await res.json();
      if (data?.lastAnalysis?.signal) {
        setSignal({
          signal: data.lastAnalysis.signal,
          confidence: data.lastAnalysis.confidence,
          reason: data.lastAnalysis.reason,
          stopLoss: data.lastAnalysis.stopLoss,
          target: data.lastAnalysis.target,
          riskLevel: data.lastAnalysis.riskLevel,
        });
        setMemory(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const analyzeStock = async () => {
    setLoading(true);
    try {
      const result = await runAnalysis(stock, tradingMode);
      setSignal(result);
      setNews(result.news || []);
      const memRes = await fetch(
        `/api/memory?symbol=${stock.symbol}&mode=${tradingMode}`,
      );
      setMemory(await memRes.json());
      toast.success("Analysis done!");
    } catch (err) {
      console.error(err);
      toast.error(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const signalConfig = {
    BUY: {
      border: "border-l-emerald-500",
      text: "text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    SELL: {
      border: "border-l-red-500",
      text: "text-red-400",
      bg: "bg-red-500/10",
    },
    HOLD: {
      border: "border-l-amber-500",
      text: "text-amber-400",
      bg: "bg-amber-500/10",
    },
  };

  return (
    <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl overflow-hidden">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 p-5">
        <Link
          href={`/stock/${stock.symbol}`}
          className="flex flex-col hover:opacity-80 transition-opacity sm:w-48 shrink-0"
        >
          <span className="text-base font-semibold text-white tracking-tight">
            {stock.symbol?.replace(".NS", "").replace(".BO", "")}
          </span>
          <span className="text-xs text-zinc-500 truncate max-w-[180px]">
            {stock.name}
          </span>
        </Link>

        <div className="flex items-baseline gap-2 sm:w-32 shrink-0">
          <span className="text-xl font-semibold text-white tabular-nums">
            ₹{stock.price?.toFixed(2)}
          </span>
          <span
            className={`text-xs font-medium tabular-nums ${stock.change >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            {stock.change >= 0 ? "+" : ""}
            {stock.change?.toFixed(2)}%
          </span>
        </div>

        {/* Ticker strip — quiet, monospace-ish via tabular-nums */}
        <div className="hidden lg:flex items-center gap-5 text-xs text-zinc-500 flex-1 tabular-nums">
          <span>
            O <span className="text-zinc-300">{stock.open?.toFixed(2)}</span>
          </span>
          <span>
            H <span className="text-zinc-300">{stock.high?.toFixed(2)}</span>
          </span>
          <span>
            L <span className="text-zinc-300">{stock.low?.toFixed(2)}</span>
          </span>
          <span>
            Vol{" "}
            <span className="text-zinc-300">
              {stock.volume?.toLocaleString("en-IN")}
            </span>
          </span>
          {holding && (
            <span className="text-zinc-400">
              · Holding{" "}
              <span className="text-white font-medium">{holding.quantity}</span>
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:ml-auto">
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
            className="w-14 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-white text-sm text-center tabular-nums focus:outline-none focus:border-zinc-500"
          />
          <button
            onClick={() => buyStock(stock, quantity, stock.price)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium px-3.5 py-1.5 rounded-lg transition-colors"
          >
            Buy
          </button>
          <button
            onClick={async () => {
              if (!holding) return toast.error("No holding to sell");
              const result = await sellStock(
                stock.symbol,
                quantity,
                stock.price,
              );
              if (result === "oversell")
                return toast.error(`You only have ${holding.quantity} qty!`);
              toast.success(
                `Sold ${quantity} × ${stock.symbol?.replace(".NS", "")}`,
              );
            }}
            disabled={!holding}
            className="bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-3.5 py-1.5 rounded-lg transition-colors"
          >
            Sell
          </button>
          <button
            onClick={() => removeFromWatchlist(stock.symbol)}
            className="text-zinc-500 hover:text-zinc-300 p-1.5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* AI Signal — colored left border, calmer */}
      {signal && (
        <div
          className={`border-t border-zinc-800 border-l-[3px] ${signalConfig[signal.signal]?.border} px-5 py-4 flex flex-col gap-2.5`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span
                className={`text-xs font-semibold ${signalConfig[signal.signal]?.text}`}
              >
                {signal.signal}
              </span>
              <span className="text-xs text-zinc-500">·</span>
              <span className="text-xs text-zinc-400">
                Confidence {signal.confidence}/10
              </span>
              {signal.riskLevel && (
                <>
                  <span className="text-xs text-zinc-500">·</span>
                  <span className="text-xs text-zinc-400">
                    {signal.riskLevel} risk
                  </span>
                </>
              )}
              {memory?.winRate != null && (
                <>
                  <span className="text-xs text-zinc-500">·</span>
                  <span
                    className={`text-xs font-medium ${memory.winRate >= 50 ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {memory.winRate}% win rate
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-3">
              {memory?.lastAnalysis?.date && (
                <span className="text-[11px] text-zinc-600">
                  {new Date(memory.lastAnalysis.date).toLocaleString("en-IN", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
              <button
                onClick={analyzeStock}
                disabled={loading}
                title="Refresh analysis"
                className="text-zinc-500 hover:text-white transition-colors disabled:opacity-50"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                />
              </button>
            </div>
          </div>

          <p className="text-[13px] text-zinc-400 leading-relaxed">
            {signal.reason}
          </p>

          <div className="flex gap-5 text-xs tabular-nums">
            <span className="text-zinc-500">
              Stop Loss{" "}
              <span className="text-red-400 font-medium">
                ₹{signal.stopLoss}
              </span>
            </span>
            <span className="text-zinc-500">
              Target{" "}
              <span className="text-emerald-400 font-medium">
                ₹{signal.target}
              </span>
            </span>
          </div>

          {news.length > 0 && (
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="news" className="border-zinc-800">
                <AccordionTrigger className="group px-1 py-2 hover:no-underline">
                  <div className="flex items-center gap-2 text-sm">
                    <Newspaper className="h-4 w-4 text-blue-400" />
                    <span className="font-medium text-zinc-300">
                      Latest News
                    </span>
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                      {news.length}
                    </span>
                  </div>
                </AccordionTrigger>

                <AccordionContent>
                  <ScrollArea className="h-(--radix-accordion-content-height)">
                    <div className="space-y-2 pt-2">
                      {news.map((n, i) => (
                        <Link
                          key={i}
                          href={n.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group block rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 transition-all duration-200 hover:border-zinc-700 hover:bg-zinc-800/50 hover:shadow-lg hover:shadow-black/20 no-underline!"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <h4 className="text-sm font-medium text-zinc-200 line-clamp-2 group-hover:text-white">
                              {n.title}
                            </h4>

                            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400" />
                          </div>

                          <div className="mt-2 flex items-center gap-2 text-[11px]">
                            <span className="rounded-md bg-zinc-800 px-2 py-1 text-zinc-400">
                              {n.source}
                            </span>

                            <span className="text-zinc-600">
                              {new Date(n.pubDate).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                              })}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}
        </div>
      )}

      {/* No signal yet — show analyze CTA, separate from buy/sell */}
      {!signal && (
        <div className="border-t border-zinc-800 px-5 py-3 flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            No AI analysis yet for {tradingMode} mode
          </span>
          <button
            onClick={analyzeStock}
            disabled={loading}
            className="text-xs font-medium text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors"
          >
            {loading ? "Analyzing..." : "Run AI Analysis →"}
          </button>
        </div>
      )}
    </div>
  );
}
