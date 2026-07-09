import { useEffect, useRef } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import { runAnalysis as reanalyzeStock, runAnalysis } from "@/lib/runAnalysis";

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
        const {
          watchlist,
          autoTrade,
          minConfidence,
          maxPerTrade,
          buyStock,
          sellStock,
          tradingMode,
        } = useTradingStore.getState();

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

          // Re-check holding still exists RIGHT NOW (not stale snapshot)
          const stillHolding = useTradingStore
            .getState()
            .portfolio.find((p) => p.symbol === holding.symbol);
          if (!stillHolding) continue; // already sold earlier in this same loop, skip

          const holdingMode = holding.mode || tradingMode; // use the mode this position was bought under

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
              await sellStock(holding.symbol, holding.quantity, currentPrice);
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
              await sellStock(holding.symbol, holding.quantity, currentPrice);
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

        // Auto buy if enabled
        if (autoTrade) {
          for (const stock of watchlist) {
            const alreadyHolding = useTradingStore
              .getState()
              .portfolio.find((p) => p.symbol === stock.symbol);
            if (alreadyHolding) continue;

            try {
              const priceData = validPrices.find(
                (p) => p.symbol === stock.symbol,
              ); // ← move here, uncommented
              if (!priceData) continue;

              // const memRes = await fetch(
              //   `/api/memory?symbol=${stock.symbol}&mode=${tradingMode}`,
              // );
              // const memory = await memRes.json();

              const memory = await useTradingStore
                .getState()
                .getMemory(stock.symbol, tradingMode);
              if (!memory?.lastAnalysis) continue;

              const { signal, confidence } = memory.lastAnalysis;
              if (signal !== "BUY" || confidence < minConfidence) continue;
              if (memory.lastAnalysis.acted) continue;

              const signalAge =
                (Date.now() - new Date(memory.lastAnalysis.date).getTime()) /
                (1000 * 60);
              const maxAgeMinutes = tradingMode === "intraday" ? 15 : 240;
              const priceMoveSinceSignal = priceData
                ? Math.abs(
                    (priceData.price - memory.lastAnalysis.price) /
                      memory.lastAnalysis.price,
                  ) * 100
                : 0;

              const needsReanalysis =
                signalAge > maxAgeMinutes || priceMoveSinceSignal > 1.5;

              if (needsReanalysis) {
                const msg = `Re-analyzing ${stock.symbol} — stale (${signalAge.toFixed(0)}min) or moved (${priceMoveSinceSignal.toFixed(2)}%)`;
                console.log(msg);
                toast.info(msg);

                try {
                  const freshSignal = await reanalyzeStock(
                    stock,
                    tradingMode,
                    true,
                  );
                  if (
                    !freshSignal ||
                    freshSignal.signal !== "BUY" ||
                    freshSignal.confidence < minConfidence
                  ) {
                    continue; // AI changed its mind or confidence dropped, skip this cycle
                  }
                  // Use the fresh signal's data going forward for this buy decision
                  memory.lastAnalysis = freshSignal.lastAnalysis; // updated reference
                } catch (err) {
                  console.error("Re-analysis failed:", err);
                  toast.error("Re-analysis failed");
                  continue; // fail safe — don't buy on uncertain data
                }
              }

              // const priceData = validPrices.find(
              //   (p) => p.symbol === stock.symbol,
              // );
              // if (!priceData) continue;

              const quantity = Math.floor(maxPerTrade / priceData.price);
              if (quantity < 1) continue;

              const { balance } = useTradingStore.getState();
              if (balance < priceData.price) continue;

              await buyStock(
                { ...stock, price: priceData.price },
                quantity,
                priceData.price,
              );

              // Mark signal as acted so it doesn't buy again
              await fetch("/api/memory", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  symbol: stock.symbol,
                  memory: {
                    ...memory,
                    lastAnalysis: {
                      ...memory.lastAnalysis,
                      acted: true,
                      actedAt: new Date(),
                    },
                  },
                  mode: useTradingStore.getState().tradingMode,
                }),
              });

              toast.success(
                `🤖 Auto bought ${quantity} × ${stock.symbol?.replace(".NS", "")} at ₹${priceData.price}`,
              );
            } catch (err) {
              console.error("Auto buy error:", err);
            }
          }
          if (tradingMode === "intraday") {
            const isForceExitTime = timeInMinutes >= marketClose;

            if (isForceExitTime) {
              const currentPortfolio = useTradingStore.getState().portfolio;
              for (const holding of currentPortfolio) {
                const priceData = validPrices.find(
                  (p) => p.symbol === holding.symbol,
                );
                if (!priceData) continue;

                const holdingMode = holding.mode || tradingMode;

                await sellStock(
                  holding.symbol,
                  holding.quantity,
                  priceData.price,
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
