import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import MoverLog from "@/models/MoverLog";
import { getNSEInstruments } from "@/lib/kiteInstruments";

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
