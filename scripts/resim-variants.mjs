// Re-simulates candidate rule changes against the saved backtest data
// (data/analysis-backtest.json + data/candles-daily-*.json) — no AI calls,
// free to run. Variants under test:
//   A1: cap target at the known resistance level from entry day
//   A2: A1 + skip the trade entirely if the capped target is <1% above entry
//       (the app's own transaction-cost rule)
//   B14/B21: cooldown — skip re-entry within N days after a stop-loss exit
//       on the same symbol
//   C: A1 + B14 combined
//
// Honest limitation: skipping a trade can't model what the bot would have
// done *instead* on those days (it might have entered something else later
// that never appears in our log). Treat skip-variants as directional
// evidence, not exact P&L.
//
// Usage: node scripts/resim-variants.mjs

import fs from "fs";

const DATA = "data";
const analysis = JSON.parse(fs.readFileSync(`${DATA}/analysis-backtest.json`, "utf8"));
const trades = analysis.trades;

const candles = {};
for (const t of trades) {
  if (!candles[t.symbol]) {
    candles[t.symbol] = JSON.parse(
      fs.readFileSync(`${DATA}/candles-daily-${t.symbol}.json`, "utf8"),
    );
  }
}

// Mirrors the backtest's exit semantics exactly: SL checked before target on
// the same day, exits evaluated only on days after entry, time exit at close
// once >10 calendar days have passed.
function resim(t, sl, target) {
  const cs = candles[t.symbol];
  const idx = cs.findIndex((c) => c.date === t.entryDate);
  if (idx < 0) return null;
  const entryMs = new Date(t.entryDate).getTime();
  for (let i = idx + 1; i < cs.length; i++) {
    const d = cs[i];
    if (d.low <= sl)
      return { exit: "STOP_LOSS", pnlPct: ((sl - t.entryPrice) / t.entryPrice) * 100, date: d.date };
    if (d.high >= target)
      return { exit: "TARGET", pnlPct: ((target - t.entryPrice) / t.entryPrice) * 100, date: d.date };
    if ((new Date(d.date).getTime() - entryMs) / 864e5 > 10)
      return { exit: "TIME_EXIT", pnlPct: ((d.close - t.entryPrice) / t.entryPrice) * 100, date: d.date };
  }
  const last = cs.at(-1);
  return { exit: "OPEN", pnlPct: ((last.close - t.entryPrice) / t.entryPrice) * 100, date: last.date };
}

function cappedTarget(t) {
  const { target, resistance } = t.snap;
  if (resistance != null && resistance > t.entryPrice && target > resistance) return resistance;
  return target;
}

const r1 = (n) => Math.round(n * 100) / 100;

function stats(results) {
  const wins = results.filter((r) => r.pnlPct > 0);
  const losses = results.filter((r) => r.pnlPct <= 0);
  const grossWin = wins.reduce((s, r) => s + r.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.pnlPct, 0));
  return {
    trades: results.length,
    wins: wins.length,
    winRatePct: results.length ? r1((wins.length / results.length) * 100) : null,
    totalPnlPct: r1(results.reduce((s, r) => s + r.pnlPct, 0)),
    avgWinPct: wins.length ? r1(grossWin / wins.length) : null,
    avgLossPct: losses.length ? r1(-grossLoss / losses.length) : null,
    profitFactor: grossLoss ? r1(grossWin / grossLoss) : null,
    targetHits: results.filter((r) => r.exit === "TARGET").length,
    stopOuts: results.filter((r) => r.exit === "STOP_LOSS").length,
    timeExits: results.filter((r) => r.exit === "TIME_EXIT").length,
  };
}

// Sanity check — re-sim with original params must reproduce the original book
const baseline = trades.map((t) => resim(t, t.snap.stopLoss, t.snap.target)).filter(Boolean);

// A1: cap target at resistance
const a1 = trades
  .map((t) => ({ t, capped: cappedTarget(t) !== t.snap.target, r: resim(t, t.snap.stopLoss, cappedTarget(t)) }))
  .filter((x) => x.r);

// A2: A1 + skip if capped target gives <1% headroom (cost rule)
const a2Kept = [];
const a2Skipped = [];
for (const x of a1) {
  const tgt = cappedTarget(x.t);
  const headroom = ((tgt - x.t.entryPrice) / x.t.entryPrice) * 100;
  if (headroom < 1) a2Skipped.push({ symbol: x.t.symbol, entryDate: x.t.entryDate, originalPnl: x.t.pnlPct });
  else a2Kept.push(x.r);
}

// B: cooldown after stop-loss (original targets/stops, original outcomes)
function cooldown(days, useCappedTargets = false) {
  const bySym = {};
  for (const t of trades) (bySym[t.symbol] ??= []).push(t);
  const kept = [];
  const skipped = [];
  for (const sym of Object.keys(bySym)) {
    const seq = bySym[sym].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    let lastSLExitDate = null;
    for (const t of seq) {
      if (
        lastSLExitDate &&
        (new Date(t.entryDate) - new Date(lastSLExitDate)) / 864e5 <= days
      ) {
        skipped.push({ symbol: t.symbol, entryDate: t.entryDate, originalPnl: t.pnlPct });
        continue;
      }
      const r = useCappedTargets
        ? resim(t, t.snap.stopLoss, cappedTarget(t))
        : { exit: t.exitReason, pnlPct: t.pnlPct, date: t.exitDate };
      if (!r) continue;
      kept.push(r);
      lastSLExitDate = r.exit === "STOP_LOSS" ? r.date : null;
    }
  }
  return { kept, skipped };
}

const b14 = cooldown(14);
const b21 = cooldown(21);
const combo = cooldown(14, true);

const out = {
  generatedAt: new Date().toISOString(),
  baselineSanityCheck: stats(baseline),
  original: analysis.totals,
  variants: {
    A1_targetCappedAtResistance: {
      ...stats(a1.map((x) => x.r)),
      tradesWithCapApplied: a1.filter((x) => x.capped).length,
    },
    A2_capPlusSkipUnder1pct: {
      ...stats(a2Kept),
      skipped: a2Skipped,
    },
    B14_cooldown14dAfterSL: {
      ...stats(b14.kept),
      skipped: b14.skipped,
    },
    B21_cooldown21dAfterSL: {
      ...stats(b21.kept),
      skipped: b21.skipped,
    },
    C_capPlusCooldown14: stats(combo.kept),
  },
};

fs.writeFileSync(`${DATA}/resim-variants.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 2));
