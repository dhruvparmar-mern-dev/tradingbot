import mongoose from "mongoose";

const PortfolioSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  name: String,
  quantity: Number,
  avgPrice: Number,
  mode: { type: String, default: "swing" },
  updatedAt: { type: Date, default: Date.now },
});

export default mongoose.models.Portfolio ||
  mongoose.model("Portfolio", PortfolioSchema);
