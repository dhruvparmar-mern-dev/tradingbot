import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import MoverLog from "@/models/MoverLog";
import { getNSEInstruments } from "@/lib/kiteInstruments";
import { computeIndicators, calculateVWAP } from "@/lib/indicators";

export const maxDuration = 60;

const CHUNK_SIZE = 400;
const MIN_PRICE = 20;
const MIN_VOLUME = 50000;
const MIN_CHANGE_PERCENT = 1;
const SHORTLIST_SIZE = 15;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// This is a numeric today's-top-movers filter only — no AI involved, zero
// cost. It deliberately does NOT run AI analysis on the results anymore: the
// old version auto-analyzed every shortlist entry, which meant burning an AI
// call on stocks that had, by definition, already moved up the most today —
// often exactly the ones where AI correctly says HOLD (extended, no more
// room to run). That made this feel like an "AI recommends" feature when it
// was really just a top-gainers list. Now it just returns the numeric
// shortlist; the user picks which ones (if any) are worth spending an AI
// call on via the "Analyze with AI" button on that stock's own page.
export async function POST(request) {
  const { mode } = await request.json();
  const tradingMode = mode || "swing";

  await connectDB();
  const session = await KiteSession.findOne({ userId: "default" });
  if (!session?.accessToken) {
    return NextResponse.json(
      {
        error:
          "Connect Kite first — a market-wide scan needs live quotes for the full NSE list.",
      },
      { status: 401 },
    );
  }
  kite.setAccessToken(session.accessToken);

  const instruments = (await getNSEInstruments()).filter(
    (i) => i.instrument_type === "EQ",
  );

  // Stage 1 — cheap numeric screen across the whole market using batched live quotes.
  // Score = today's % move weighted by how close price is to the day's high (still
  // running, not fading), filtered to a minimum price/volume floor to skip illiquid junk.
  const candidates = [];
  for (let i = 0; i < instruments.length; i += CHUNK_SIZE) {
    const chunk = instruments.slice(i, i + CHUNK_SIZE);
    try {
      const quotes = await kite.getQuote(
        chunk.map((inst) => `NSE:${inst.tradingsymbol}`),
      );
      for (const inst of chunk) {
        const q = quotes[`NSE:${inst.tradingsymbol}`];
        if (!q?.ohlc?.close || !q.last_price) continue;

        const prevClose = q.ohlc.close;
        const volume = q.volume_traded || q.volume || 0;
        const changePercent = ((q.last_price - prevClose) / prevClose) * 100;
        const dayRange = q.ohlc.high - q.ohlc.low;
        const strength =
          dayRange > 0 ? (q.last_price - q.ohlc.low) / dayRange : 0.5;

        if (
          q.last_price < MIN_PRICE ||
          volume < MIN_VOLUME ||
          changePercent < MIN_CHANGE_PERCENT
        )
          continue;

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
      console.error("Market scan quote batch failed:", err.message);
    }
    if (i + CHUNK_SIZE < instruments.length) await sleep(250);
  }

  candidates.sort((a, b) => b.score - a.score);
  const shortlist = candidates.slice(0, SHORTLIST_SIZE);

  // Stage 2 — for just the shortlist (not the whole market), check each
  // against the same "very strong" bar the AI prompt now uses: HIGH/
  // VERY_HIGH volume, trend+MACD both bullish, and a target that clears the
  // 1% floor. This is the free, deterministic pre-filter behind "Bot's
  // Pick" -- it doesn't spend AI budget, it just tells the user which of
  // today's movers are worth spending an AI call on.
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 5);
  for (const m of shortlist) {
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

      m.indicators = { rsi: ind.rsi, trend: ind.trend, macdCrossover: ind.macd.crossover, volumeSignal: ind.volume.signal, volumeRatio: ind.volume.ratio, atr: ind.atr, vwap: vwap?.toFixed(2) ?? null };
      m.actionable = volumeStrong && trendUp && macdBullish && clearsFloor;
      m.actionableReason = m.actionable
        ? `${ind.volume.signal} volume (${ind.volume.ratio}x), uptrend + bullish MACD aligned, target clears 1% (~${targetPct.toFixed(2)}%)`
        : [
            !volumeStrong && `volume only ${ind.volume.signal} (${ind.volume.ratio}x)`,
            !trendUp && "not in uptrend",
            !macdBullish && "MACD not bullish",
            !clearsFloor && `target only ~${targetPct.toFixed(2)}%, under 1%`,
          ].filter(Boolean).join("; ");
    } catch (err) {
      console.error(`Actionable check failed for ${m.symbol}:`, err.message);
    }
    await sleep(300);
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); // YYYY-MM-DD
  await Promise.all(
    shortlist.map(async (m) => {
      const existing = await MoverLog.findOne({ symbol: m.symbol, date: today });
      if (existing) {
        await MoverLog.updateOne(
          { _id: existing._id },
          {
            $inc: { timesSeenToday: 1 },
            $set: { lastSeenAt: new Date() },
            $max: { bestChangePercent: m.changePercent, bestScore: m.score },
          },
        );
      } else {
        await MoverLog.create({
          symbol: m.symbol,
          name: m.name,
          date: today,
          bestChangePercent: m.changePercent,
          bestScore: m.score,
        });
      }
    }),
  );

  return NextResponse.json({
    scannedCount: instruments.length,
    candidateCount: candidates.length,
    movers: shortlist,
    mode: tradingMode,
  });
}

const REPEAT_MIN_DAYS = 2;

// "All-time top movers" — stocks that have shown up in the numeric shortlist
// on multiple distinct days, not just once. A repeat appearance is a much
// stronger signal than a single day's move (which is often just noise).
export async function GET() {
  await connectDB();
  const repeats = await MoverLog.aggregate([
    {
      $group: {
        _id: "$symbol",
        name: { $first: "$name" },
        daysAppeared: { $sum: 1 },
        totalTimesSeen: { $sum: "$timesSeenToday" },
        bestChangePercent: { $max: "$bestChangePercent" },
        lastSeenAt: { $max: "$lastSeenAt" },
        dates: { $push: "$date" },
      },
    },
    { $match: { daysAppeared: { $gte: REPEAT_MIN_DAYS } } },
    { $sort: { daysAppeared: -1, lastSeenAt: -1 } },
  ]);

  return NextResponse.json({
    repeatMovers: repeats.map((r) => ({
      symbol: r._id,
      name: r.name,
      daysAppeared: r.daysAppeared,
      totalTimesSeen: r.totalTimesSeen,
      bestChangePercent: r.bestChangePercent,
      lastSeenAt: r.lastSeenAt,
      dates: r.dates.sort(),
    })),
  });
}
