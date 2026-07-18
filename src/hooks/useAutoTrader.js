import { useEffect, useRef } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import { runAnalysis } from "@/lib/runAnalysis";
import { attemptAutoBuy } from "@/lib/attemptAutoBuy";

export default function useAutoTrader() {
  const intervalRef = useRef(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    const checkAndTrade = async () => {
      // Market hours check — IST is UTC+5:30
      const now = new Date();
      const istOffset = 5.5 * 60 * 60 * 1000;
      const ist = new Date(now.getTime() + istOffset);
      const hours = ist.getUTCHours();
      const minutes = ist.getUTCMinutes();
      const timeInMinutes = hours * 60 + minutes;

      const marketOpen = 9 * 60 + 15; // 9:15 AM
      const marketClose = 15 * 60 + 15; // 3:15 PM
      const isMarketOpen =
        timeInMinutes >= marketOpen && timeInMinutes <= marketClose;

      // Skip auto buy/sell outside market hours
      if (!isMarketOpen) {
        console.log("Market closed, skipping auto trade");
        return;
      }

      if (isRunningRef.current) return;
      isRunningRef.current = true;

      try {
        const { watchlist, autoTrade, sellStock, tradingMode } =
          useTradingStore.getState();

        if (!watchlist.length) return;

        // Check Kite status first
        const kiteRes = await fetch("/api/kite/status");
        const { connected: kiteConnected } = await kiteRes.json();

        let validPrices = [];

        if (kiteConnected) {
          // WebSocket already updating store — just read current prices
          validPrices = useTradingStore
            .getState()
            .watchlist.filter((s) => s.price)
            .map((s) => ({
              symbol: s.symbol,
              price: s.price,
              high: s.high,
              low: s.low,
            }));
        } else {
          // Poll Yahoo Finance every 30 sec
          const results = await Promise.all(
            watchlist.map(async (s) => {
              try {
                const res = await fetch(`/api/stock?symbol=${s.symbol}`);
                const data = await res.json();
                if (data.error) throw new Error(data.error);
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
          validPrices = results.filter(Boolean);

          // Update store with fresh Yahoo prices
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
        }

        // Check stop loss / target for holdings
        const currentPortfolio = useTradingStore.getState().portfolio;
        for (const holding of currentPortfolio) {
          const priceData = validPrices.find(
            (p) => p.symbol === holding.symbol,
          );
          if (!priceData) continue;

          const holdingMode = holding.mode || tradingMode; // use the mode this position was bought under

          // Re-check holding still exists RIGHT NOW (not stale snapshot) --
          // mode-scoped since the same symbol can have separate swing and
          // intraday holdings.
          const stillHolding = useTradingStore
            .getState()
            .portfolio.find(
              (p) => p.symbol === holding.symbol && p.mode === holdingMode,
            );
          if (!stillHolding) continue; // already sold earlier in this same loop, skip

          try {
            // const memRes = await fetch(
            //   `/api/memory?symbol=${holding.symbol}&mode=${holdingMode}`,
            // );
            // const memory = await memRes.json();
            const memory = await useTradingStore
              .getState()
              .getMemory(holding.symbol, holdingMode);

            if (!memory?.lastAnalysis) continue;

            const { stopLoss, target } = memory.lastAnalysis;
            const currentPrice = priceData.price;
            // const targetBuffer = target * 0.998; // 0.2% buffer
            if (target && currentPrice >= target) {
              await sellStock(
                holding.symbol,
                holding.quantity,
                currentPrice,
                holdingMode,
              );
              await fetch("/api/outcome", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: holding.symbol,
                  outcome: "WIN",
                  price: currentPrice,
                  mode: holdingMode,
                }),
              });
              toast.success(
                `🎯 Target hit! Sold ${holding.symbol?.replace(".NS", "")} at ₹${currentPrice}`,
              );

              // NEW: Trigger fresh analysis immediately so bot can catch next opportunity
              runAnalysis(
                { ...holding, price: currentPrice },
                holdingMode,
                true,
              ).catch((err) =>
                console.error("Post-sell re-analysis failed:", err),
              );
            } else if (stopLoss && currentPrice <= stopLoss) {
              await sellStock(
                holding.symbol,
                holding.quantity,
                currentPrice,
                holdingMode,
              );
              await fetch("/api/outcome", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: holding.symbol,
                  outcome: "LOSS",
                  price: currentPrice,
                  mode: holdingMode,
                }),
              });
              toast.error(
                `🛑 Stop loss hit! Sold ${holding.symbol?.replace(".NS", "")} at ₹${currentPrice}`,
              );
              // NEW: Trigger fresh analysis immediately
              runAnalysis(
                { ...holding, price: currentPrice },
                holdingMode,
                true,
              ).catch((err) =>
                console.error("Post-sell re-analysis failed:", err),
              );
            }
          } catch (err) {
            console.error("Stop loss check error:", err);
          }
        }

        // Auto buy if enabled — this is the fallback path. It re-checks every
        // signal on a timer so it still catches: (a) signals generated while
        // the market was closed (they're already stale by the time the
        // market opens, so the reanalysis branch inside attemptAutoBuy
        // re-verifies before acting), and (b) anything the immediate
        // post-analysis trigger (see StockCard.jsx) missed or lost the claim
        // race on.
        if (autoTrade) {
          for (const stock of watchlist) {
            const priceData = validPrices.find((p) => p.symbol === stock.symbol);
            if (!priceData) continue;
            try {
              await attemptAutoBuy(stock, { livePrice: priceData.price });
            } catch (err) {
              console.error("Auto buy error:", err);
            }
          }
          if (tradingMode === "intraday") {
            const isForceExitTime = timeInMinutes >= marketClose;

            if (isForceExitTime) {
              const currentPortfolio = useTradingStore.getState().portfolio;
              // Only intraday holdings must close by 3:15 PM -- without this
              // filter, a swing holding would get force-sold too just
              // because the global tradingMode toggle happened to be
              // "intraday" at the time.
              for (const holding of currentPortfolio.filter(
                (h) => (h.mode || tradingMode) === "intraday",
              )) {
                const priceData = validPrices.find(
                  (p) => p.symbol === holding.symbol,
                );
                if (!priceData) continue;

                const holdingMode = holding.mode || tradingMode;

                await sellStock(
                  holding.symbol,
                  holding.quantity,
                  priceData.price,
                  holdingMode,
                );

                const pnl =
                  (priceData.price - holding.avgPrice) * holding.quantity;
                const outcome = pnl >= 0 ? "WIN" : "LOSS";

                await fetch("/api/outcome", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    symbol: holding.symbol,
                    outcome: "FORCED_EXIT", // WIN/LOSS nahi, alag category
                    price: priceData.price,
                    mode: holdingMode,
                    pnl: parseFloat(pnl.toFixed(2)), // actual P&L bhi store karo for reference
                  }),
                });

                toast.warning(
                  `⏰ 3:15 PM — Force closed ${holding.symbol?.replace(".NS", "")} at ₹${priceData.price} (${outcome})`,
                );
              }
            }
          }
        }
      } finally {
        isRunningRef.current = false;
      }
    };

    checkAndTrade();
    intervalRef.current = setInterval(checkAndTrade, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
