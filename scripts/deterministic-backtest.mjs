// Deterministic (no-AI) reconstruction of the swing-mode rules stated in the
// ai-signal prompt (src/app/api/ai-signal/route.js), backtested over the
// full Jan-Jul range using already-fetched candles (data/candles-daily-*.json).
// Zero AI cost — pure local computation.
//
// This is an honest best-effort port of the STATED rules, not a reverse-
// engineering of Claude's actual black-box weighting. Where the prompt gives
// a hard rule (cost-awareness 1% floor, RSI overbought >70, trend gate for
// swing since "volume less critical than trend") we encode it as a hard
// gate. Where the prompt just says "consider X", we encode it as a bonus
// point toward the 1-10 confidence score, thresholded at >=7 to match
// MIN_CONFIDENCE used throughout our AI backtests.
//
// Usage: node scripts/deterministic-backtest.mjs

import fs from "fs";

const SYMBOLS = [
  "RELIANCE", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "BAJFINANCE",
  "TECHM", "SBIN", "PAYTM", "IRCTC", "LODHA",
];
const FROM = "2026-01-01";
const TO = "2026-07-10";
const MIN_CONFIDENCE = 7;

// --- indicator math, identical to src/lib/indicators.js / scripts/backtest.mjs ---
function calculateRSI(closes, period = 14) {
  const v = closes.filter(Boolean);
  if (v.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = v[i] - v[i - 1];
    if (d >= 0) gains += d; else losses += Math.abs(d);
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? Math.abs(d) : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}
function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) { ema = values[i] * k + ema * (1 - k); out[i] = ema; }
  return out;
}
function calculateMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const v = closes.filter(Boolean);
  if (v.length < slow + signalPeriod) return { histogram: null, crossover: null };
  const emaFast = emaSeries(v, fast), emaSlow = emaSeries(v, slow);
  const macdSeries = v.map((_, i) => (emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null)).filter((x) => x !== null);
  if (macdSeries.length < signalPeriod) return { histogram: null, crossover: null };
  const signalSeries = emaSeries(macdSeries, signalPeriod);
  const macdLine = macdSeries.at(-1), signalLine = signalSeries.at(-1);
  const histogram = signalLine != null ? macdLine - signalLine : null;
  return { histogram, crossover: histogram > 0 ? "BULLISH" : "BEARISH" };
}
function calculateATR(highs, lows, closes, period = 14) {
  const tr = [];
  for (let i = 1; i < closes.length; i++) tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  if (tr.length < period) return null;
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) atr = (atr * (period - 1) + tr[i]) / period;
  return atr;
}
function findSwingLevels(highs, lows, currentPrice, lookback = 40, strength = 2) {
  const start = Math.max(0, highs.length - lookback);
  const sh = [], sl = [];
  for (let i = start + strength; i < highs.length - strength; i++) {
    const hw = highs.slice(i - strength, i + strength + 1), lw = lows.slice(i - strength, i + strength + 1);
    if (highs[i] === Math.max(...hw)) sh.push(highs[i]);
    if (lows[i] === Math.min(...lw)) sl.push(lows[i]);
  }
  const rc = sh.filter((h) => h > currentPrice), sc = sl.filter((l) => l < currentPrice);
  return { resistance: rc.length ? Math.min(...rc) : null, support: sc.length ? Math.max(...sc) : null };
}
function computeIndicators({ closes, highs, lows, volumes }) {
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const atr = calculateATR(highs, lows, closes, 14);
  const vc = closes.filter(Boolean);
  const ema20 = emaSeries(vc, 20).at(-1);
  const price = vc.at(-1);
  const trend = ema20 != null && price != null ? (price > ema20 ? "UPTREND" : "DOWNTREND") : null;
  const swing = findSwingLevels(highs, lows, price);
  const atrRes = atr != null ? price + 2 * atr : null;
  const atrSup = atr != null ? price - 2 * atr : null;
  const last20H = highs.slice(-20).filter(Boolean), last20L = lows.slice(-20).filter(Boolean);
  const resistance = swing.resistance ?? atrRes ?? (last20H.length ? Math.max(...last20H) : null);
  const support = swing.support ?? atrSup ?? (last20L.length ? Math.min(...last20L) : null);
  const vols = volumes.slice(-20).filter(Boolean);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
  const todayVol = volumes.at(-1) || 0;
  const ratio = avgVol ? todayVol / avgVol : 0;
  const volSignal = ratio > 2.5 ? "VERY_HIGH" : ratio > 1.5 ? "HIGH" : ratio < 0.5 ? "LOW" : "NORMAL";
  return { rsi, macd, atr, trend, resistance, support, volSignal, price };
}

