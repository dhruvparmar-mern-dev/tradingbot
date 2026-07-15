import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import DeepScanLog from "@/models/DeepScanLog";
import MarketScanSnapshot from "@/models/MarketScanSnapshot";
import { getNSEInstruments } from "@/lib/kiteInstruments";
import { computeIndicators, calculateVWAP } from "@/lib/indicators";
import { hasMarketOpenedToday } from "@/lib/marketHours";

export const maxDuration = 60;

const CHUNK_SIZE = 400;
const MIN_PRICE = 20; // same penny/illiquid floor as market-scan
const MIN_VOLUME = 50000;
const CHEAP_SHORTLIST_SIZE = 40; // stage-2 (real chart fetch) only runs on this many

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Whole-market screener, not just today's movers: market-scan's shortlist
// requires a stock to already be up 1%+ today, which misses a quietly
// strong setup that hasn't made a big move yet. This scans the full liquid
// (non-penny) universe, ranks by a proximity-to-high score with NO
// minimum-gain floor, and only runs the expensive real-chart check on the
// top slice -- same 2-stage funnel as market-scan, just without the
// "must already be a mover" requirement. No AI involved, zero cost.
export async function POST() {
  // Same guard as market-scan -- a manual click (or a bug) before the
  // market opens today would log Kite's stale last-traded data under
  // today's date.
  if (!hasMarketOpenedToday()) {
    return NextResponse.json(
      { error: "Market hasn't opened yet today (before 9:15 AM IST) — scanning now would log stale data under today's date." },
      { status: 400 },
    );
  }

  await connectDB();
  const session = await KiteSession.findOne({ userId: "default" });
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Connect Kite first — a market-wide scan needs live quotes for the full NSE list." },
      { status: 401 },
    );
  }
  kite.setAccessToken(session.accessToken);

  const instruments = (await getNSEInstruments()).filter((i) => i.instrument_type === "EQ");

  // Stage 1 — cheap numeric screen across the whole market. Only floor is
  // price/volume (penny/illiquid removal) -- no minimum today's-move, since
  // the point is to catch stocks that haven't necessarily moved yet.
  const candidates = [];
  for (let i = 0; i < instruments.length; i += CHUNK_SIZE) {
    const chunk = instruments.slice(i, i + CHUNK_SIZE);
    try {
      const quotes = await kite.getQuote(chunk.map((inst) => `NSE:${inst.tradingsymbol}`));
      for (const inst of chunk) {
        const q = quotes[`NSE:${inst.tradingsymbol}`];
        if (!q?.ohlc?.close || !q.last_price) continue;

        const prevClose = q.ohlc.close;
        const volume = q.volume_traded || q.volume || 0;
        if (q.last_price < MIN_PRICE || volume < MIN_VOLUME) continue;

        const changePercent = ((q.last_price - prevClose) / prevClose) * 100;
        const dayRange = q.ohlc.high - q.ohlc.low;
        const strength = dayRange > 0 ? (q.last_price - q.ohlc.low) / dayRange : 0.5;

        candidates.push({
          symbol: `${inst.tradingsymbol}.NS`,
          name: inst.name,
          price: q.last_price,
          changePercent: parseFloat(changePercent.toFixed(2)),
          volume,
          score: changePercent * strength,
        });
      }
    } catch (err) {
      console.error("Deep scan quote batch failed:", err.message);
    }
    if (i + CHUNK_SIZE < instruments.length) await sleep(250);
  }

  candidates.sort((a, b) => b.score - a.score);
  const cheapShortlist = candidates.slice(0, CHEAP_SHORTLIST_SIZE);

  // Stage 2 — real chart data + the same "very strong" bar the AI prompt
  // and market-scan's Bot's Pick use: HIGH/VERY_HIGH volume, trend+MACD both
  // bullish, target clears the 1% floor.
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 5);
  const results = [];
  for (const m of cheapShortlist) {
    const inst = instruments.find((i) => `${i.tradingsymbol}.NS` === m.symbol);
    if (!inst) continue;
    try {
      const candles = await kite.getHistoricalData(inst.instrument_token, "5minute", fromDate, new Date());
      if (!candles.length) continue;
      const closes = candles.map((c) => c.close).filter(Boolean).sort((a, b) => a - b);
      const median = closes[Math.floor(closes.length / 2)];
      const clean = candles.filter((c) => !(c.high > median * 3 || c.low < median / 3));
      const ind = computeIndicators({
        closes: clean.map((c) => c.close),
        highs: clean.map((c) => c.high),
        lows: clean.map((c) => c.low),
        volumes: clean.map((c) => c.volume),
      });
      const todayStr = new Date(clean.at(-1).date).toDateString();
      const todaysCandles = clean.filter((c) => new Date(c.date).toDateString() === todayStr);
      const vwap = calculateVWAP(
        todaysCandles.map((c) => c.high), todaysCandles.map((c) => c.low),
        todaysCandles.map((c) => c.close), todaysCandles.map((c) => c.volume),
      );

      const atr = parseFloat(ind.atr);
      const targetPct = atr ? ((2 * atr) / m.price) * 100 : 0;
      const volumeStrong = ind.volume.signal === "HIGH" || ind.volume.signal === "VERY_HIGH";
      const trendUp = ind.trend === "UPTREND";
      const macdBullish = ind.macd.crossover === "BULLISH";
      const clearsFloor = targetPct >= 1;
      const actionable = volumeStrong && trendUp && macdBullish && clearsFloor;

      results.push({
        ...m,
        indicators: { rsi: ind.rsi, trend: ind.trend, macdCrossover: ind.macd.crossover, volumeSignal: ind.volume.signal, volumeRatio: ind.volume.ratio, atr: ind.atr, vwap: vwap?.toFixed(2) ?? null },
        actionable,
        actionableReason: actionable
          ? `${ind.volume.signal} volume (${ind.volume.ratio}x), uptrend + bullish MACD aligned, target clears 1% (~${targetPct.toFixed(2)}%)`
          : [
              !volumeStrong && `volume only ${ind.volume.signal} (${ind.volume.ratio}x)`,
              !trendUp && "not in uptrend",
              !macdBullish && "MACD not bullish",
              !clearsFloor && `target only ~${targetPct.toFixed(2)}%, under 1%`,
            ].filter(Boolean).join("; "),
      });
    } catch (err) {
      console.error(`Deep scan chart check failed for ${m.symbol}:`, err.message);
    }
    await sleep(300);
  }

  const actionableResults = results.filter((r) => r.actionable);

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  await Promise.all(
    actionableResults.map(async (m) => {
      const existing = await DeepScanLog.findOne({ symbol: m.symbol, date: today });
      if (existing) {
        await DeepScanLog.updateOne(
          { _id: existing._id },
          { $inc: { timesSeenToday: 1 }, $set: { lastSeenAt: new Date(), reason: m.actionableReason }, $max: { bestChangePercent: m.changePercent } },
        );
      } else {
        await DeepScanLog.create({
          symbol: m.symbol, name: m.name, date: today,
          bestChangePercent: m.changePercent, reason: m.actionableReason,
        });
      }
    }),
  );

  await MarketScanSnapshot.findOneAndUpdate(
    { key: "deepScanLatest" },
    {
      movers: results,
      scannedCount: instruments.length,
      candidateCount: candidates.length,
      updatedAt: new Date(),
    },
    { upsert: true },
  );

  return NextResponse.json({
    scannedCount: instruments.length,
    candidateCount: candidates.length,
    checkedCount: results.length,
    results,
  });
}

