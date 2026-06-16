"use client";
import { useState, useEffect, Suspense } from "react";
import useTradingStore from "@/store/tradingStore";
import StockCard from "./StockCard";
import TradeLog from "./TradeLog";
import { toast } from "sonner";
import useAutoTrader from "@/hooks/useAutoTrader";
import AutoTradeSettings from "./AutoTradeSettings";
import KiteConnect from "./KiteConnect";
import useKiteWebSocket from "@/hooks/useKiteWebSocket";
import MarketOverview from "./MarketOverview";

export default function Dashboard() {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [activeTab, setActiveTab] = useState("watchlist");
  const [loadingPrices, setLoadingPrices] = useState(false);

  const {
    balance,
    portfolio,
    watchlist,
    tradeLog,
    addToWatchlist,
    tradingMode,
    setTradingMode,
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

  const refreshPrices = async (stocks, type = "watchlist") => {
    if (!stocks || stocks.length === 0) return [];

    // Check Kite first
    const kiteRes = await fetch("/api/kite/status");
    const { connected: kiteConnected } = await kiteRes.json();

    const updated = await Promise.all(
      stocks.map(async (s) => {
        try {
          const endpoint = kiteConnected
            ? `/api/kite/quote?symbol=${s.symbol}`
            : `/api/stock?symbol=${s.symbol}`;
          const res = await fetch(endpoint);
          const data = await res.json();
          return { ...s, ...data };
        } catch {
          return s;
        }
      }),
    );
    if (type === "watchlist") useTradingStore.setState({ watchlist: updated });
    if (type === "portfolio") useTradingStore.setState({ portfolio: updated });
    return updated;
  };

  useEffect(() => {
    const initDashboard = async () => {
      setLoadingPrices(true);
      try {
        await useTradingStore.getState().init();
        const { watchlist, portfolio } = useTradingStore.getState();
        await Promise.all([
          refreshPrices(watchlist, "watchlist"),
          refreshPrices(portfolio, "portfolio"),
        ]);
      } catch (err) {
        toast.error("Failed to load data");
      } finally {
        setLoadingPrices(false);
      }
    };
    initDashboard();
  }, []);

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

  useAutoTrader();
  useKiteWebSocket();

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      {/* Navbar */}
      <div className="border-b border-zinc-800 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xl">📈</span>
          <h1 className="text-lg font-bold">TradingBot</h1>
          <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">
            Paper Trading
          </span>
          <Suspense fallback={null}>
            <KiteConnect />
          </Suspense>
          <div className="flex gap-1 bg-zinc-800 rounded-lg p-1">
            {["swing", "intraday"].map((mode) => (
              <button
                key={mode}
                onClick={() => setTradingMode(mode)}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                  tradingMode === mode
                    ? mode === "intraday"
                      ? "bg-orange-500 text-white"
                      : "bg-blue-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {mode === "intraday" ? "⚡ Intraday" : "📅 Swing"}
              </button>
            ))}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">Balance</div>
          <div className="text-lg font-bold">
            ₹{balance.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>

      <MarketOverview />

      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-6">
        {/* Stats */}
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
              label: "Total P&L",
              value: `${totalPnL >= 0 ? "+" : ""}₹${totalPnL.toFixed(2)}`,
              color: totalPnL >= 0 ? "text-emerald-400" : "text-red-400",
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

        {/* Search */}
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

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 w-fit">
          {[
            { key: "watchlist", label: `Watchlist (${watchlist.length})` },
            { key: "portfolio", label: `Portfolio (${portfolio.length})` },
            { key: "trades", label: `Trades (${tradeLog.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Loading */}
        {loadingPrices && (
          <div className="text-center text-zinc-500 text-sm animate-pulse py-4">
            Fetching latest prices...
          </div>
        )}

        {/* Tab Content */}
        {!loadingPrices &&
          activeTab === "watchlist" &&
          (watchlist.length === 0 ? (
            <div className="text-center text-zinc-500 py-16 text-sm">
              Search and add stocks to your watchlist
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
      </div>
      <AutoTradeSettings />
    </div>
  );
}
