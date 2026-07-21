import mongoose from "mongoose";

// Daily record of the deep market-scan's "worth trading" (actionable) picks
// -- one row per (symbol, date), same upsert-and-bump pattern as MoverLog.
// Unlike MoverLog (today's biggest % gainers only), this scan considers the
// whole liquid non-penny universe regardless of today's move, so a stock
// showing up here repeatedly is a distinct, complementary signal.
const DeepScanLogSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  name: String,
  date: { type: String, required: true }, // YYYY-MM-DD, IST trading day
  bestChangePercent: Number,
  reason: String,
  timesSeenToday: { type: Number, default: 1 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

DeepScanLogSchema.index({ symbol: 1, date: 1 }, { unique: true });

export default mongoose.models.DeepScanLog ||
  mongoose.model("DeepScanLog", DeepScanLogSchema);
