// Reusable swing-mode backtest — replays the bot's exact live decision
// pipeline (same /api/ai-signal endpoint, same indicator math) across a
// historical date range, so a strategy change can be validated against real
// history before trusting it live, instead of just "it looked right today."
//
// Usage:
//   node scripts/backtest.mjs <SYMBOL> <FROM_DATE> <TO_DATE> [BASE_URL] [COOKIE]
//   node scripts/backtest.mjs RELIANCE 2026-04-01 2026-07-01
//
// Requires a running dev server (npm run dev) and a valid auth_token cookie
// (same one used for manual testing — see /tmp/ck.txt pattern in prior
// sessions). Costs real AI tokens: roughly one call per trading day the bot
// isn't already holding a position — prints an estimate and asks nothing
// automatically, so review the estimate before running a large range.

import "dotenv/config";
import mongoose from "mongoose";
import { KiteConnect } from "kiteconnect";
import fs from "fs";

// --- inlined from src/lib/indicators.js (kept identical to production) ---
function calculateRSI(closes, period = 14) {
  const validCloses = closes.filter(Boolean);
  if (validCloses.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = validCloses[i] - validCloses[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < validCloses.length; i++) {
    const diff = validCloses[i] - validCloses[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}
function calculateMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const validCloses = closes.filter(Boolean);
  if (validCloses.length < slow + signalPeriod) return { macdLine: null, signalLine: null, histogram: null };
  const emaFast = emaSeries(validCloses, fast);
  const emaSlow = emaSeries(validCloses, slow);
  const macdSeries = validCloses.map((_, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null)).filter((v) => v !== null);
  if (macdSeries.length < signalPeriod) return { macdLine: macdSeries.at(-1) ?? null, signalLine: null, histogram: null };
  const signalSeries = emaSeries(macdSeries, signalPeriod);
  const macdLine = macdSeries.at(-1);
  const signalLine = signalSeries.at(-1);
  return { macdLine, signalLine, histogram: macdLine - signalLine };
}
function calculateATR(highs, lows, closes, period = 14) {
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    trueRanges.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  if (trueRanges.length < period) return null;
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) atr = (atr * (period - 1) + trueRanges[i]) / period;
  return atr;
}
function findSwingLevels(highs, lows, currentPrice, lookback = 40, strength = 2) {
  const start = Math.max(0, highs.length - lookback);
  const swingHighs = [], swingLows = [];
  for (let i = start + strength; i < highs.length - strength; i++) {
    const highWindow = highs.slice(i - strength, i + strength + 1);
    const lowWindow = lows.slice(i - strength, i + strength + 1);
    if (highs[i] === Math.max(...highWindow)) swingHighs.push(highs[i]);
    if (lows[i] === Math.min(...lowWindow)) swingLows.push(lows[i]);
  }
  const resistanceCandidates = swingHighs.filter((h) => h > currentPrice);
  const supportCandidates = swingLows.filter((l) => l < currentPrice);
  const resistance = resistanceCandidates.length ? Math.min(...resistanceCandidates) : null;
  const support = supportCandidates.length ? Math.max(...supportCandidates) : null;
  return { support, resistance };
}
function computeIndicators({ closes, highs, lows, volumes }) {
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const atr = calculateATR(highs, lows, closes, 14);
  const validClosesForTrend = closes.filter(Boolean);
  const ema20Series = emaSeries(validClosesForTrend, 20);
  const currentEma20 = ema20Series.at(-1);
  const currentPriceForTrend = validClosesForTrend.at(-1);
  const hasEmaTrend = currentEma20 != null && currentPriceForTrend != null;
  const trend = hasEmaTrend
    ? (currentPriceForTrend > currentEma20 ? "UPTREND" : "DOWNTREND")
    : (validClosesForTrend.length > 1 && validClosesForTrend.at(-1) > validClosesForTrend[0] ? "UPTREND" : "DOWNTREND");
  const trendStrength = hasEmaTrend ? (((currentPriceForTrend - currentEma20) / currentEma20) * 100).toFixed(2) : "0.00";
  const validHighs = highs.filter(Boolean);
  const validLows = lows.filter(Boolean);
  const currentPrice = closes.filter(Boolean).at(-1);
  const swingLevels = validHighs.length === highs.length && validLows.length === lows.length ? findSwingLevels(highs, lows, currentPrice) : { support: null, resistance: null };
  const last20Highs = highs.slice(-20).filter(Boolean);
  const last20Lows = lows.slice(-20).filter(Boolean);
  const atrResistance = atr != null && currentPrice != null ? currentPrice + 2 * atr : null;
  const atrSupport = atr != null && currentPrice != null ? currentPrice - 2 * atr : null;
  const resistanceValue = swingLevels.resistance ?? atrResistance ?? (last20Highs.length ? Math.max(...last20Highs) : null);
  const supportValue = swingLevels.support ?? atrSupport ?? (last20Lows.length ? Math.min(...last20Lows) : null);
  const resistance = resistanceValue != null ? resistanceValue.toFixed(2) : null;
  const support = supportValue != null ? supportValue.toFixed(2) : null;
  const validVolumes = volumes.slice(-20).filter(Boolean);
  const avgVolume = validVolumes.length ? validVolumes.reduce((a, b) => a + b, 0) / validVolumes.length : 0;
  const todayVolume = volumes[volumes.length - 1] || 0;
  const volumeRatio = avgVolume ? (todayVolume / avgVolume).toFixed(2) : "0.00";
  let volumeSignal = "NORMAL";
  if (volumeRatio > 1.5) volumeSignal = "HIGH";
  if (volumeRatio > 2.5) volumeSignal = "VERY_HIGH";
  if (volumeRatio < 0.5) volumeSignal = "LOW";
  return {
    rsi: rsi?.toFixed(2),
    macd: { value: macd.macdLine?.toFixed(2), signal: macd.signalLine?.toFixed(2), histogram: macd.histogram?.toFixed(2), crossover: macd.histogram > 0 ? "BULLISH" : "BEARISH" },
    atr: atr?.toFixed(2) ?? null,
    trend, trendStrength: `${trendStrength}%`, support, resistance,
    volume: { today: todayVolume, avg20Day: Math.round(avgVolume), ratio: volumeRatio, signal: volumeSignal },
  };
}
// --- end inlined ---

const SYMBOL = process.argv[2];
const FROM_DATE = process.argv[3];
const TO_DATE = process.argv[4];
const BASE_URL = process.argv[5] || "http://localhost:3000";
const COOKIE = process.argv[6];
const MODE = "swing";
const MIN_CONFIDENCE = 7; // matches the app's default minConfidence setting

if (!SYMBOL || !FROM_DATE || !TO_DATE || !COOKIE) {
  console.error(
    "Usage: node scripts/backtest.mjs <SYMBOL> <FROM_DATE> <TO_DATE> [BASE_URL] <COOKIE>",
  );
  process.exit(1);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const KiteSession = mongoose.model("KiteSession", new mongoose.Schema({}, { strict: false }));
  const session = await KiteSession.findOne({ userId: "default" });
  const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
  kite.setAccessToken(session.accessToken);
  const instruments = await kite.getInstruments("NSE");
  const instrument = instruments.find((i) => i.tradingsymbol === SYMBOL);
  if (!instrument) {
    console.error(`Instrument not found: ${SYMBOL}`);
    process.exit(1);
  }

  const toDate = new Date(TO_DATE);
  const fromDateBuffer = new Date(FROM_DATE);
  fromDateBuffer.setMonth(fromDateBuffer.getMonth() - 3); // need 3mo history for the earliest simulated day too

  console.log(`Fetching daily candles for ${SYMBOL} from ${fromDateBuffer.toISOString().slice(0, 10)} to ${TO_DATE}...`);
  const allCandles = await kite.getHistoricalData(instrument.instrument_token, "day", fromDateBuffer, toDate);

  const simStart = new Date(FROM_DATE);
  const simDays = allCandles.filter((c) => new Date(c.date) >= simStart && new Date(c.date) <= toDate);

  console.log(`Simulating ${simDays.length} trading days. Estimated cost: ~$${(simDays.length * 0.009).toFixed(2)} (fewer if a position is held across days).\n`);

  let memory = null;
  let position = null; // { entryPrice, entryDate, stopLoss, target }
  const trades = [];
  const equityCurve = [];

  for (const day of simDays) {
    const dayDate = new Date(day.date);
    const windowCandles = allCandles.filter((c) => new Date(c.date) <= dayDate);

    // Check exit conditions first if holding a position (using this day's H/L)
    if (position) {
      let exitPrice = null;
      let exitReason = null;
      if (day.low <= position.stopLoss) {
        exitPrice = position.stopLoss;
        exitReason = "STOP_LOSS";
      } else if (day.high >= position.target) {
        exitPrice = position.target;
        exitReason = "TARGET";
      } else if (
        (dayDate - position.entryDate) / (1000 * 60 * 60 * 24) > 10
      ) {
        exitPrice = day.close;
        exitReason = "TIME_EXIT";
      }

      if (exitPrice != null) {
        const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
        trades.push({
          symbol: SYMBOL,
          entryDate: position.entryDate.toISOString().slice(0, 10),
          entryPrice: position.entryPrice,
          exitDate: day.date.toISOString ? day.date.toISOString().slice(0, 10) : String(day.date).slice(0, 10),
          exitPrice,
          exitReason,
          pnlPct: parseFloat(pnlPct.toFixed(2)),
        });
        console.log(
          `  ${trades.length}. EXIT ${exitReason} on ${trades.at(-1).exitDate}: entry ₹${position.entryPrice} -> exit ₹${exitPrice} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%)`,
        );
        position = null;
      } else {
        continue; // still holding, skip AI call this day (matches live auto-buy behavior)
      }
    }

    // No position — run analysis for today
    const closes = windowCandles.map((c) => c.close);
    const highs = windowCandles.map((c) => c.high);
    const lows = windowCandles.map((c) => c.low);
    const volumes = windowCandles.map((c) => c.volume);
    if (closes.length < 35) continue; // not enough history yet for MACD

    const indicators = computeIndicators({ closes, highs, lows, volumes });
    const prevClose = windowCandles.at(-2)?.close ?? day.close;

    const stockData = {
      symbol: `${SYMBOL}.NS`,
      name: instrument.name,
      exchange: "NSE",
      price: day.close,
      change: ((day.close - prevClose) / prevClose) * 100,
      changeAmount: day.close - prevClose,
      open: day.open,
      high: day.high,
      low: day.low,
      prevClose,
      volume: day.volume,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
    };

    const aiRes = await fetch(`${BASE_URL}/api/ai-signal`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: COOKIE },
      body: JSON.stringify({
        stockData,
        news: [],
        chartData: { indicators },
        memory,
        marketContext: null,
        tradingMode: MODE,
      }),
    });
    const aiData = await aiRes.json();

    if (aiData.error) {
      console.error(`  ${day.date}: AI error — ${aiData.error}`);
      if (aiData.error.startsWith("Daily AI budget")) {
        console.error("Budget hit — stopping backtest early.");
        break;
      }
      continue;
    }

    if (aiData.memoryUpdate) {
      memory = {
        ...memory,
        character: aiData.memoryUpdate.character,
        behavior: aiData.memoryUpdate.behavior,
        keyLevels: aiData.memoryUpdate.keyLevels,
        lastAnalysis: {
          signal: aiData.signal,
          confidence: aiData.confidence,
          rsi: indicators.rsi,
          trend: indicators.trend,
          reason: aiData.reason,
          stopLoss: aiData.stopLoss,
          target: aiData.target,
          price: day.close,
          date: dayDate,
        },
        signalHistory: [
          ...(memory?.signalHistory || []),
          { signal: aiData.signal, confidence: aiData.confidence, price: day.close, date: dayDate, outcome: "PENDING" },
        ].slice(-20),
      };
    }

    const dateStr = dayDate.toISOString().slice(0, 10);
    if (aiData.signal === "BUY" && aiData.confidence >= MIN_CONFIDENCE) {
      position = {
        entryPrice: day.close,
        entryDate: dayDate,
        stopLoss: aiData.stopLoss,
        target: aiData.target,
      };
      console.log(`  ${dateStr}: BUY @ ₹${day.close} (conf ${aiData.confidence}, SL ${aiData.stopLoss}, target ${aiData.target})`);
    } else {
      console.log(`  ${dateStr}: ${aiData.signal} (conf ${aiData.confidence})`);
    }

    equityCurve.push({ date: dateStr, signal: aiData.signal });
  }

  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const winRate = trades.length ? ((wins.length / trades.length) * 100).toFixed(1) : "N/A";

  console.log("\n=== SUMMARY ===");
  console.log(`Symbol: ${SYMBOL} | Range: ${FROM_DATE} to ${TO_DATE}`);
  console.log(`Total trades: ${trades.length} | Wins: ${wins.length} | Losses: ${losses.length} | Win rate: ${winRate}%`);
  console.log(`Total P&L (sum of trade %): ${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%`);
  if (position) {
    console.log(`Still holding a position at end of range: entry ₹${position.entryPrice} on ${position.entryDate.toISOString().slice(0, 10)}`);
  }

  fs.writeFileSync(
    `backtest-${SYMBOL}-${FROM_DATE}-to-${TO_DATE}.json`,
    JSON.stringify({ symbol: SYMBOL, from: FROM_DATE, to: TO_DATE, trades, summary: { totalTrades: trades.length, wins: wins.length, losses: losses.length, winRate, totalPnlPct } }, null, 2),
  );

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
