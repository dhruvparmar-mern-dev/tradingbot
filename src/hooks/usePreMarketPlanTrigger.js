import { useEffect, useRef } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";
import { isMarketOpenNow } from "@/lib/marketHours";
import { runAnalysis } from "@/lib/runAnalysis";
import { attemptAutoBuy } from "@/lib/attemptAutoBuy";

const CHECK_INTERVAL_MS = 20 * 1000; // fast -- the whole point is to act near the open
// A gap outside this band contradicts the plan: too negative means the
// overnight/opening reaction was bearish (plan's bullish-continuation read
// no longer holds); too positive means it already ran further than the
// plan anticipated and is closer to "already extended" than "confirming".
const MIN_GAP_PCT = -0.3;
const MAX_GAP_PCT = 2.5;

// Confirms or invalidates today's pre-market plans against the live
// opening print, using prices already flowing into the store via
// useKiteWebSocket/AppShell -- no extra API calls just to check the gap.
// On confirmation, hands off to the normal real-AI + auto-buy path
// (runAnalysis + attemptAutoBuy) instead of duplicating that logic here.
export default function usePreMarketPlanTrigger() {
  const plansRef = useRef([]);
  const checkedRef = useRef(new Set());

  useEffect(() => {
    let cancelled = false;

    const loadPlans = async () => {
      try {
        const res = await fetch("/api/premarket-plan");
        const data = await res.json();
        if (!cancelled) {
          plansRef.current = (data.plans || []).filter((p) => p.status === "pending");
        }
      } catch (err) {
        console.error("Failed to load pre-market plans:", err);
      }
    };

    const markPlan = async (plan, status, invalidatedReason) => {
      checkedRef.current.add(plan.symbol);
      try {
        await fetch("/api/premarket-plan", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol: plan.symbol, forDate: plan.forDate, status, invalidatedReason }),
        });
      } catch (err) {
        console.error("Failed to update pre-market plan status:", err);
      }
    };

    const checkPlans = async () => {
      if (!isMarketOpenNow() || !plansRef.current.length) return;

      // The whole point is spending real AI budget automatically the moment
      // the open confirms a plan -- only do that if auto-trading is
      // actually on. With it off, attemptAutoBuy would no-op anyway but
      // runAnalysis would still burn a real call for nothing.
      const { watchlist, tradingMode, autoTrade } = useTradingStore.getState();
      if (!autoTrade) return;
      for (const plan of plansRef.current) {
        if (checkedRef.current.has(plan.symbol)) continue;
        const stock = watchlist.find((s) => s.symbol === plan.symbol);
        if (!stock?.price) continue;

        const gapPct = ((stock.price - plan.prevClose) / plan.prevClose) * 100;

        if (gapPct < MIN_GAP_PCT) {
          await markPlan(plan, "invalidated", `Opened/trading ${gapPct.toFixed(2)}% vs plan baseline -- gapped against the bullish-continuation read`);
          continue;
        }
        if (gapPct > MAX_GAP_PCT) {
          await markPlan(plan, "invalidated", `Gapped up ${gapPct.toFixed(2)}% -- already past what the plan anticipated, risk of chasing an extended move`);
          continue;
        }

        // Within band -- confirmed. Hand off to the real analysis + auto-buy
        // path immediately rather than waiting for the normal mandatory-
        // volume-confirmation flow to build up today's own candles from
        // scratch.
        await markPlan(plan, "confirmed");
        toast.info(`Pre-market plan confirmed for ${plan.symbol.replace(".NS", "")} (gap ${gapPct.toFixed(2)}%) — running analysis now`);
        try {
          const result = await runAnalysis(stock, tradingMode, true);
          if (result.signal === "BUY") {
            await attemptAutoBuy({ symbol: stock.symbol, price: result.lastAnalysis?.price ?? stock.price });
          }
        } catch (err) {
          console.error(`Pre-market fast-track analysis failed for ${plan.symbol}:`, err);
        }
      }
    };

    loadPlans();
    const pollId = setInterval(checkPlans, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollId);
    };
  }, []);
}
