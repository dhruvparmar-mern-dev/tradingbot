// Post-backtest forensics — saves everything the backtest touched (Kite
// candles, full AI prompts/responses, per-trade results) into data/ as JSON,
// then joins trades with their entry-day AI snapshot to answer: what did
// winners look like vs losers at the moment of entry, where did the losses
// actually come from, and which candidate fixes are supported by the data.
// No AI calls — pure local analysis, free to re-run.
//
// Usage: node scripts/analyze-backtest.mjs

import "dotenv/config";
import mongoose from "mongoose";
import { KiteConnect } from "kiteconnect";
import fs from "fs";

const DATA_DIR = "data";
const SYMBOLS = [
  "RELIANCE", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "BAJFINANCE",
  "TECHM", "SBIN", "PAYTM", "IRCTC", "LODHA",
];
const RANGE = "2026-04-01-to-2026-07-10";
const NIFTY_TOKEN = 256265; // NIFTY 50 index instrument token
const FROM = new Date("2026-01-01");
const TO = new Date("2026-07-10T23:59:59");

// NOTE on dates: Kite daily candles carry IST-midnight timestamps; the
// backtest sliced them via toISOString() which shifts them -1 day (that's why
// some "dates" land on Sundays). We use the exact same transformation here so
// every join stays internally consistent.
const dkey = (d) => new Date(d).toISOString().slice(0, 10);

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

