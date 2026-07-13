import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  balance: { type: Number, default: 100000 },
  autoTrade: { type: Boolean, default: false },
  minConfidence: { type: Number, default: 7 },
  maxPerTrade: { type: Number, default: 10000 },
  tradingMode: { type: String, default: "swing" },
  dailyAiBudgetUSD: { type: Number, default: 1.0 },
  costAwarenessEnabled: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.User || mongoose.model("User", UserSchema);
