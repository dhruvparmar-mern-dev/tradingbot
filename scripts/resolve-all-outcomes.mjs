// One-off manual run of the same logic as src/lib/resolveSignalOutcomes.js,
// but across the whole watchlist in one go (no per-call cap) and writing
// results straight to the DB. Useful to run once at day-end so tomorrow's
// first analysis for every stock already has verified outcomes ready,
// instead of waiting for the lazy per-request resolution to trickle through
// one stock at a time.
import "dotenv/config";
import mongoose from "mongoose";
import { KiteConnect } from "kiteconnect";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MODES = ["intraday", "swing"];

function istCalendarDate(d) {
  return new Date(new Date(d).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
function eodCutoff(d) {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear(), m = ist.getUTCMonth(), day = ist.getUTCDate();
  return new Date(Date.UTC(y, m, day, 15, 15, 0) - IST_OFFSET_MS);
}
function isResolvable(entryDate, mode) {
  if (mode === "intraday") return istCalendarDate(entryDate) < istCalendarDate(Date.now());
  return (Date.now() - new Date(entryDate).getTime()) / 86400000 >= 3;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const session = await db.collection("kitesessions").findOne({ userId: "default" });
  if (!session?.accessToken) {
    console.error("No Kite session -- can't fetch real candles.");
    process.exit(1);
  }
  const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
  kite.setAccessToken(session.accessToken);
  const instruments = await kite.getInstruments("NSE");

  const watchlist = await db
    .collection("stocks")
    .find({ inWatchlist: { $ne: false } }, { projection: { symbol: 1 } })
    .toArray();

  let totalResolved = 0;
  let totalSkippedOpenPosition = 0;

  for (const w of watchlist) {
    const symbol = w.symbol;
    const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");
    const instrument = instruments.find((i) => i.tradingsymbol === cleanSymbol);
    if (!instrument) continue;

    for (const mode of MODES) {
      const field = `memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`;
      const stock = await db.collection("stocks").findOne({ symbol }, { projection: { [field]: 1 } });
      const history = stock?.[field]?.signalHistory;
      if (!history?.length) continue;

      const resolvable = history.filter((s) => s.outcome === "PENDING" && isResolvable(s.date, mode));
      if (!resolvable.length) continue;

      const openPosition = await db.collection("portfolios").findOne({ symbol, mode });
      if (openPosition) {
        totalSkippedOpenPosition++;
        console.log(`SKIP ${symbol} ${mode} -- open real position, leaving PENDING for /api/outcome`);
        continue;
      }

      const updated = [...history];
      let changed = false;

      for (const entry of resolvable) {
        const idx = updated.indexOf(entry);
        try {
          let candles;
          if (mode === "intraday") {
            const from = new Date(entry.date);
            const to = new Date(Math.max(eodCutoff(entry.date).getTime(), from.getTime()));
            candles = await kite.getHistoricalData(instrument.instrument_token, "5minute", from, to);
          } else {
            const from = new Date(entry.date);
            const to = new Date(Math.min(Date.now(), from.getTime() + 5 * 86400000));
            candles = await kite.getHistoricalData(instrument.instrument_token, "day", from, to);
          }

          const exitCandle = candles?.length
            ? mode === "intraday" ? candles.at(-1) : candles[Math.min(4, candles.length - 1)]
            : { close: entry.price, date: entry.date };
          const realOutcomePct = Number((((exitCandle.close - entry.price) / entry.price) * 100).toFixed(2));

          updated[idx] = { ...entry, outcome: "VERIFIED", realOutcomePct, exitPrice: exitCandle.close, exitDate: new Date(exitCandle.date) };
          changed = true;
          totalResolved++;
          console.log(`  ${symbol} ${mode}: ${entry.signal}@₹${entry.price} → VERIFIED, ${realOutcomePct >= 0 ? "+" : ""}${realOutcomePct}% actual move`);
        } catch (err) {
          console.error(`  ${symbol} ${mode}: candle fetch failed for ${entry.date}:`, err.message);
        }
      }

      if (changed) {
        await db.collection("stocks").updateOne({ symbol }, { $set: { [`${field}.signalHistory`]: updated } });
      }
    }
  }

  console.log(`\nDone. Resolved ${totalResolved} signals. Skipped ${totalSkippedOpenPosition} symbol/mode pairs with an open position.`);
  await mongoose.connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
