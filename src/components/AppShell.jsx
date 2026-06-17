"use client";
import { useEffect, useState } from "react";
import useAutoTrader from "@/hooks/useAutoTrader";
import useKiteWebSocket from "@/hooks/useKiteWebSocket";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";

export default function AppShell({ children }) {
  useAutoTrader();
  useKiteWebSocket();

  const [loadingPrices, setLoadingPrices] = useState(true);

  const refreshPrices = async (stocks, type = "watchlist") => {
    if (!stocks || stocks.length === 0) return [];

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
    const initApp = async () => {
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
    initApp();
  }, []);

  // Expose loading state globally via store so Dashboard can read it
  useEffect(() => {
    useTradingStore.setState({ loadingPrices });
  }, [loadingPrices]);

  return <>{children}</>;
}
