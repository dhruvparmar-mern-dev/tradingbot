import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";

const useTradingStore = create(
  persist(
    (set, get) => ({
      balance: 100000,
      portfolio: [],
      tradeLog: [],
      watchlist: [],
      initialized: false,
      autoTrade: false,
      minConfidence: 7,
      maxPerTrade: 10000,

      // Load everything from DB on app start
      init: async () => {
        if (get().initialized) return;
        try {
          const [watchRes, portRes, tradeRes] = await Promise.all([
            fetch("/api/watchlist"),
            fetch("/api/portfolio"),
            fetch("/api/trades"),
          ]);
          const [watchlist, portfolio, tradeLog] = await Promise.all([
            watchRes.json(),
            portRes.json(),
            tradeRes.json(),
          ]);
          set({ watchlist, portfolio, tradeLog, initialized: true });
        } catch (err) {
          console.error("Init error:", err);
        }
      },

      buyStock: async (stock, quantity, price) => {
        const cost = quantity * price;
        const { balance } = get();
        if (cost > balance) return toast.error("Insufficient balance!");
        // if (!balance || cost > balance) return toast.error("insufficient");
        // Update DB
        await fetch("/api/portfolio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: stock.symbol,
            name: stock.name,
            quantity,
            price,
          }),
        });
        await fetch("/api/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: stock.symbol,
            type: "BUY",
            quantity,
            price,
            total: cost,
          }),
        });

        // Update local state
        const { portfolio, tradeLog } = get();
        const existing = portfolio.find((p) => p.symbol === stock.symbol);
        const newPortfolio = existing
          ? portfolio.map((p) =>
              p.symbol === stock.symbol
                ? {
                    ...p,
                    quantity: p.quantity + quantity,
                    avgPrice:
                      (p.avgPrice * p.quantity + cost) /
                      (p.quantity + quantity),
                  }
                : p,
            )
          : [...portfolio, { ...stock, quantity, avgPrice: price }];

        set({
          balance: balance - cost,
          portfolio: newPortfolio,
          tradeLog: [
            {
              id: Date.now(),
              symbol: stock.symbol,
              type: "BUY",
              quantity,
              price,
              total: cost,
              time: new Date().toLocaleString(),
            },
            ...tradeLog,
          ],
        });
      },

      sellStock: async (symbol, quantity, price) => {
        const { balance, portfolio, tradeLog } = get();
        const holding = portfolio.find((p) => p.symbol === symbol);
        if (!holding) return;

        const pnl = (price - holding.avgPrice) * quantity;

        // Update DB
        await fetch(`/api/portfolio?symbol=${symbol}&quantity=${quantity}`, {
          method: "DELETE",
        });
        await fetch("/api/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol,
            type: "SELL",
            quantity,
            price,
            total: quantity * price,
            pnl,
          }),
        });

        const newPortfolio =
          holding.quantity === quantity
            ? portfolio.filter((p) => p.symbol !== symbol)
            : portfolio.map((p) =>
                p.symbol === symbol
                  ? { ...p, quantity: p.quantity - quantity }
                  : p,
              );

        set({
          balance: balance + quantity * price,
          portfolio: newPortfolio,
          tradeLog: [
            {
              id: Date.now(),
              symbol,
              type: "SELL",
              quantity,
              price,
              total: quantity * price,
              pnl,
              time: new Date().toLocaleString(),
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

      setAutoTrade: (val) => set({ autoTrade: val }),
      setMinConfidence: (val) => set({ minConfidence: val }),
      setMaxPerTrade: (val) => set({ maxPerTrade: val }),
    }),
    {
      name: "trading-settings", // localStorage key
      partialState: (state) => ({
        // Only persist settings, NOT portfolio/watchlist (those come from MongoDB)
        autoTrade: state.autoTrade,
        minConfidence: state.minConfidence,
        maxPerTrade: state.maxPerTrade,
        balance: state.balance,
      }),
    },
  ),
);

export default useTradingStore;
