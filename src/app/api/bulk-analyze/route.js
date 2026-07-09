import { NextResponse } from "next/server";
import { runAnalysisServerSide } from "@/lib/runAnalysisServer";
import { connectDB } from "@/lib/mongoose";
import Stock from "@/models/Stock";

export async function POST(request) {
  const { symbols, mode } = await request.json();

  if (!symbols || !Array.isArray(symbols) || symbols.length === 0) {
    return NextResponse.json({ error: "No symbols provided" }, { status: 400 });
  }

  await connectDB();
  const cookieHeader = request.headers.get("cookie") || "";

  const results = [];
  for (const symbol of symbols) {
    try {
      // Stock ka latest price chahiye analysis ke liye
      const stockRes = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL}/api/kite/quote?symbol=${symbol}`,
      );
      const stockData = await stockRes.json();

      if (stockData.error) {
        results.push({ symbol, error: "Could not fetch price" });
        continue;
      }

      const analysis = await runAnalysisServerSide(
        { symbol, name: stockData.name || symbol, price: stockData.price },
        mode,
        true, // hamesha fresh chart bulk-scan mein
        cookieHeader,
      );

      results.push({ symbol, ...analysis });
    } catch (err) {
      console.error(`Bulk analyze failed for ${symbol}:`, err.message);
      results.push({ symbol, error: err.message });
    }
  }

  return NextResponse.json({ results, total: symbols.length, mode });
}
