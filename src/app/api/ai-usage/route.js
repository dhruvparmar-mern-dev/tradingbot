import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import AiUsage from "@/models/AiUsage";
import Trade from "@/models/Trade";
import { getUser } from "@/lib/auth";

async function sumCost(match) {
  const [agg] = await AiUsage.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: "$costUSD" }, calls: { $sum: 1 } } },
  ]);
  return { total: agg?.total || 0, calls: agg?.calls || 0 };
}

export async function GET() {
  await connectDB();
  const user = await getUser();
  const dailyBudget = user?.dailyAiBudgetUSD ?? 1.0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [today, month, allTime, bySignal, [pnlAgg]] = await Promise.all([
    sumCost({ time: { $gte: startOfDay } }),
    sumCost({ time: { $gte: startOfMonth } }),
    sumCost({}),
    AiUsage.aggregate([
      {
        $group: {
          _id: "$signal",
          total: { $sum: "$costUSD" },
          calls: { $sum: 1 },
        },
      },
    ]),
    Trade.aggregate([
      { $match: { type: "SELL" } },
      { $group: { _id: null, totalPnL: { $sum: "$pnl" } } },
    ]),
  ]);

  return NextResponse.json({
    dailyBudget,
    today,
    month,
    allTime,
    bySignal: bySignal.map((s) => ({
      signal: s._id || "ERROR",
      total: s.total,
      calls: s.calls,
    })),
    // In INR, separate from AI cost (USD) — deliberately not converted/combined
    // since there's no live exchange rate in this app.
    totalRealizedPnL: pnlAgg?.totalPnL || 0,
  });
}
