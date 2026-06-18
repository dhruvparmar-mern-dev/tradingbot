import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Stock from "@/models/Stock";

export async function POST(request) {
  await connectDB();
  const { symbol, outcome, price, mode } = await request.json();
  const field = `memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`;

  const stock = await Stock.findOne({ symbol });
  const memory = stock?.[field];

  if (!memory?.signalHistory?.length) {
    return NextResponse.json({ error: "No signal history" }, { status: 404 });
  }

  const history = memory.signalHistory;
  const lastPendingIndex = [...history]
    .reverse()
    .findIndex((s) => s.outcome === "PENDING");

  if (lastPendingIndex === -1) {
    return NextResponse.json({ error: "No pending signal" }, { status: 404 });
  }

  const actualIndex = history.length - 1 - lastPendingIndex;
  history[actualIndex].outcome = outcome;
  history[actualIndex].exitPrice = price;
  history[actualIndex].exitDate = new Date();

  const actionableSignals = history.filter(
    (s) => s.signal === "BUY" || s.signal === "SELL",
  );
  const completed = actionableSignals.filter((s) => s.outcome !== "PENDING");
  const wins = completed.filter((s) => s.outcome === "WIN").length;
  const winRate =
    completed.length > 0 ? ((wins / completed.length) * 100).toFixed(0) : null;

  await Stock.findOneAndUpdate(
    { symbol },
    {
      $set: {
        [`${field}.signalHistory`]: history,
        [`${field}.winRate`]: winRate,
        [`${field}.totalSignals`]: actionableSignals.length,
        [`${field}.completedSignals`]: completed.length,
      },
    },
  );

  return NextResponse.json({ success: true, winRate });
}
