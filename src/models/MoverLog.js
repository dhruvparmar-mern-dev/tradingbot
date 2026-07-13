import mongoose from "mongoose";

// One row per (symbol, date) — a stock that shows up in multiple scan ticks
// on the same day just bumps timesSeenToday/lastSeenAt instead of creating
// duplicate rows. Aggregating distinct dates per symbol across this
// collection is what "all-time top movers" (repeat offenders) is built on.
const MoverLogSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  name: String,
  date: { type: String, required: true }, // YYYY-MM-DD, IST trading day
  bestChangePercent: Number,
  bestScore: Number,
  timesSeenToday: { type: Number, default: 1 },
  firstSeenAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
});

MoverLogSchema.index({ symbol: 1, date: 1 }, { unique: true });

export default mongoose.models.MoverLog ||
  mongoose.model("MoverLog", MoverLogSchema);