const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // 1. Move backtest result files from repo root into data/
  for (const f of fs.readdirSync(".")) {
    if (/^backtest-.*\.json$/.test(f)) fs.renameSync(f, `${DATA_DIR}/${f}`);
  }

  // 2. Dump today's swing audit records (full prompts + responses)
  await mongoose.connect(process.env.MONGODB_URI);
  const AiUsage = mongoose.model("AiUsage", new mongoose.Schema({}, { strict: false }));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const audit = await AiUsage.find({ time: { $gte: startOfToday }, mode: "swing" })
    .sort({ time: 1 })
    .lean();
  fs.writeFileSync(
    `${DATA_DIR}/audit-swing-backtest.json`,
    JSON.stringify(audit, null, 1),
  );
  console.log(`Saved ${audit.length} audit records -> ${DATA_DIR}/audit-swing-backtest.json`);

  // 3. Fetch + save daily candles (stocks + NIFTY)
  const KiteSession = mongoose.model("KiteSession", new mongoose.Schema({}, { strict: false }));
  const session = await KiteSession.findOne({ userId: "default" });
  const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
  kite.setAccessToken(session.accessToken);
  let instruments = null;

  const candlesBySym = {};
  for (const sym of SYMBOLS) {
    const file = `${DATA_DIR}/candles-daily-${sym}.json`;
    if (fs.existsSync(file)) {
      candlesBySym[sym] = JSON.parse(fs.readFileSync(file, "utf8"));
      continue;
    }
    if (!instruments) instruments = await kite.getInstruments("NSE");
    const inst = instruments.find((i) => i.tradingsymbol === sym);
    const raw = await kite.getHistoricalData(inst.instrument_token, "day", FROM, TO);
    candlesBySym[sym] = raw.map((c) => ({
      date: dkey(c.date), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    }));
    fs.writeFileSync(file, JSON.stringify(candlesBySym[sym], null, 1));
    await new Promise((r) => setTimeout(r, 350));
  }

  const niftyFile = `${DATA_DIR}/candles-daily-NIFTY50.json`;
  let nifty;
  if (fs.existsSync(niftyFile)) {
    nifty = JSON.parse(fs.readFileSync(niftyFile, "utf8"));
  } else {
    const raw = await kite.getHistoricalData(NIFTY_TOKEN, "day", FROM, TO);
    nifty = raw.map((c) => ({ date: dkey(c.date), close: c.close }));
    fs.writeFileSync(niftyFile, JSON.stringify(nifty, null, 1));
  }
  const niftyEma = emaSeries(nifty.map((c) => c.close), 20);
  const regimeOn = (date) => {
    // last NIFTY day on/before `date`
    let idx = -1;
    for (let i = 0; i < nifty.length; i++) {
      if (nifty[i].date <= date) idx = i;
      else break;
    }
    if (idx < 0 || niftyEma[idx] == null) return null;
    return nifty[idx].close > niftyEma[idx] ? "BULL" : "BEAR";
  };

  console.log(`Saved daily candles for ${SYMBOLS.length} stocks + NIFTY50 -> ${DATA_DIR}/`);

  // 4. Load trades
  const trades = [];
  for (const sym of SYMBOLS) {
    const j = JSON.parse(fs.readFileSync(`${DATA_DIR}/backtest-${sym}-${RANGE}.json`, "utf8"));
    for (const t of j.trades) trades.push({ ...t, symbol: sym });
  }

  // 5. Join each trade with its entry-day AI snapshot (from the audit dump)
  for (const t of trades) {
    const rec = audit.find(
      (r) =>
        r.symbol === `${t.symbol}.NS` &&
        r.parsedResponse?.signal === "BUY" &&
        (r.parsedResponse?.confidence ?? 0) >= 7 &&
        r.prompt?.includes(`Price: ₹${t.entryPrice} (`),
    );
    t.win = t.pnlPct > 0;
    t.month = t.entryDate.slice(0, 7);
    t.regime = regimeOn(t.entryDate);
    if (!rec) { t.snap = null; continue; }
    const p = rec.prompt;
    const g = (re) => { const m = p.match(re); return m ? m[1] : null; };
    const resp = rec.parsedResponse;
    const snap = {
      rsi: parseFloat(g(/RSI \(14\): ([\d.]+)/)),
      trend: g(/Trend: (UPTREND|DOWNTREND)/),
      trendStrengthPct: parseFloat(g(/price is (-?[\d.]+)% vs/)),
      macd: g(/MACD Crossover: (BULLISH|BEARISH)/),
      atr: parseFloat(g(/ATR \(14\): ₹([\d.]+)/)),
      support: parseFloat(g(/\nSupport: ₹([\d.]+)/)),
      resistance: parseFloat(g(/\nResistance: ₹([\d.]+)/)),
      stopLoss: resp?.stopLoss,
      target: resp?.target,
      reason: resp?.reason,
    };
    snap.stopDistPct = snap.stopLoss ? ((t.entryPrice - snap.stopLoss) / t.entryPrice) * 100 : null;
    snap.targetDistPct = snap.target ? ((snap.target - t.entryPrice) / t.entryPrice) * 100 : null;
    snap.rr = snap.stopDistPct && snap.targetDistPct ? snap.targetDistPct / snap.stopDistPct : null;
    snap.atrPct = snap.atr ? (snap.atr / t.entryPrice) * 100 : null;
    snap.headroomToResistancePct =
      snap.resistance ? ((snap.resistance - t.entryPrice) / t.entryPrice) * 100 : null;
    snap.targetBeyondResistance =
      snap.target != null && snap.resistance != null ? snap.target > snap.resistance : null;
    t.snap = snap;
  }

  // 6. Aggregate stats
  const wins = trades.filter((t) => t.win);
  const losses = trades.filter((t) => !t.win);
  const byExit = {};
  for (const t of trades) {
    byExit[t.exitReason] ??= { count: 0, wins: 0, pnlSum: 0 };
    byExit[t.exitReason].count++;
    if (t.win) byExit[t.exitReason].wins++;
    byExit[t.exitReason].pnlSum += t.pnlPct;
  }
  const byMonth = {};
  for (const t of trades) {
    byMonth[t.month] ??= { count: 0, wins: 0, pnlSum: 0 };
    byMonth[t.month].count++;
    if (t.win) byMonth[t.month].wins++;
    byMonth[t.month].pnlSum += t.pnlPct;
  }
  const byRegime = {};
  for (const t of trades) {
    const r = t.regime ?? "UNKNOWN";
    byRegime[r] ??= { count: 0, wins: 0, pnlSum: 0 };
    byRegime[r].count++;
    if (t.win) byRegime[r].wins++;
    byRegime[r].pnlSum += t.pnlPct;
  }

  const snapStats = (arr) => ({
    n: arr.length,
    avgRsi: r2(avg(arr.map((t) => t.snap?.rsi).filter((v) => v != null))),
    avgStopDistPct: r2(avg(arr.map((t) => t.snap?.stopDistPct).filter((v) => v != null))),
    avgTargetDistPct: r2(avg(arr.map((t) => t.snap?.targetDistPct).filter((v) => v != null))),
    avgRR: r2(avg(arr.map((t) => t.snap?.rr).filter((v) => v != null))),
    avgAtrPct: r2(avg(arr.map((t) => t.snap?.atrPct).filter((v) => v != null))),
    avgHeadroomPct: r2(avg(arr.map((t) => t.snap?.headroomToResistancePct).filter((v) => v != null))),
    macdBullish: arr.filter((t) => t.snap?.macd === "BULLISH").length,
    uptrend: arr.filter((t) => t.snap?.trend === "UPTREND").length,
    targetBeyondResistance: arr.filter((t) => t.snap?.targetBeyondResistance === true).length,
  });

  // 7. Re-simulation A: hard 3% stop cap (risk never exceeds 3% even if 2x ATR is wider)
  function resim(t, { stopCapPct = null } = {}) {
    const sl0 = t.snap?.stopLoss, target = t.snap?.target;
    if (sl0 == null || target == null) return null;
    const sl = stopCapPct != null ? Math.max(sl0, t.entryPrice * (1 - stopCapPct)) : sl0;
    const candles = candlesBySym[t.symbol];
    const idx = candles.findIndex((c) => c.date === t.entryDate);
    if (idx < 0) return null;
    const entryMs = new Date(t.entryDate).getTime();
    for (let i = idx + 1; i < candles.length; i++) {
      const d = candles[i];
      if (d.low <= sl) return { exit: "STOP_LOSS", pnlPct: ((sl - t.entryPrice) / t.entryPrice) * 100 };
      if (d.high >= target) return { exit: "TARGET", pnlPct: ((target - t.entryPrice) / t.entryPrice) * 100 };
      if ((new Date(d.date).getTime() - entryMs) / 86400000 > 10)
        return { exit: "TIME_EXIT", pnlPct: ((d.close - t.entryPrice) / t.entryPrice) * 100 };
    }
    return { exit: "OPEN", pnlPct: ((candles.at(-1).close - t.entryPrice) / t.entryPrice) * 100 };
  }

  const cappedResults = trades.map((t) => ({ t, r: resim(t, { stopCapPct: 0.03 }) }));
  const capped = cappedResults.filter((x) => x.r);
  const cappedTotal = capped.reduce((s, x) => s + x.r.pnlPct, 0);
  const cappedWins = capped.filter((x) => x.r.pnlPct > 0).length;
  const flippedWinners = capped.filter((x) => x.t.win && x.r.pnlPct <= 0).length;

  // Re-simulation B: skip entries taken in a BEAR regime (NIFTY < 20DMA)
  const bullOnly = trades.filter((t) => t.regime === "BULL");
  const bullOnlyTotal = bullOnly.reduce((s, t) => s + t.pnlPct, 0);
  const bullOnlyWins = bullOnly.filter((t) => t.win).length;

  // Re-simulation C: both combined
  const comboBase = cappedResults.filter((x) => x.r && x.t.regime === "BULL");
  const comboTotal = comboBase.reduce((s, x) => s + x.r.pnlPct, 0);
  const comboWins = comboBase.filter((x) => x.r.pnlPct > 0).length;

  const analysis = {
    generatedAt: new Date().toISOString(),
    totals: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRatePct: r2((wins.length / trades.length) * 100),
      totalPnlPct: r2(trades.reduce((s, t) => s + t.pnlPct, 0)),
      avgWinPct: r2(avg(wins.map((t) => t.pnlPct))),
      avgLossPct: r2(avg(losses.map((t) => t.pnlPct))),
      profitFactor: r2(
        wins.reduce((s, t) => s + t.pnlPct, 0) /
          Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0)),
      ),
    },
    byExit,
    byMonth,
    byRegime,
    entrySnapshots: { winners: snapStats(wins), losers: snapStats(losses) },
    resims: {
      stopCap3pct: {
        note: "risk per trade hard-capped at 3% (stop tightened where AI's 2x-ATR stop was wider); target/time rules unchanged",
        trades: capped.length,
        wins: cappedWins,
        totalPnlPct: r2(cappedTotal),
        originalWinnersFlippedToLoss: flippedWinners,
      },
      bullRegimeOnly: {
        note: "entries skipped when NIFTY close < its 20-day EMA on entry day",
        trades: bullOnly.length,
        wins: bullOnlyWins,
        totalPnlPct: r2(bullOnlyTotal),
      },
      combined: {
        trades: comboBase.length,
        wins: comboWins,
        totalPnlPct: r2(comboTotal),
      },
    },
    trades: trades.map((t) => ({
      symbol: t.symbol, entryDate: t.entryDate, entryPrice: t.entryPrice,
      exitDate: t.exitDate, exitPrice: t.exitPrice, exitReason: t.exitReason,
      pnlPct: t.pnlPct, month: t.month, regime: t.regime, snap: t.snap,
    })),
  };

  fs.writeFileSync(`${DATA_DIR}/analysis-backtest.json`, JSON.stringify(analysis, null, 1));
  console.log(`\nWrote ${DATA_DIR}/analysis-backtest.json\n`);
  const { trades: _t, ...printable } = analysis;
  console.log(JSON.stringify(printable, null, 2));

  await mongoose.connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
