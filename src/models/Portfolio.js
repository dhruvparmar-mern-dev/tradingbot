import mongoose from "mongoose";

const PortfolioSchema = new mongoose.Schema({
  symbol: { type: String, required: true },
  name: String,
  quantity: Number,
  avgPrice: Number,
  mode: { type: String, default: "swing" },
  updatedAt: { type: Date, default: Date.now },
});

// Compound unique index — symbol + mode dono milke unique honge
PortfolioSchema.index({ symbol: 1, mode: 1 }, { unique: true });
PortfolioSchema.path("symbol").index(false);

export default mongoose.models.Portfolio ||
  mongoose.model("Portfolio", PortfolioSchema);
