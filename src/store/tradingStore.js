import { create } from "zustand";
import { toast } from "sonner";

const useTradingStore = create((set, get) => ({
  balance: 100000,
  portfolio: [],
  tradeLog: [],
  watchlist: [],
  initialized: false,
  autoTrade: false,
  minConfidence: 7,
  maxPerTrade: 10000,
  tradingMode: "swing",

  init: async () => {
    if (get().initialized) return;
    try {
      const [userRes, watchRes, portRes, tradeRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/watchlist"),
        fetch("/api/portfolio"),
        fetch("/api/trades"),
      ]);
      const [user, watchlist, portfolio, tradeLog] = await Promise.all([
        userRes.json(),
        watchRes.json(),
        portRes.json(),
        tradeRes.json(),
      ]);

      set({
        watchlist: Array.isArray(watchlist) ? watchlist : [],
        portfolio: Array.isArray(portfolio) ? portfolio : [],
        tradeLog: Array.isArray(tradeLog) ? tradeLog : [],
        balance: user.balance, // ← directly from DB now, single source of truth
        autoTrade: user.autoTrade ?? false,
        minConfidence: user.minConfidence ?? 7,
        maxPerTrade: user.maxPerTrade ?? 10000,
        tradingMode: user.tradingMode ?? "swing",
        initialized: true,
      });
    } catch (err) {
      console.error("Init error:", err);
    }
  },

  // Save settings to MongoDB
  setAutoTrade: async (val) => {
    set({ autoTrade: val });
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoTrade: val }),
    });
  },

  setMinConfidence: async (val) => {
    set({ minConfidence: val });
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minConfidence: val }),
    });
  },

  setMaxPerTrade: async (val) => {
    set({ maxPerTrade: val });
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPerTrade: val }),
    });
  },

  setTradingMode: async (val) => {
    set({ tradingMode: val });
    await fetch("/api/user/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tradingMode: val }),
    });
  },

  buyStock: async (stock, quantity, price) => {
    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "BUY",
        symbol: stock.symbol,
        name: stock.name,
        quantity,
        price,
      }),
    });
    const data = await res.json();
    if (!res.ok) return data.error; // 'insufficient' etc

    const { portfolio, tradeLog } = get();
    const existing = portfolio.find((p) => p.symbol === stock.symbol);
    const cost = quantity * price;
    const newPortfolio = existing
      ? portfolio.map((p) =>
          p.symbol === stock.symbol
            ? {
                ...p,
                quantity: p.quantity + quantity,
                avgPrice:
                  (p.avgPrice * p.quantity + cost) / (p.quantity + quantity),
              }
            : p,
        )
      : [...portfolio, { ...stock, quantity, avgPrice: price }];

    set({
      balance: data.balance, // ← directly from backend, no manual calc
      portfolio: newPortfolio,
      tradeLog: [{ ...data.trade, time: data.trade.time }, ...tradeLog],
    });
  },

  sellStock: async (symbol, quantity, price) => {
    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "SELL", symbol, quantity, price }),
    });
    const data = await res.json();
    if (!res.ok) return data.error; // 'oversell', 'no_holding'

    const { portfolio, tradeLog } = get();
    const holding = portfolio.find((p) => p.symbol === symbol);
    const newPortfolio =
      holding.quantity === quantity
        ? portfolio.filter((p) => p.symbol !== symbol)
        : portfolio.map((p) =>
            p.symbol === symbol ? { ...p, quantity: p.quantity - quantity } : p,
          );

    set({
      balance: data.balance, // ← directly from backend
      portfolio: newPortfolio,
      tradeLog: [{ ...data.trade, time: data.trade.time }, ...tradeLog],
    });
  },

  addToWatchlist: async (stock) => {
    const { watchlist } = get();
    if (watchlist.find((s) => s.symbol === stock.symbol)) return;
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: stock.symbol,
        name: stock.name,
        exchange: stock.exchange,
      }),
    });
    set({ watchlist: [...watchlist, stock] });
  },

  removeFromWatchlist: async (symbol) => {
    await fetch(`/api/watchlist?symbol=${symbol}`, { method: "DELETE" });
    set((state) => ({
      watchlist: state.watchlist.filter((s) => s.symbol !== symbol),
    }));
  },
}));

export default useTradingStore;
