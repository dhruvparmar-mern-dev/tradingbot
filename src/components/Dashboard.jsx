"use client";
import { useState } from "react";
import useTradingStore from "@/store/tradingStore";
import StockCard from "./StockCard";
import TradeLog from "./TradeLog";
import { toast } from "sonner";
import MarketOverview from "./MarketOverview";
import AIPicks from "./AIPicks";
import MarketScan from "./MarketScan";
import ReportModal from "./ReportModal";
import AiUsageTab from "./AiUsageTab";
import WatchlistInsights from "./WatchlistInsights";
import { attemptAutoBuy } from "@/lib/attemptAutoBuy";

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState("watchlist");
  const [bulkScanning, setBulkScanning] = useState(false);

  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [showReport, setShowReport] = useState(false);

  const {
    portfolio,
    watchlist,
    tradeLog,
    addToWatchlist,
    loadingPrices,
    tradingMode,
  } = useTradingStore();

  const totalInvested = portfolio.reduce(
    (sum, p) => sum + (p.avgPrice || 0) * (p.quantity || 0),
    0,
  );
  const totalValue = portfolio.reduce(
    (sum, p) => sum + (p.price || p.avgPrice || 0) * (p.quantity || 0),
    0,
  );
  const totalPnL = totalValue - totalInvested;

  const realizedPnL = tradeLog
    .filter((t) => t.type === "SELL" && t.pnl)
    .reduce((sum, t) => sum + t.pnl, 0);

  const searchStock = async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/stock?symbol=${search.toUpperCase()}`);
      const data = await res.json();
      if (data.error) return toast.error("Stock not found!");
      await addToWatchlist(data);
      toast.success(`${data.symbol} added to watchlist!`);
      setSearch("");
    } catch (err) {
      toast.error("Error fetching stock");
    } finally {
      setSearching(false);
    }
  };

  const fetchReport = async () => {
    setReportLoading(true);
    try {
      const res = await fetch(`/api/report?mode=${tradingMode}`);
      const data = await res.json();
      setReport(data);
      setShowReport(true);
    } catch (err) {
      console.error(err);

      toast.error("Report fetch failed");
    } finally {
      setReportLoading(false);
    }
  };

  const scanAllWatchlist = async () => {
    setBulkScanning(true);
    try {
      const symbols = watchlist.map((s) => s.symbol);
      toast.info(`Analyzing ${symbols.length} stocks...`);

      const res = await fetch("/api/bulk-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols, mode: tradingMode }),
      });
      const { results } = await res.json();

      const buySignals = results.filter((r) => r.signal === "BUY");
      toast.success(`Scan complete! ${buySignals.length} BUY signals found.`);

      // Memory cache clear karo, taaki StockCard fresh data dikhaye
      useTradingStore.setState({ memoryCache: {} });

      // Auto-trade is on -> act on fresh BUY signals right away instead of
      // waiting up to 30s for the next useAutoTrader poll tick. Sequential,
      // not parallel — keeps balance/quantity checks (which read live store
      // state) from racing each other across different symbols in the same
      // scan. The atomic claim inside attemptAutoBuy still protects against
      // this racing with the 30s poll for the *same* symbol.
      for (const r of buySignals) {
        try {
          await attemptAutoBuy({
            symbol: r.symbol,
            price: r.lastAnalysis?.price,
          });
        } catch (err) {
          console.error(
            `Immediate auto-buy attempt failed for ${r.symbol}:`,
            err,
          );
        }
      }
    } catch (err) {
      console.error(err);

      toast.error("Bulk scan failed");
    } finally {
      setBulkScanning(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-6">
        <MarketOverview />
        <AIPicks />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Portfolio Value",
              value: `₹${totalValue.toFixed(2)}`,
              color: "text-white",
            },
            {
              label: "Total Invested",
              value: `₹${totalInvested.toFixed(2)}`,
              color: "text-white",
            },
            {
              label: "Unrealized P&L",
              value: `${totalPnL >= 0 ? "+" : ""}₹${totalPnL.toFixed(2)}`,
              color: totalPnL >= 0 ? "text-emerald-400" : "text-red-400",
            },
            {
              label: "Realized P&L",
              value: `${realizedPnL >= 0 ? "+" : ""}₹${realizedPnL.toFixed(2)}`,
              color: realizedPnL >= 0 ? "text-emerald-400" : "text-red-400",
            },
            { label: "Holdings", value: portfolio.length, color: "text-white" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
            >
              <div className="text-xs text-zinc-500 mb-1">{label}</div>
              <div className={`text-xl font-bold ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search stock symbol (e.g. RELIANCE, TCS, INFY)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchStock()}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 text-sm"
          />
          <button
            onClick={searchStock}
            disabled={searching}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-6 py-3 rounded-xl text-sm font-medium transition-colors"
          >
            {searching ? "Searching..." : "Add"}
          </button>
        </div>

        <div className="flex items-center gap-2 py-2">
          <button
            onClick={scanAllWatchlist}
            disabled={bulkScanning}
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-3 rounded-xl transition-colors"
          >
            {bulkScanning ? "Scanning..." : "🔄 Scan All Watchlist"}
          </button>
          <button
            onClick={fetchReport}
            disabled={reportLoading}
            className="text-xs text-zinc-400 hover:text-white border border-zinc-700 font-medium px-4 py-3 rounded-lg transition-colors"
          >
            {reportLoading ? "Loading..." : "📊 Portfolio Report"}
          </button>
        </div>

        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit max-w-full overflow-x-auto scrollbar-ghost">
          {[
            { key: "watchlist", label: `Watchlist (${watchlist.length})` },
            { key: "portfolio", label: `Portfolio (${portfolio.length})` },
            { key: "trades", label: `Trades (${tradeLog.length})` },
            { key: "movers", label: "Today's Top Movers" },
            { key: "insights", label: "Watchlist Insights" },
            { key: "aiUsage", label: "AI Usage" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === tab.key
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loadingPrices && (
          <div className="text-center text-zinc-500 text-sm animate-pulse py-4">
            Fetching latest prices...
          </div>
        )}

        {!loadingPrices &&
          activeTab === "watchlist" &&
          (watchlist.length === 0 ? (
            <div className="text-center text-zinc-500 py-16 text-sm">
              Search and add stocks to your watchlist
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {watchlist.map((stock) => (
                <StockCard key={stock.symbol} stock={stock} />
              ))}
            </div>
          ))}

        {!loadingPrices &&
          activeTab === "portfolio" &&
          (portfolio.length === 0 ? (
            <div className="text-center text-zinc-500 py-16 text-sm">
              No holdings yet. Buy some stocks!
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {portfolio.map((stock) => (
                <StockCard key={stock.symbol} stock={stock} />
              ))}
            </div>
          ))}

        {!loadingPrices &&
          activeTab === "trades" &&
          (tradeLog.length === 0 ? (
            <div className="text-center text-zinc-500 py-16 text-sm">
              No trades yet
            </div>
          ) : (
            <TradeLog />
          ))}

        {!loadingPrices && activeTab === "aiUsage" && <AiUsageTab />}

        {!loadingPrices && activeTab === "movers" && <MarketScan />}

        {!loadingPrices && activeTab === "insights" && <WatchlistInsights />}

        {showReport && (
          <ReportModal report={report} onClose={() => setShowReport(false)} />
        )}
      </div>
    </div>
  );
}
