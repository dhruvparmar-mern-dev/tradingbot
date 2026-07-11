import useTradingStore from "@/store/tradingStore";
import { runAnalysis } from "@/lib/runAnalysis";
import { toast } from "sonner";

const MARKET_OPEN_MIN = 9 * 60 + 15; // 9:15 AM IST
const MARKET_CLOSE_MIN = 15 * 60 + 15; // 3:15 PM IST

export function isMarketOpenNow() {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + istOffset);
  const timeInMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return timeInMinutes >= MARKET_OPEN_MIN && timeInMinutes <= MARKET_CLOSE_MIN;
}

// Single source of truth for "should we auto-buy this stock right now, and if
// so, do it". Called from two places: the 30s poll in useAutoTrader (the
// fallback that also catches signals generated while the market was closed,
// via the staleness/re-analysis check below) and immediately after a fresh
// analysis returns a BUY (so a signal generated while the market is open
// gets acted on right away instead of waiting up to 30s for the next poll
// tick). Both callers can end up here for the same signal at nearly the same
// time — the atomic claim step right before buyStock ensures only one of
// them actually executes the trade.
export async function attemptAutoBuy(stock, { livePrice } = {}) {
  const {
    autoTrade,
    minConfidence,
    maxPerTrade,
    balance,
    portfolio,
    tradingMode,
    buyStock,
    getMemory,
  } = useTradingStore.getState();

  if (!autoTrade) return { bought: false, reason: "autoTrade off" };
  if (!isMarketOpenNow()) return { bought: false, reason: "market closed" };
  if (portfolio.find((p) => p.symbol === stock.symbol))
    return { bought: false, reason: "already holding" };

  const price = livePrice ?? stock.price;
  if (!price) return { bought: false, reason: "no live price" };

  let memory = await getMemory(stock.symbol, tradingMode);
  if (!memory?.lastAnalysis) return { bought: false, reason: "no signal" };
  if (memory.lastAnalysis.signal !== "BUY" || memory.lastAnalysis.confidence < minConfidence)
    return { bought: false, reason: "not a qualifying BUY" };
  if (memory.lastAnalysis.acted) return { bought: false, reason: "already acted" };

  const signalAge = (Date.now() - new Date(memory.lastAnalysis.date).getTime()) / (1000 * 60);
  const maxAgeMinutes = tradingMode === "intraday" ? 15 : 240;
  const priceMoveSinceSignal = Math.abs((price - memory.lastAnalysis.price) / memory.lastAnalysis.price) * 100;
  const needsReanalysis = signalAge > maxAgeMinutes || priceMoveSinceSignal > 1.5;

  if (needsReanalysis) {
    const msg = `Re-analyzing ${stock.symbol} — stale (${signalAge.toFixed(0)}min) or moved (${priceMoveSinceSignal.toFixed(2)}%)`;
    toast.info(msg);
    try {
      const freshSignal = await runAnalysis(stock, tradingMode, true);
      if (!freshSignal || freshSignal.signal !== "BUY" || freshSignal.confidence < minConfidence) {
        return { bought: false, reason: "AI changed its mind on re-check" };
      }
      memory = { ...memory, lastAnalysis: freshSignal.lastAnalysis };
    } catch (err) {
      toast.error("Re-analysis failed");
      return { bought: false, reason: "re-analysis failed" };
    }
  }

  const MAX_RISK_FRACTION_OF_TRADE = 0.2;
  const budgetBasedQty = Math.floor(maxPerTrade / price);
  const stopLoss = memory.lastAnalysis.stopLoss;
  const stopLossDistance = stopLoss ? Math.abs(price - stopLoss) : null;
  const riskBasedQty = stopLossDistance
    ? Math.floor((maxPerTrade * MAX_RISK_FRACTION_OF_TRADE) / stopLossDistance)
    : budgetBasedQty;
  const quantity = Math.min(budgetBasedQty, riskBasedQty);

  if (quantity < 1) return { bought: false, reason: "quantity rounds to zero" };
  if (balance < price) return { bought: false, reason: "insufficient balance" };

  // Last gate before spending money — atomic claim, see api/memory/claim.
  const claimRes = await fetch("/api/memory/claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: stock.symbol, mode: tradingMode }),
  });
  const { claimed } = await claimRes.json();
  if (!claimed) return { bought: false, reason: "another trigger already claimed this signal" };

  await buyStock({ ...stock, price }, quantity, price);
  toast.success(`🤖 Auto bought ${quantity} × ${stock.symbol?.replace(".NS", "")} at ₹${price}`);
  return { bought: true, quantity, price };
}
