// Dry-run of the resolveSignalOutcomes.js logic against real Kite data, without
// going through the authenticated Next.js route or writing anything back to
// the DB. Just prints what the resolver WOULD compute, to sanity-check the
// logic before trusting it in production.
import "dotenv/config";
import mongoose from "mongoose";
import { KiteConnect } from "kiteconnect";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SYMBOL = process.argv[2] || "JUSTDIAL.NS";
const MODE = process.argv[3] || "intraday";

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
  const field = `memory${MODE.charAt(0).toUpperCase() + MODE.slice(1)}`;

  const stock = await db.collection("stocks").findOne({ symbol: SYMBOL });
  const history = stock?.[field]?.signalHistory || [];
  const openPosition = await db.collection("portfolios").findOne({ symbol: SYMBOL, mode: MODE });

  console.log(`${SYMBOL} ${MODE} — ${history.length} signalHistory entries, open position: ${!!openPosition}`);

  const resolvable = history.filter((s) => s.outcome === "PENDING" && isResolvable(s.date, MODE));
  console.log(`Resolvable (old enough, still PENDING): ${resolvable.length}`);
  if (!resolvable.length || openPosition) {
    await mongoose.connection.close();
    return;
  }

  const session = await db.collection("kitesessions").findOne({ userId: "default" });
  const kite = new KiteConnect({ api_key: process.env.KITE_API_KEY });
  kite.setAccessToken(session.accessToken);
  const instruments = await kite.getInstruments("NSE");
  const cleanSymbol = SYMBOL.replace(".NS", "").replace(".BO", "");
  const instrument = instruments.find((i) => i.tradingsymbol === cleanSymbol);

  for (const entry of resolvable) {
    let candles;
    if (MODE === "intraday") {
      candles = await kite.getHistoricalData(instrument.instrument_token, "5minute", new Date(entry.date), eodCutoff(entry.date));
    } else {
      const from = new Date(entry.date);
      const to = new Date(Math.min(Date.now(), from.getTime() + 5 * 86400000));
      candles = await kite.getHistoricalData(instrument.instrument_token, "day", from, to);
    }
    if (!candles?.length) {
      console.log(`  ${entry.signal}@₹${entry.price} (${entry.date}) → no candles found`);
      continue;
    }
    const exitCandle = MODE === "intraday" ? candles.at(-1) : candles[Math.min(4, candles.length - 1)];
    const pct = (((exitCandle.close - entry.price) / entry.price) * 100).toFixed(2);
    console.log(`  ${entry.signal}@₹${entry.price} (${entry.date}) → VERIFIED, exit ₹${exitCandle.close} @ ${exitCandle.date}, ${pct}% actual move`);
  }

  await mongoose.connection.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
