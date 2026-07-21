import mongoose from "mongoose";

// A plan computed from yesterday's (or the most recent session's) real
// chart data, ahead of the next market open -- so the fast gap-check at
// 9:15 only needs to compare the actual open against a level already
// decided the night before, instead of waiting ~20-40 min for enough of
// today's own candles to build mandatory volume/trend confirmation from
// scratch. One row per (symbol, forDate).
const PreMarketPlanSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  name: String,
  forDate: { type: String, required: true }, // YYYY-MM-DD, IST — the trading day this plan targets
  direction: { type: String, enum: ["BULLISH_CONTINUATION"], required: true }, // long-only app -- no bearish/short plans
  prevClose: { type: Number, required: true }, // yesterday's close -- the gap baseline
  keyLevel: Number, // resistance/support level the plan is anchored to
  reasoning: String,
  indicatorsSnapshot: mongoose.Schema.Types.Mixed, // yesterday's RSI/MACD/trend/volume, for later review
  status: {
    type: String,
    enum: ["pending", "confirmed", "invalidated", "expired"],
    default: "pending",
  },
  confirmedAt: Date,
  invalidatedReason: String,
  generatedAt: { type: Date, default: Date.now },
});

PreMarketPlanSchema.index({ symbol: 1, forDate: 1 }, { unique: true });

export default mongoose.models.PreMarketPlan ||
  mongoose.model("PreMarketPlan", PreMarketPlanSchema);
