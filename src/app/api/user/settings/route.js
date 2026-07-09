import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { connectDB } from "@/lib/mongoose";
import User from "@/models/User";

export async function POST(request) {
  const user = await getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const body = await request.json();

  const updated = await User.findOneAndUpdate(
    { email: user.email },
    {
      $set: {
        autoTrade: body.autoTrade ?? user.autoTrade,
        minConfidence: body.minConfidence ?? user.minConfidence,
        maxPerTrade: body.maxPerTrade ?? user.maxPerTrade,
        tradingMode: body.tradingMode ?? user.tradingMode,
        balance: body.balance ?? user.balance,
        dailyAiBudgetUSD: body.dailyAiBudgetUSD ?? user.dailyAiBudgetUSD,
      },
    },
    { new: true },
  );

  return NextResponse.json(updated);
}
