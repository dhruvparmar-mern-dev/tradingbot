import { useEffect, useRef } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";

export default function useAutoTrader() {
  const intervalRef = useRef(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    const checkAndTrade = async () => {
      // Prevent overlapping calls
      if (isRunningRef.current) return;
      isRunningRef.current = true;

      try {
        const {
          watchlist,
          portfolio,
          autoTrade,
          minConfidence,
          maxPerTrade,
          buyStock,
          sellStock,
        } = useTradingStore.getState();

        if (!watchlist.length) return;

        // 1. Refresh all prices
        const updatedPrices = await Promise.all(
          watchlist.map(async (s) => {
            try {
              const res = await fetch(`/api/stock?symbol=${s.symbol}`);
              const data = await res.json();
              return {
                symbol: s.symbol,
                price: data.price,
                high: data.high,
                low: data.low,
              };
            } catch {
              return null;
            }
          }),
        );

        const validPrices = updatedPrices.filter(Boolean);

        // Update prices in store
        if (validPrices.length > 0) {
          useTradingStore.setState((state) => ({
            watchlist: state.watchlist.map((s) => {
              const updated = validPrices.find((p) => p.symbol === s.symbol);
              return updated ? { ...s, ...updated } : s;
            }),
            portfolio: state.portfolio.map((s) => {
              const updated = validPrices.find((p) => p.symbol === s.symbol);
              return updated ? { ...s, price: updated.price } : s;
            }),
          }));
        }

        // 2. Check stop loss / target for holdings
        const currentPortfolio = useTradingStore.getState().portfolio;
        for (const holding of currentPortfolio) {
          const priceData = validPrices.find(
            (p) => p.symbol === holding.symbol,
          );
          if (!priceData) continue;

          try {
            const memRes = await fetch(`/api/memory?symbol=${holding.symbol}`);
            const memory = await memRes.json();
            if (!memory?.lastAnalysis) continue;

            const { stopLoss, target } = memory.lastAnalysis;
            const currentPrice = priceData.price;

            if (target && currentPrice >= target) {
              await sellStock(holding.symbol, holding.quantity, currentPrice);
              await fetch("/api/outcome", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: holding.symbol,
                  outcome: "WIN",
                  price: currentPrice,
                }),
              });
              toast.success(
                `🎯 Target hit! Sold ${holding.symbol?.replace(".NS", "")} at ₹${currentPrice}`,
              );
            } else if (stopLoss && currentPrice <= stopLoss) {
              await sellStock(holding.symbol, holding.quantity, currentPrice);
              await fetch("/api/outcome", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: holding.symbol,
                  outcome: "LOSS",
                  price: currentPrice,
                }),
              });
              toast.error(
                `🛑 Stop loss hit! Sold ${holding.symbol?.replace(".NS", "")} at ₹${currentPrice}`,
              );
            }
          } catch (err) {
            console.error("Stop loss check error:", err);
          }
        }

        // 3. Auto buy if enabled
        if (autoTrade) {
          for (const stock of watchlist) {
            const alreadyHolding = useTradingStore
              .getState()
              .portfolio.find((p) => p.symbol === stock.symbol);
            if (alreadyHolding) continue;

            try {
              const memRes = await fetch(`/api/memory?symbol=${stock.symbol}`);
              const memory = await memRes.json();
              if (!memory?.lastAnalysis) continue;

              const { signal, confidence } = memory.lastAnalysis;
              if (signal !== "BUY" || confidence < minConfidence) continue;

              const priceData = validPrices.find(
                (p) => p.symbol === stock.symbol,
              );
              if (!priceData) continue;

              const quantity = Math.floor(maxPerTrade / priceData.price);
              if (quantity < 1) continue;

              const { balance } = useTradingStore.getState();
              if (balance < priceData.price) continue;

              await buyStock(
                { ...stock, price: priceData.price },
                quantity,
                priceData.price,
              );
              toast.success(
                `🤖 Auto bought ${quantity} × ${stock.symbol?.replace(".NS", "")} at ₹${priceData.price}`,
              );
            } catch (err) {
              console.error("Auto buy error:", err);
            }
          }
        }
      } finally {
        isRunningRef.current = false;
      }
    };

    // Run immediately once
    checkAndTrade();

    // Then every 30 seconds
    intervalRef.current = setInterval(checkAndTrade, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []); // empty deps — reads store directly via getState()
}
