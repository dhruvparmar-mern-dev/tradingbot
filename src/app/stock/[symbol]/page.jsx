"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import CandlestickChart from "@/components/CandlestickChart";

export default function StockDetail() {
  const { symbol } = useParams();
  const router = useRouter();
  const [stock, setStock] = useState(null);
  const [chart, setChart] = useState(null);
  const [news, setNews] = useState([]);
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const { buyStock, sellStock, portfolio, balance, tradingMode } =
    useTradingStore();
  const holding = portfolio.find(
    (p) => p.symbol === decodeURIComponent(symbol),
  );

  const [hydrated, setHydrated] = useState(false);
  const [range, setRange] = useState(tradingMode === "intraday" ? "3D" : "3M");

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) fetchAll();
  }, [symbol, tradingMode, hydrated]);

  useEffect(() => {
    if (hydrated) fetchChartOnly();
  }, [range]);

  useEffect(() => {
    setRange(tradingMode === "intraday" ? "3D" : "3M");
  }, [tradingMode]);

  // Refresh chart data periodically
  useEffect(() => {
    if (!hydrated) return;

    // Refresh chart every 5 mins for swing, every 1 min for intraday
    const interval = setInterval(
      () => {
        fetchChartOnly(); // separate function, don't refetch everything
      },
      tradingMode === "intraday" ? 60000 : 300000,
    );

    return () => clearInterval(interval);
  }, [tradingMode, hydrated]);

  // Add this separate function:
  const fetchChartOnly = async () => {
    try {
      const kiteRes = await fetch("/api/kite/status");
      const { connected: kiteConnected } = await kiteRes.json();

      const rangeParam = range ? `&range=${range}` : "";
      const chartEndpoint = kiteConnected
        ? `/api/kite/historical?symbol=${symbol}&mode=${tradingMode}${rangeParam}`
        : `/api/chart?symbol=${symbol}`;

      const res = await fetch(chartEndpoint);
      const chartData = await res.json();
      if (!chartData.error) setChart(chartData);
    } catch (err) {
      console.error("Chart refresh error:", err);
    }
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const kiteRes = await fetch("/api/kite/status");
      const { connected: kiteConnected } = await kiteRes.json();

      const stockEndpoint = kiteConnected
        ? `/api/kite/quote?symbol=${symbol}`
        : `/api/stock?symbol=${symbol}`;

      const [stockRes, newsRes] = await Promise.all([
        fetch(stockEndpoint),
        fetch(`/api/news?symbol=${symbol}`),
      ]);

      const [stockData, newsData] = await Promise.all([
        stockRes.json(),
        newsRes.json(),
      ]);

      setStock(stockData);
      setNews(newsData);

      // Fetch chart separately
      fetchChartOnly();
    } catch (err) {
      toast.error("Failed to load stock data");
    }
    setLoading(false);
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ai-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockData: stock,
          news,
          chartData: chart,
          tradingMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || "Analysis failed");
      setSignal(data);
      toast.success("Analysis complete!");
    } catch (err) {
      toast.error("Something went wrong");
    }
    setAnalyzing(false);
  };

  const signalStyles = {
    BUY: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    SELL: "bg-red-500/20 text-red-400 border border-red-500/30",
    HOLD: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30",
  };

  const riskStyles = {
    LOW: "bg-emerald-500/20 text-emerald-400",
    MEDIUM: "bg-yellow-500/20 text-yellow-400",
    HIGH: "bg-red-500/20 text-red-400",
  };

  const swingRanges = ["1M", "3M", "6M", "1Y"];
  const intradayRanges = ["1D", "3D", "5D"];
  const availableRanges =
    tradingMode === "intraday" ? intradayRanges : swingRanges;

  if (loading)
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-400 text-sm animate-pulse">
          Loading stock data...
        </div>
      </div>
    );

  if (!stock)
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-red-400 text-sm">Stock not found</div>
      </div>
    );

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Navbar */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="text-zinc-400 hover:text-white transition-colors text-sm flex items-center gap-1"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">
            {stock.symbol?.replace(".NS", "").replace(".BO", "")}
          </h1>
          <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full">
            {stock.exchange}
          </span>
        </div>
        <div className="ml-auto text-right">
          <div className="text-xl font-bold">₹{stock.price?.toFixed(2)}</div>
          <div
            className={`text-sm ${stock.change >= 0 ? "text-emerald-400" : "text-red-400"}`}
          >
            {stock.change >= 0 ? "▲" : "▼"} {Math.abs(stock.change).toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-6">
        {/* Stock name + quick stats */}
        <div>
          <p className="text-zinc-400 text-sm mb-4">{stock.name}</p>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              tradingMode === "intraday"
                ? "bg-orange-500/20 text-orange-400"
                : "bg-blue-500/20 text-blue-400"
            }`}
          >
            {tradingMode === "intraday" ? "⚡ Intraday" : "📅 Swing"}
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                value: holding
                  ? `${holding.quantity} qty @ ₹${holding.avgPrice?.toFixed(0)}`
                  : "None",
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3"
              >
                <div className="text-xs text-zinc-500 mb-1">{label}</div>
                <div className="text-white font-medium text-sm">{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Chart */}
        {chart?.candles && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-semibold text-white">
                {tradingMode === "intraday" ? "5 Min Chart" : "30 Day Chart"}
              </h2>
              <div className="flex gap-3 text-xs">
                <span className="text-red-400">
                  Support: ₹{chart.indicators?.support}
                </span>
                <span className="text-emerald-400">
                  Resistance: ₹{chart.indicators?.resistance}
                </span>
              </div>
            </div>
            <div className="flex gap-1 mb-3">
              {availableRanges.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    range === r
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:text-white"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <CandlestickChart
              candles={chart.candles}
              support={chart.indicators?.support}
              resistance={chart.indicators?.resistance}
              mode={tradingMode}
            />
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Technical Indicators */}
          {chart?.indicators && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
              <h2 className="font-semibold text-white">Technical Indicators</h2>
              <div className="flex flex-col gap-3">
                {/* RSI */}
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-zinc-400">RSI (14)</span>
                    <span
                      className={`font-medium ${
                        chart.indicators.rsi > 70
                          ? "text-red-400"
                          : chart.indicators.rsi < 30
                            ? "text-emerald-400"
                            : "text-zinc-300"
                      }`}
                    >
                      {chart.indicators.rsi}
                      {chart.indicators.rsi > 70
                        ? " · Overbought"
                        : chart.indicators.rsi < 30
                          ? " · Oversold"
                          : " · Neutral"}
                    </span>
                  </div>
                  <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        chart.indicators.rsi > 70
                          ? "bg-red-400"
                          : chart.indicators.rsi < 30
                            ? "bg-emerald-400"
                            : "bg-blue-400"
                      }`}
                      style={{ width: `${chart.indicators.rsi}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-zinc-600 mt-1">
                    <span>0 Oversold</span>
                    <span>30</span>
                    <span>70</span>
                    <span>100 Overbought</span>
                  </div>
                </div>

                {/* MACD */}
                <div className="bg-zinc-800 rounded-lg p-3 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-400 text-sm">MACD</span>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        chart.indicators.macd.crossover === "BULLISH"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {chart.indicators.macd.crossover}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-zinc-500">Value</div>
                      <div className="text-white font-medium">
                        {chart.indicators.macd.value}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Signal</div>
                      <div className="text-white font-medium">
                        {chart.indicators.macd.signal}
                      </div>
                    </div>
                    <div>
                      <div className="text-zinc-500">Histogram</div>
                      <div
                        className={`font-medium ${parseFloat(chart.indicators.macd.histogram) > 0 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {chart.indicators.macd.histogram}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Trend */}
                <div className="flex justify-between items-center bg-zinc-800 rounded-lg px-3 py-2">
                  <span className="text-zinc-400 text-sm">Trend (20 days)</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-bold ${chart.indicators.trend === "UPTREND" ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {chart.indicators.trend === "UPTREND" ? "▲" : "▼"}{" "}
                      {chart.indicators.trend}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {chart.indicators.trendStrength}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* AI Signal + Buy/Sell */}
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-4">
              <h2 className="font-semibold text-white">AI Analysis</h2>

              {signal ? (
                <div className="flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <span
                      className={`font-bold px-4 py-1.5 rounded-full text-sm ${signalStyles[signal.signal]}`}
                    >
                      {signal.signal}
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${riskStyles[signal.riskLevel]}`}
                      >
                        {signal.riskLevel} RISK
                      </span>
                      <span className="text-xs text-zinc-400">
                        Confidence: {signal.confidence}/10
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">
                    {signal.reason}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                      <div className="text-xs text-red-400 mb-0.5">
                        Stop Loss
                      </div>
                      <div className="text-white font-bold">
                        ₹{signal.stopLoss}
                      </div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <div className="text-xs text-emerald-400 mb-0.5">
                        Target
                      </div>
                      <div className="text-white font-bold">
                        ₹{signal.target}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <p className="text-zinc-500 text-sm mb-4">
                    Get AI analysis based on chart, indicators and news
                  </p>
                  <button
                    onClick={analyze}
                    disabled={analyzing}
                    className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                  >
                    {analyzing ? "Analyzing..." : "🤖 Analyze with AI"}
                  </button>
                </div>
              )}

              {signal && (
                <button
                  onClick={analyze}
                  disabled={analyzing}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors text-center"
                >
                  {analyzing ? "Analyzing..." : "↻ Re-analyze"}
                </button>
              )}
            </div>

            {/* Buy/Sell */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3">
              <h2 className="font-semibold text-white">Paper Trade</h2>
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Balance: ₹{balance.toLocaleString("en-IN")}</span>
                <span>
                  Cost: ₹
                  {(quantity * stock.price).toLocaleString("en-IN", {
                    maximumFractionDigits: 0,
                  })}
                </span>
              </div>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-zinc-500 w-full"
                placeholder="Quantity"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    buyStock(stock, quantity, stock.price);
                    toast.success(`Bought ${quantity} × ${stock.symbol}`);
                  }}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
                >
                  Buy ₹{(quantity * stock.price).toFixed(0)}
                </button>
                <button
                  onClick={() => {
                    if (!holding) return toast.error("No holding to sell");
                    sellStock(stock.symbol, quantity, stock.price);
                    toast.success(`Sold ${quantity} × ${stock.symbol}`);
                  }}
                  disabled={!holding}
                  className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
                >
                  Sell
                </button>
              </div>
              {holding && (
                <div
                  className={`text-xs text-center font-medium ${
                    stock.price - holding.avgPrice >= 0
                      ? "text-emerald-400"
                      : "text-red-400"
                  }`}
                >
                  P&L: {stock.price - holding.avgPrice >= 0 ? "+" : ""}₹
                  {(
                    (stock.price - holding.avgPrice) *
                    holding.quantity
                  ).toFixed(2)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* News */}
        {news.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col gap-3">
            <h2 className="font-semibold text-white">Recent News</h2>
            <div className="flex flex-col gap-2">
              {news.map((n, i) => (
                <a
                  key={i}
                  href={n.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-3 transition-colors"
                >
                  <div className="text-sm text-zinc-200 leading-relaxed">
                    {n.title}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {n.source} ·{" "}
                    {new Date(n.pubDate).toLocaleDateString("en-IN")}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
