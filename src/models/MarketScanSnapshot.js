import mongoose from "mongoose";

// Single-document cache of the most recent market-scan shortlist (full
// mover objects, indicators + actionable flag included) — lets the frontend
// hydrate immediately on mount/tab-revisit instead of showing blank until
// the next auto-scan tick fires.
const MarketScanSnapshotSchema = new mongoose.Schema({
  key: { type: String, default: "latest", unique: true },
  movers: mongoose.Schema.Types.Mixed,
  scannedCount: Number,
  candidateCount: Number,
  mode: String,
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.models.MarketScanSnapshot ||
  mongoose.model("MarketScanSnapshot", MarketScanSnapshotSchema);
