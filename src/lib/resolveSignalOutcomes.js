import kite from "@/lib/kite";
import KiteSession from "@/models/KiteSession";
import Portfolio from "@/models/Portfolio";
import { getNSEInstruments } from "@/lib/kiteInstruments";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Cap Kite calls per /api/memory GET so a batch of stocks all becoming
// resolvable at once (e.g. right after this feature ships) can't fire a burst
// of concurrent historical-data requests -- the rest just resolve on the next
// GET a few seconds later.
const MAX_RESOLVE_PER_CALL = 3;

function istCalendarDate(d) {
  return new Date(new Date(d).getTime() + IST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

// UTC instant corresponding to 15:15 IST (market close) on the same calendar
// day as `d`.
function eodCutoff(d) {
  const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const day = ist.getUTCDate();
  return new Date(Date.UTC(y, m, day, 15, 15, 0) - IST_OFFSET_MS);
}

function isResolvable(entryDate, mode) {
  if (mode === "intraday") {
    // A full trading day has to have actually finished -- only true once the
    // IST calendar date has rolled past the entry's date.
    return istCalendarDate(entryDate) < istCalendarDate(Date.now());
  }
  const daysPassed = (Date.now() - new Date(entryDate).getTime()) / 86400000;
  return daysPassed >= 3;
}

// Checks the AI's own past signals against what actually happened in real
// Kite candle data -- not the AI's self-reported narrative. Signals that were
// never turned into a real trade (HOLDs, or BUY/SELLs that auto-trade skipped)
// stay "PENDING" forever otherwise, so the model has no ground truth to
// correct a wrong past call the next time it looks at this stock.
export async function resolvePendingOutcomes(symbol, mode, signalHistory) {
  if (!signalHistory?.length) return { history: signalHistory, changed: false };

  const resolvable = signalHistory.filter(
    (s) => s.outcome === "PENDING" && isResolvable(s.date, mode),
  );
  if (!resolvable.length) return { history: signalHistory, changed: false };

  // A real (still-open) paper position needs its PENDING entry left alone --
  // /api/outcome finds the trade's outcome by looking for "the last PENDING
  // entry" when the position closes. Resolving it out from under that lookup
  // would make the real trade's WIN/LOSS never get recorded.
  const openPosition = await Portfolio.findOne({ symbol, mode });
  if (openPosition) return { history: signalHistory, changed: false };

  const session = await KiteSession.findOne({ userId: "default" });
  if (!session?.accessToken) return { history: signalHistory, changed: false };
  kite.setAccessToken(session.accessToken);

  const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");
  let instrument;
  try {
    const instruments = await getNSEInstruments();
    instrument = instruments.find((i) => i.tradingsymbol === cleanSymbol);
  } catch (err) {
    console.error(`resolvePendingOutcomes: instrument lookup failed for ${symbol}:`, err.message);
    return { history: signalHistory, changed: false };
  }
  if (!instrument) return { history: signalHistory, changed: false };

  const toResolve = resolvable
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, MAX_RESOLVE_PER_CALL);

  const history = [...signalHistory];
  let changed = false;

  for (const entry of toResolve) {
    const idx = history.indexOf(entry);
    try {
      let candles;
      if (mode === "intraday") {
        candles = await kite.getHistoricalData(
          instrument.instrument_token,
          "5minute",
          new Date(entry.date),
          eodCutoff(entry.date),
        );
      } else {
        const from = new Date(entry.date);
        const to = new Date(Math.min(Date.now(), from.getTime() + 5 * 86400000));
        candles = await kite.getHistoricalData(
          instrument.instrument_token,
          "day",
          from,
          to,
        );
      }
      if (!candles?.length) continue;

      const exitCandle =
        mode === "intraday" ? candles.at(-1) : candles[Math.min(4, candles.length - 1)];
      const exitPrice = exitCandle.close;
      const realOutcomePct = Number(
        (((exitPrice - entry.price) / entry.price) * 100).toFixed(2),
      );

      history[idx] = {
        ...entry,
        outcome: "VERIFIED",
        realOutcomePct,
        exitPrice,
        exitDate: new Date(exitCandle.date),
      };
      changed = true;
    } catch (err) {
      console.error(`resolvePendingOutcomes: candle fetch failed for ${symbol} @ ${entry.date}:`, err.message);
    }
  }

  return { history, changed };
}
