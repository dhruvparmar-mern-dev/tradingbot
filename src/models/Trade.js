import mongoose from "mongoose";

const TradeSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  type: { type: String, enum: ["BUY", "SELL"], required: true },
  quantity: Number,
  price: Number,
  total: Number,
  pnl: Number,
  mode: { type: String, default: "swing" },
  time: { type: Date, default: Date.now },
});

export default mongoose.models.Trade || mongoose.model("Trade", TradeSchema);