// --- deterministic decision, swing mode, mirrors prompt rules ---
function decide(ind) {
  if (ind.trend !== "UPTREND") return { signal: "HOLD", confidence: 0 }; // "volume less critical than trend" -> trend is the gate
  if (ind.macd.crossover !== "BULLISH") return { signal: "HOLD", confidence: 0 };
  if (ind.rsi == null || ind.rsi > 70) return { signal: "HOLD", confidence: 0 }; // overbought hard block
  if (ind.atr == null || ind.resistance == null) return { signal: "HOLD", confidence: 0 };

  const target = ind.price + 3.5 * ind.atr; // mid of stated 3-4x ATR swing range
  const headroomPct = ((target - ind.price) / ind.price) * 100;
  if (headroomPct < 1) return { signal: "HOLD", confidence: 0 }; // cost-awareness hard rule

  let confidence = 5;
  if (ind.rsi >= 30 && ind.rsi <= 65) confidence += 2; // healthy zone, not extreme
  else if (ind.rsi < 30) confidence += 1; // oversold pullback within uptrend
  if (ind.volSignal === "HIGH" || ind.volSignal === "VERY_HIGH") confidence += 1;
  if (headroomPct >= 1.5) confidence += 2; // cost-awareness "preferred" tier
  else confidence += 0;

  confidence = Math.min(10, confidence);
  if (confidence < MIN_CONFIDENCE) return { signal: "HOLD", confidence };

  return {
    signal: "BUY",
    confidence,
    stopLoss: ind.price - 1.75 * ind.atr, // mid of stated 1.5-2x ATR swing range
    target,
  };
}

function simulateSymbol(symbol) {
  const candles = JSON.parse(fs.readFileSync(`data/candles-daily-${symbol}.json`, "utf8"));
  const simDays = candles.filter((c) => c.date >= FROM && c.date <= TO);

  let position = null;
  const trades = [];

  for (const day of simDays) {
    const windowCandles = candles.filter((c) => c.date <= day.date);

    if (position) {
      let exitPrice = null, exitReason = null;
      if (day.low <= position.stopLoss) { exitPrice = position.stopLoss; exitReason = "STOP_LOSS"; }
      else if (day.high >= position.target) { exitPrice = position.target; exitReason = "TARGET"; }
      else if ((new Date(day.date) - new Date(position.entryDate)) / 864e5 > 10) { exitPrice = day.close; exitReason = "TIME_EXIT"; }

      if (exitPrice != null) {
        const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
        trades.push({ symbol, entryDate: position.entryDate, entryPrice: position.entryPrice, exitDate: day.date, exitReason, pnlPct: Math.round(pnlPct * 100) / 100 });
        position = null;
      } else continue;
    }

    if (windowCandles.length < 35) continue;
    const ind = computeIndicators({
      closes: windowCandles.map((c) => c.close),
      highs: windowCandles.map((c) => c.high),
      lows: windowCandles.map((c) => c.low),
      volumes: windowCandles.map((c) => c.volume),
    });
    const d = decide(ind);
    if (d.signal === "BUY") {
      position = { entryPrice: day.close, entryDate: day.date, stopLoss: d.stopLoss, target: d.target };
    }
  }
  return trades;
}

function stats(trades) {
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const r1 = (n) => Math.round(n * 100) / 100;
  return {
    trades: trades.length,
    wins: wins.length,
    winRatePct: trades.length ? r1((wins.length / trades.length) * 100) : null,
    totalPnlPct: r1(trades.reduce((s, t) => s + t.pnlPct, 0)),
    avgWinPct: wins.length ? r1(grossWin / wins.length) : null,
    avgLossPct: losses.length ? r1(-grossLoss / losses.length) : null,
    profitFactor: grossLoss ? r1(grossWin / grossLoss) : null,
  };
}

const allTrades = [];
const perSymbol = {};
for (const sym of SYMBOLS) {
  const trades = simulateSymbol(sym);
  perSymbol[sym] = { trades, ...stats(trades) };
  allTrades.push(...trades);
}

const janMar = allTrades.filter((t) => t.exitDate < "2026-04-01");
const aprJul = allTrades.filter((t) => t.exitDate >= "2026-04-01");

const out = {
  generatedAt: new Date().toISOString(),
  overall: stats(allTrades),
  janMarSubperiod: stats(janMar),
  aprJulSubperiod: stats(aprJul),
  perSymbol: Object.fromEntries(Object.entries(perSymbol).map(([k, v]) => [k, { trades: v.trades.length, wins: v.wins, winRatePct: v.winRatePct, totalPnlPct: v.totalPnlPct }])),
  allTrades,
};

fs.writeFileSync("data/deterministic-backtest.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ overall: out.overall, janMarSubperiod: out.janMarSubperiod, aprJulSubperiod: out.aprJulSubperiod, perSymbol: out.perSymbol }, null, 2));