const REPEAT_MIN_DAYS = 2;

export async function GET() {
  await connectDB();
  const snapshot = await MarketScanSnapshot.findOne({ key: "deepScanLatest" }).lean();
  const repeats = await DeepScanLog.aggregate([
    {
      $group: {
        _id: "$symbol",
        name: { $first: "$name" },
        daysAppeared: { $sum: 1 },
        bestChangePercent: { $max: "$bestChangePercent" },
        lastSeenAt: { $max: "$lastSeenAt" },
        dates: { $push: "$date" },
      },
    },
    { $match: { daysAppeared: { $gte: REPEAT_MIN_DAYS } } },
    { $sort: { daysAppeared: -1, lastSeenAt: -1 } },
  ]);

  return NextResponse.json({
    latestSnapshot: snapshot
      ? {
          results: snapshot.movers,
          scannedCount: snapshot.scannedCount,
          candidateCount: snapshot.candidateCount,
          updatedAt: snapshot.updatedAt,
        }
      : null,
    repeatPicks: repeats.map((r) => ({
      symbol: r._id,
      name: r.name,
      daysAppeared: r.daysAppeared,
      bestChangePercent: r.bestChangePercent,
      lastSeenAt: r.lastSeenAt,
      dates: r.dates.sort(),
    })),
  });
}
