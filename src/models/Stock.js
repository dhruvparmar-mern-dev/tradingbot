import mongoose from "mongoose";

const StockSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  name: String,
  exchange: String,
  addedAt: { type: Date, default: Date.now },
  // Leaving the watchlist archives the document instead of deleting it, so
  // memory/signalHistory survives if the stock is ever re-added later.
  inWatchlist: { type: Boolean, default: true },
  memorySwing: {
    character: String,
    keyLevels: {
      support: Number,
      resistance: Number,
    },
    behavior: String,
    lastAnalysis: {
      signal: String,
      confidence: Number,
      rsi: Number,
      trend: String,
      reason: String,
      stopLoss: Number,
      target: Number,
      riskLevel: String,
      price: Number,
      date: Date,
      acted: Boolean,
      actedAt: Date,
    },
    signalHistory: [
      {
        signal: String,
        confidence: Number,
        price: Number,
        date: Date,
        outcome: String, // WIN/LOSS/FORCED_EXIT (real trade) / VERIFIED (checked against real candles, never traded) / PENDING
        // Real % price move from entry to the resolution point, filled in by
        // resolveSignalOutcomes.js once the signal is old enough to check --
        // only ever set from actual Kite candle data, never the AI's own claim.
        realOutcomePct: Number,
        exitPrice: Number,
        exitDate: Date,
        // Real ₹ P&L for a closed real trade (WIN/LOSS/FORCED_EXIT) --
        // /api/outcome used to silently drop this even when the caller
        // passed it, so FORCED_EXIT entries never recorded whether the
        // time-based exit was actually a profit or a loss.
        pnl: Number,
        winRate: Number,
        totalSignals: Number,
        completedSignals: Number,
      },
    ],
  },
  memoryIntraday: {
    character: String,
    keyLevels: {
      support: Number,
      resistance: Number,
    },
    behavior: String,
    lastAnalysis: {
      signal: String,
      confidence: Number,
      rsi: Number,
      trend: String,
      reason: String,
      stopLoss: Number,
      target: Number,
      riskLevel: String,
      price: Number,
      date: Date,
      acted: Boolean,
      actedAt: Date,
    },
    signalHistory: [
      {
        signal: String,
        confidence: Number,
        price: Number,
        date: Date,
        outcome: String, // WIN/LOSS/FORCED_EXIT (real trade) / VERIFIED (checked against real candles, never traded) / PENDING
        realOutcomePct: Number,
        exitPrice: Number,
        exitDate: Date,
        // Real ₹ P&L for a closed real trade (WIN/LOSS/FORCED_EXIT) --
        // /api/outcome used to silently drop this even when the caller
        // passed it, so FORCED_EXIT entries never recorded whether the
        // time-based exit was actually a profit or a loss.
        pnl: Number,
        winRate: Number,
        totalSignals: Number,
        completedSignals: Number,
      },
    ],
  },
});

export default mongoose.models.Stock || mongoose.model("Stock", StockSchema);
