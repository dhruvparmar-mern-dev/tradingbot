import mongoose from "mongoose";

const AiUsageSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  mode: { type: String, default: "swing" }, // swing | intraday
  signal: String, // BUY | SELL | HOLD — null if the call errored
  model: { type: String, required: true },
  inputTokens: Number,
  outputTokens: Number,
  costUSD: Number,
  time: { type: Date, default: Date.now },
});

export default mongoose.models.AiUsage || mongoose.model("AiUsage", AiUsageSchema);
