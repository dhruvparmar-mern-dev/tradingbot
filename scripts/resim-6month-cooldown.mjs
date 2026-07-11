// Combines the Apr-Jul AI backtest (data/analysis-backtest.json, 36 trades,
// all 10 symbols) with the Jan-Mar out-of-sample AI backtest (root-level
// backtest-<SYM>-2026-01-01-to-2026-03-31.json, 8 symbols — IRCTC/LODHA
// excluded since their runs got zero calls before the daily budget cut them
// off) into one continuous 6-month-per-symbol trade sequence, then re-tests
// the cooldown-after-stop-loss rule across the FULL timeline instead of two
// separate 3-month halves. This catches cooldown triggers that cross the
// Mar 31 / Apr 1 boundary, which the earlier quarter-by-quarter analysis
// could not see.
//
// No AI calls — pure local re-aggregation + simulation. Free to re-run.
// Usage: node scripts/resim-6month-cooldown.mjs

import fs from "fs";

const JAN_MAR_SYMBOLS = [
  "RELIANCE", "HDFCBANK", "ICICIBANK", "BHARTIARTL", "BAJFINANCE",
  "TECHM", "SBIN", "PAYTM",
]; // IRCTC, LODHA excluded — zero real calls in their Jan-Mar run

const analysis = JSON.parse(fs.readFileSync("data/analysis-backtest.json", "utf8"));

// Normalize Apr-Jul trades (already have entryDate/exitDate/exitReason/pnlPct)
const aprJul = analysis.trades.map((t) => ({
  symbol: t.symbol,
  entryDate: t.entryDate,
  exitDate: t.exitDate,
  exitReason: t.exitReason,
  pnlPct: t.pnlPct,
  period: "Apr-Jul",
}));

// Load Jan-Mar trades from the root-level per-symbol files
const janMar = [];
for (const sym of JAN_MAR_SYMBOLS) {
  const path = `backtest-${sym}-2026-01-01-to-2026-03-31.json`;
  if (!fs.existsSync(path)) continue;
  const f = JSON.parse(fs.readFileSync(path, "utf8"));
  for (const t of f.trades) {
    janMar.push({
      symbol: sym,
      entryDate: t.entryDate,
      exitDate: t.exitDate,
      exitReason: t.exitReason,
      pnlPct: t.pnlPct,
      period: "Jan-Mar",
    });
  }
}

const allTrades = [...janMar, ...aprJul];

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
    avgWinPct: wins.length ? r1(grossWin / wins.length) : null,
    avgLossPct: losses.length ? r1(-grossLoss / losses.length) : null,
    profitFactor: grossLoss ? r1(grossWin / grossLoss) : null,
  };
}

function cooldown(days) {
  const bySym = {};
  for (const t of allTrades) (bySym[t.symbol] ??= []).push(t);
  const kept = [];
  const skipped = [];
  const crossBoundary = [];
  for (const sym of Object.keys(bySym)) {
    const seq = bySym[sym].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    let lastSLExitDate = null;
    let lastSLPeriod = null;
    for (const t of seq) {
      if (lastSLExitDate && (new Date(t.entryDate) - new Date(lastSLExitDate)) / 864e5 <= days) {
        skipped.push({ symbol: t.symbol, entryDate: t.entryDate, originalPnl: t.pnlPct, period: t.period });
        if (lastSLPeriod !== t.period) crossBoundary.push({ symbol: t.symbol, slExit: lastSLExitDate, skippedEntry: t.entryDate });
        continue; // matches resim-variants.mjs: a skipped trade never happened, so it can't reset the cooldown clock
      }
      kept.push(t);
      lastSLExitDate = t.exitReason === "STOP_LOSS" ? t.exitDate : null;
      lastSLPeriod = t.period;
    }
  }
  return { kept, skipped, crossBoundary };
}

const baseline = stats(allTrades);
const b14 = cooldown(14);
const b21 = cooldown(21);

const out = {
  generatedAt: new Date().toISOString(),
  tradeCountBySource: { janMar: janMar.length, aprJul: aprJul.length, combined: allTrades.length },
  baseline_fullSixMonths: baseline,
  cooldown14d_fullSixMonths: { ...stats(b14.kept), skipped: b14.skipped, crossBoundarySkips: b14.crossBoundary },
  cooldown21d_fullSixMonths: { ...stats(b21.kept), skipped: b21.skipped, crossBoundarySkips: b21.crossBoundary },
};

fs.writeFileSync("data/resim-6month-cooldown.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
