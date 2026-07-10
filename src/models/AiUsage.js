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
  // Full audit trail — exactly what was sent to the AI and what it said back,
  // so a decision can be re-examined later without depending on re-fetching
  // data from Kite (which can revise same-day candles after the fact).
  prompt: String, // the complete prompt text sent to the model
  rawResponseText: String, // the model's raw text, before JSON.parse
  parsedResponse: mongoose.Schema.Types.Mixed, // parsed JSON, if parsing succeeded
});

export default mongoose.models.AiUsage || mongoose.model("AiUsage", AiUsageSchema);
