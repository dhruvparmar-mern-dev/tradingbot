import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import { getNSEInstruments } from "@/lib/kiteInstruments";
import { runAnalysisServerSide } from "@/lib/runAnalysisServer";

export const maxDuration = 60;

const CHUNK_SIZE = 400;
const MIN_PRICE = 20;
const MIN_VOLUME = 50000;
const MIN_CHANGE_PERCENT = 1;
const SHORTLIST_SIZE = 15;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request) {
  const { mode } = await request.json();
  const tradingMode = mode || "swing";
  const cookieHeader = request.headers.get("cookie") || "";

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

  // Stage 2 — full AI analysis, only on the shortlist. Run in parallel to stay
  // well under the serverless function time limit.
  const picks = await Promise.all(
    shortlist.map(async (candidate) => {
      try {
        const analysis = await runAnalysisServerSide(
          {
            symbol: candidate.symbol,
            name: candidate.name,
            price: candidate.price,
          },
          tradingMode,
          true,
          cookieHeader,
        );
        return { ...candidate, ...analysis };
      } catch (err) {
        console.error(
          `Market scan AI analysis failed for ${candidate.symbol}:`,
          err.message,
        );
        return { ...candidate, error: err.message };
      }
    }),
  );

  return NextResponse.json({
    scannedCount: instruments.length,
    candidateCount: candidates.length,
    picks: picks.sort((a, b) => (b.confidence || 0) - (a.confidence || 0)),
    mode: tradingMode,
  });
}
