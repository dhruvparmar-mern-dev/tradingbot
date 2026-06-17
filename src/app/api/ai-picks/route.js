import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Stock from "@/models/Stock";

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") || "swing";
  const field = `memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`;

  const stocks = await Stock.find({
    [`${field}.lastAnalysis.signal`]: "BUY",
  });

  const picks = stocks
    .map((s) => ({
      symbol: s.symbol,
      name: s.name,
      signal: s[field]?.lastAnalysis?.signal,
      confidence: s[field]?.lastAnalysis?.confidence,
      reason: s[field]?.lastAnalysis?.reason,
      stopLoss: s[field]?.lastAnalysis?.stopLoss,
      target: s[field]?.lastAnalysis?.target,
      price: s[field]?.lastAnalysis?.price,
      date: s[field]?.lastAnalysis?.date,
      winRate: s[field]?.winRate,
    }))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  return NextResponse.json(picks);
}
