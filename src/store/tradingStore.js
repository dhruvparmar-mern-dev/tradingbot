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
  memoryCache: {},

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
    const { tradingMode } = get();
    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "BUY",
        symbol: stock.symbol,
        name: stock.name,
        quantity,
        price,
        mode: tradingMode,
      }),
    });
    const data = await res.json();
    if (!res.ok) return data.error;

    const { portfolio, tradeLog } = get();
    const existing = portfolio.find((p) => p.symbol === stock.symbol);
    const newPortfolio = existing
      ? portfolio.map((p) =>
          p.symbol === stock.symbol ? { ...p, ...data.updatedHolding } : p,
        )
      : [...portfolio, { ...stock, ...data.updatedHolding }];

    set({
      balance: data.balance,
      portfolio: newPortfolio,
      tradeLog: [{ ...data.trade, time: data.trade.time }, ...tradeLog],
    });
  },

  sellStock: async (symbol, quantity, price) => {
    const { portfolio, tradeLog } = get();
    const holding = portfolio.find((p) => p.symbol === symbol);
    if (!holding) return "no_holding";
    const mode = holding?.mode || get().tradingMode;

    const res = await fetch("/api/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "SELL", symbol, quantity, price, mode }),
    });
    const data = await res.json();
    if (!res.ok) return data.error;

    // Sync portfolio from backend response, not local math
    const newPortfolio = data.fullySold
      ? portfolio.filter((p) => p.symbol !== symbol)
      : portfolio.map((p) =>
          p.symbol === symbol
            ? { ...p, quantity: data.updatedHolding.quantity }
            : p,
        );

    set({
      balance: data.balance,
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

  getMemory: async (symbol, mode) => {
    const key = `${symbol}_${mode}`;
    const cached = get().memoryCache[key];
    if (cached && Date.now() - cached.fetchedAt < 30000) {
      return cached.data;
    }
    const res = await fetch(`/api/memory?symbol=${symbol}&mode=${mode}`);
    const data = await res.json();
    set((state) => ({
      memoryCache: {
        ...state.memoryCache,
        [key]: { data, fetchedAt: Date.now() },
      },
    }));
    return data;
  },

  invalidateMemory: (symbol, mode) => {
    const key = `${symbol}_${mode}`;
    set((state) => {
      const newCache = { ...state.memoryCache };
      delete newCache[key];
      return { memoryCache: newCache };
    });
  },
}));

export default useTradingStore;
