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

      // Calculate balance from trades
      const startingBalance = 100000;
      const balance = tradeLog.reduce((bal, trade) => {
        if (trade.type === "BUY") return bal - (trade.total || 0);
        if (trade.type === "SELL") return bal + (trade.total || 0);
        return bal;
      }, startingBalance);

      set({
        watchlist: Array.isArray(watchlist) ? watchlist : [],
        portfolio: Array.isArray(portfolio) ? portfolio : [],
        tradeLog: Array.isArray(tradeLog) ? tradeLog : [],
        balance,
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
    const cost = quantity * price;
    const { balance } = get();
    if (cost > balance) return "insufficient";

    const newBalance = balance - cost;

    // Update DB
    await Promise.all([
      fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: stock.symbol,
          name: stock.name,
          quantity,
          price,
        }),
      }),
      fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: stock.symbol,
          type: "BUY",
          quantity,
          price,
          total: cost,
        }),
      }),
      // fetch("/api/user/settings", {
      //   method: "POST",
      //   headers: { "Content-Type": "application/json" },
      //   body: JSON.stringify({ balance: newBalance }),
      // }),
    ]);

    const { portfolio, tradeLog } = get();
    const existing = portfolio.find((p) => p.symbol === stock.symbol);
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
      balance: newBalance,
      portfolio: newPortfolio,
      tradeLog: [
        {
          id: Date.now(),
          symbol: stock.symbol,
          type: "BUY",
          quantity,
          price,
          total: cost,
          time: new Date().toISOString(),
        },
        ...tradeLog,
      ],
    });
  },

  sellStock: async (symbol, quantity, price) => {
    const { balance, portfolio, tradeLog } = get();
    const holding = portfolio.find((p) => p.symbol === symbol);
    if (!holding) return "no_holding";
    if (quantity > holding.quantity) return "oversell";

    const total = quantity * price;
    const pnl = (price - holding.avgPrice) * quantity;
    const newBalance = balance + total;

    const newPortfolio =
      holding.quantity === quantity
        ? portfolio.filter((p) => p.symbol !== symbol)
        : portfolio.map((p) =>
            p.symbol === symbol ? { ...p, quantity: p.quantity - quantity } : p,
          );

    await Promise.all([
      fetch(`/api/portfolio?symbol=${symbol}&quantity=${quantity}`, {
        method: "DELETE",
      }),
      fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          type: "SELL",
          quantity,
          price,
          total,
          pnl,
        }),
      }),
      fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: newBalance }),
      }),
    ]);

    set({
      balance: newBalance,
      portfolio: newPortfolio,
      tradeLog: [
        {
          id: Date.now(),
          symbol,
          type: "SELL",
          quantity,
          price,
          total,
          pnl,
          time: new Date().toISOString(),
        },
        ...tradeLog,
      ],
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
