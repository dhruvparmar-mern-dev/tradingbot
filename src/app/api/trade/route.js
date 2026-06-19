import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import { getUser } from "@/lib/auth";
import User from "@/models/User";
import Portfolio from "@/models/Portfolio";
import Trade from "@/models/Trade";

export async function POST(request) {
  const user = await getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await connectDB();
  const { type, symbol, name, quantity, price, mode } = await request.json();
  const total = quantity * price;

  if (type === "BUY") {
    const updatedUser = await User.findOneAndUpdate(
      { email: user.email, balance: { $gte: total } },
      { $inc: { balance: -total } },
      { new: true },
    );
    if (!updatedUser) {
      return NextResponse.json({ error: "insufficient" }, { status: 400 });
    }

    const existing = await Portfolio.findOne({ symbol });
    let updatedHolding;

    if (existing) {
      const newQty = existing.quantity + quantity;
      const newAvg = (existing.avgPrice * existing.quantity + total) / newQty;
      updatedHolding = await Portfolio.findOneAndUpdate(
        { symbol },
        { quantity: newQty, avgPrice: newAvg, updatedAt: new Date() },
        { new: true },
      );
    } else {
      updatedHolding = await Portfolio.create({
        symbol,
        name,
        quantity,
        avgPrice: price,
        mode: mode || "swing",
      });
    }

    const trade = await Trade.create({
      symbol,
      type: "BUY",
      quantity,
      price,
      total,
      mode: mode || "swing",
    });
    return NextResponse.json({
      success: true,
      balance: updatedUser.balance,
      trade,
      updatedHolding,
    });
  }

  if (type === "SELL") {
    const holding = await Portfolio.findOne({ symbol });
    if (!holding)
      return NextResponse.json({ error: "no_holding" }, { status: 400 });
    if (quantity > holding.quantity)
      return NextResponse.json({ error: "oversell" }, { status: 400 });

    const pnl = (price - holding.avgPrice) * quantity;
    let updatedHolding = null;

    if (holding.quantity === quantity) {
      await Portfolio.deleteOne({ symbol });
    } else {
      updatedHolding = await Portfolio.findOneAndUpdate(
        { symbol },
        { quantity: holding.quantity - quantity },
        { new: true },
      );
    }

    const trade = await Trade.create({
      symbol,
      type: "SELL",
      quantity,
      price,
      total,
      pnl,
      mode: mode || holding.mode || "swing",
    });

    const updatedUser = await User.findOneAndUpdate(
      { email: user.email },
      { $inc: { balance: total } },
      { new: true },
    );

    return NextResponse.json({
      success: true,
      balance: updatedUser.balance,
      trade,
      updatedHolding, // null if fully sold, else the remaining holding object
      fullySold: !updatedHolding,
    });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}
