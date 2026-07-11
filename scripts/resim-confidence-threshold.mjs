// Re-simulates the Apr-Jul swing backtest at LOWER confidence thresholds
// (5 and 6, tested separately) using the full audit log of every AI call
// already made (data/audit-swing-backtest.json, 489 records) — not just the
// 36 that crossed the original MIN_CONFIDENCE=7 bar. No new AI calls.
//
// Method: each audit record's prompt embeds that day's price ("Current
// Price: ₹X" or "Price: ₹X"); match it against data/candles-daily-<SYM>.json
// to recover the actual simulated date, then replay chronologically per
// symbol: enter on the first day (signal, confidence >= threshold), hold
// using the real daily candles for exit (SL/target/10-day time-exit, same
// rule as scripts/backtest.mjs), then resume scanning audit records after
// the exit date.
//
// Honest limitation: the audit log only has a record for days the ORIGINAL
// (conf>=7) run was flat and called AI. A looser threshold enters earlier in
// some cases, and if the day it needs to resume scanning on on falls inside
// a stretch where the original run was holding a different position, there
// is no recorded AI call for it — that day is silently skipped (reported as
// a "gap day" count per symbol, not invented).
//
// Usage: node scripts/resim-confidence-threshold.mjs

import fs from "fs";

const SYMBOLS = [
  "RELIANCE", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "BAJFINANCE",
  "TECHM", "SBIN", "PAYTM", "IRCTC", "LODHA",
];

const audit = JSON.parse(fs.readFileSync("data/audit-swing-backtest.json", "utf8"));
const candlesBySymbol = {};
for (const sym of SYMBOLS) {
  candlesBySymbol[sym] = JSON.parse(fs.readFileSync(`data/candles-daily-${sym}.json`, "utf8"));
}

// --- reconstruct (symbol, date) for every audit record via price matching ---
const recordsBySymbol = {};
let unmatched = 0;
for (const r of audit) {
  const sym = r.symbol.replace(/\.NS$/, "");
  if (!candlesBySymbol[sym]) continue;
  const m = r.prompt.match(/(?:Current Price|Price): ₹([\d.]+)/);
  if (!m) { unmatched++; continue; }
  const price = parseFloat(m[1]);
  (recordsBySymbol[sym] ??= []).push({ price, r });
}

const reconstructed = {};
for (const sym of SYMBOLS) {
  const candles = candlesBySymbol[sym];
  const used = new Set();
  const entries = [];
  // Sort audit records for this symbol by their position in the original
  // file (chronological, since the backtest ran days in order) so ties on
  // repeated prices resolve to the earliest unused candle day.
  for (const { price } of recordsBySymbol[sym] || []) {
    const idx = candles.findIndex((c, i) => !used.has(i) && Math.abs(c.close - price) < 0.005);
    if (idx === -1) continue;
    used.add(idx);
  }
  // Redo properly keeping the record attached (above was just a dry pass);
  const used2 = new Set();
  for (const { price, r } of recordsBySymbol[sym] || []) {
    const idx = candles.findIndex((c, i) => !used2.has(i) && Math.abs(c.close - price) < 0.005);
    if (idx === -1) { unmatched++; continue; }
    used2.add(idx);
    entries.push({
      date: candles[idx].date,
      confidence: r.parsedResponse?.confidence,
      signal: r.parsedResponse?.signal,
      stopLoss: r.parsedResponse?.stopLoss,
      target: r.parsedResponse?.target,
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  reconstructed[sym] = entries;
}

function simulateSymbol(sym, threshold) {
  const records = reconstructed[sym];
  const candles = candlesBySymbol[sym];
  const trades = [];
  let gapDays = 0;
  let i = 0;
  while (i < records.length) {
    const rec = records[i];
    if (rec.signal === "BUY" && rec.confidence >= threshold && rec.stopLoss > 0 && rec.target > rec.stopLoss) {
      const entryIdx = candles.findIndex((c) => c.date === rec.date);
      const entryPrice = candles[entryIdx].close;
      const entryDate = rec.date;
      let exitPrice = null, exitReason = null, exitDate = null;
      for (let j = entryIdx + 1; j < candles.length; j++) {
        const d = candles[j];
        if (d.low <= rec.stopLoss) { exitPrice = rec.stopLoss; exitReason = "STOP_LOSS"; exitDate = d.date; break; }
        if (d.high >= rec.target) { exitPrice = rec.target; exitReason = "TARGET"; exitDate = d.date; break; }
        if ((new Date(d.date) - new Date(entryDate)) / 864e5 > 10) { exitPrice = d.close; exitReason = "TIME_EXIT"; exitDate = d.date; break; }
      }
      if (exitPrice == null) { const last = candles.at(-1); exitPrice = last.close; exitReason = "OPEN"; exitDate = last.date; }
      trades.push({ symbol: sym, entryDate, entryPrice, exitDate, exitReason, pnlPct: Math.round(((exitPrice - entryPrice) / entryPrice) * 10000) / 100 });
      // resume scanning audit records strictly after exitDate
      i = records.findIndex((r2, k) => k > i && r2.date > exitDate);
      if (i === -1) break;
      continue;
    }
    i++;
  }
  return { trades, gapDays };
}

const r1 = (n) => Math.round(n * 100) / 100;
function stats(trades) {
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  return {
    trades: trades.length,
    wins: wins.length,
    winRatePct: trades.length ? r1((wins.length / trades.length) * 100) : null,
    totalPnlPct: r1(trades.reduce((s, t) => s + t.pnlPct, 0)),
    profitFactor: grossLoss ? r1(grossWin / grossLoss) : null,
  };
}

function runThreshold(threshold) {
  const allTrades = [];
  const perSymbol = {};
  for (const sym of SYMBOLS) {
    const { trades } = simulateSymbol(sym, threshold);
    perSymbol[sym] = trades;
    allTrades.push(...trades);
  }
  const months = ["2026-04", "2026-05", "2026-06", "2026-07"];
  const monthly = {};
  for (const m of months) monthly[m] = stats(allTrades.filter((t) => t.exitDate.slice(0, 7) === m));
  return {
    overall: stats(allTrades),
    monthly,
    perSymbol: Object.fromEntries(Object.entries(perSymbol).map(([k, v]) => [k, stats(v)])),
    allTrades,
  };
}

const totalRecordsMatched = Object.values(reconstructed).reduce((s, a) => s + a.length, 0);

const out = {
  generatedAt: new Date().toISOString(),
  coverage: { totalAuditRecords: audit.length, matched: totalRecordsMatched, unmatched: audit.length - totalRecordsMatched },
  confidence6: runThreshold(6),
  confidence5: runThreshold(5),
  originalConfidence7Baseline: "36 trades, 55.6% win rate, +26.94% (from data/analysis-backtest.json)",
};

fs.writeFileSync("data/resim-confidence-threshold.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ coverage: out.coverage, confidence6: { overall: out.confidence6.overall, monthly: out.confidence6.monthly, perSymbol: out.confidence6.perSymbol }, confidence5: { overall: out.confidence5.overall, monthly: out.confidence5.monthly, perSymbol: out.confidence5.perSymbol } }, null, 2));
