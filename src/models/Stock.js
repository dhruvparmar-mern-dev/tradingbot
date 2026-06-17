import mongoose from "mongoose";

const StockSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  name: String,
  exchange: String,
  addedAt: { type: Date, default: Date.now },
  memorySwing: {
    character: String,
    keyLevels: {
      support: Number,
      resistance: Number,
    },
    behavior: String,
    lastAnalysis: {
      signal: String,
      confidence: Number,
      rsi: Number,
      trend: String,
      reason: String,
      stopLoss: Number,
      target: Number,
      riskLevel: String,
      price: Number,
      date: Date,
      acted: Boolean,
      actedAt: Date,
    },
    signalHistory: [
      {
        signal: String,
        confidence: Number,
        price: Number,
        date: Date,
        outcome: String, // WIN/LOSS/PENDING - track later
        winRate: Number,
        totalSignals: Number,
        completedSignals: Number,
      },
    ],
  },
  memoryIntraday: {
    character: String,
    keyLevels: {
      support: Number,
      resistance: Number,
    },
    behavior: String,
    lastAnalysis: {
      signal: String,
      confidence: Number,
      rsi: Number,
      trend: String,
      reason: String,
      stopLoss: Number,
      target: Number,
      riskLevel: String,
      price: Number,
      date: Date,
      acted: Boolean,
      actedAt: Date,
    },
    signalHistory: [
      {
        signal: String,
        confidence: Number,
        price: Number,
        date: Date,
        outcome: String, // WIN/LOSS/PENDING - track later
        winRate: Number,
        totalSignals: Number,
        completedSignals: Number,
      },
    ],
  },
});

export default mongoose.models.Stock || mongoose.model("Stock", StockSchema);
