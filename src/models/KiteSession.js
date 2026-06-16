import mongoose from "mongoose";

const KiteSessionSchema = new mongoose.Schema({
  userId: { type: String, default: "default" },
  accessToken: String,
  publicToken: String,
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.models.KiteSession ||
  mongoose.model("KiteSession", KiteSessionSchema);
