import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import Stock from "@/models/Stock";
import PreMarketPlan from "@/models/PreMarketPlan";
import { getNSEInstruments } from "@/lib/kiteInstruments";
import { computeIndicators } from "@/lib/indicators";

// Free, no-AI, deterministic pre-market plan generator. Run this near/after
// today's market close -- it looks at each active watchlist stock's chart
// as of today's close and decides, for stocks in a clean uptrend with
// bullish MACD, a "watch for continuation" plan for the next session:
// prevClose (today's close, the gap baseline) + a key resistance level.
// Tomorrow's fast gap-check (usePreMarketPlanTrigger, client-side) compares
// the actual open against this plan instead of waiting for today's own
// candles to build mandatory volume confirmation from scratch.
export async function POST() {
  await connectDB();
  const session = await KiteSession.findOne({ userId: "default" });
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Connect Kite first." }, { status: 401 });
  }
  kite.setAccessToken(session.accessToken);

  const stocks = await Stock.find({ inWatchlist: { $ne: false } }).lean();
  const instruments = (await getNSEInstruments()).filter((i) => i.instrument_type === "EQ");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const forDate = tomorrow.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 5);

  const results = [];
  for (const s of stocks) {
    const cleanSymbol = s.symbol.replace(".NS", "").replace(".BO", "");
    const inst = instruments.find((i) => i.tradingsymbol === cleanSymbol);
    if (!inst) continue;
    try {
      const candles = await kite.getHistoricalData(inst.instrument_token, "5minute", fromDate, new Date());
      if (candles.length < 30) continue;
      const closes = candles.map((c) => c.close).filter(Boolean).sort((a, b) => a - b);
      const median = closes[Math.floor(closes.length / 2)];
      const clean = candles.filter((c) => !(c.high > median * 3 || c.low < median / 3));
      const ind = computeIndicators({
        closes: clean.map((c) => c.close),
        highs: clean.map((c) => c.high),
        lows: clean.map((c) => c.low),
        volumes: clean.map((c) => c.volume),
      });

      const trendUp = ind.trend === "UPTREND";
      const macdBullish = ind.macd.crossover === "BULLISH";
      if (!trendUp || !macdBullish) {
        results.push({ symbol: s.symbol, planned: false, reason: "no clean uptrend+bullish-MACD setup as of today's close" });
        continue;
      }

      const prevClose = clean.at(-1).close;
      const keyLevel = parseFloat(ind.resistance);
      const reasoning = `As of today's close: uptrend (${ind.trendStrength} vs 20-EMA), bullish MACD (histogram ${ind.macd.histogram}), RSI ${ind.rsi}. Watching for a hold above resistance ~₹${keyLevel} on tomorrow's open.`;

      await PreMarketPlan.findOneAndUpdate(
        { symbol: s.symbol, forDate },
        {
          symbol: s.symbol, name: s.name, forDate,
          direction: "BULLISH_CONTINUATION",
          prevClose, keyLevel, reasoning,
          indicatorsSnapshot: ind,
          status: "pending",
          generatedAt: new Date(),
        },
        { upsert: true },
      );
      results.push({ symbol: s.symbol, planned: true, prevClose, keyLevel });
    } catch (err) {
      console.error(`Pre-market plan generation failed for ${s.symbol}:`, err.message);
    }
  }

  // Housekeeping — a pending plan whose forDate has passed (market never
  // opened that day, or the trigger never fired) is stale; don't let it
  // accumulate and get accidentally matched against a later day's gap.
  await PreMarketPlan.updateMany(
    { status: "pending", forDate: { $lt: forDate } },
    { $set: { status: "expired" } },
  );

  return NextResponse.json({ forDate, planned: results.filter((r) => r.planned).length, results });
}

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const forDate = searchParams.get("forDate") || today;
  const plans = await PreMarketPlan.find({ forDate }).lean();
  return NextResponse.json({ plans });
}

// Marks a plan confirmed (the client's gap-check passed and it triggered a
// real analysis) or invalidated (the open contradicted the plan), so the
// client-side trigger doesn't re-check or re-fire on the same plan all day.
export async function PATCH(request) {
  await connectDB();
  const { symbol, forDate, status, invalidatedReason } = await request.json();
  const update = { status };
  if (status === "confirmed") update.confirmedAt = new Date();
  if (status === "invalidated") update.invalidatedReason = invalidatedReason;
  await PreMarketPlan.updateOne({ symbol, forDate }, { $set: update });
  return NextResponse.json({ success: true });
}
