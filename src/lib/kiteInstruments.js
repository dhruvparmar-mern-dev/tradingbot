import kite from "./kite";

let cachedInstruments = null;
let cacheTime = null;
let inFlightFetch = null;

// Watchlist pages fire ~30 concurrent requests that each need this list
// (see AppShell.jsx / useKiteWebSocket.js). Without a single-flight lock,
// every one of those requests sees a cold cache at the same instant and
// independently calls kite.getInstruments("NSE") — ~30 simultaneous
// multi-thousand-row fetches, which was causing intermittent failures /
// incomplete results (surfaced as sporadic 404s for specific symbols).
export async function getNSEInstruments() {
  if (cachedInstruments && cacheTime && Date.now() - cacheTime <= 3600000) {
    return cachedInstruments;
  }
  if (!inFlightFetch) {
    inFlightFetch = kite
      .getInstruments("NSE")
      .then((data) => {
        cachedInstruments = data;
        cacheTime = Date.now();
        return data;
      })
      .finally(() => {
        inFlightFetch = null;
      });
  }
  return inFlightFetch;
}

// Kite's instrument master tags these as instrument_type "EQ" same as real
// stocks, so that filter alone doesn't exclude them -- caught live when a
// market-wide scan surfaced "77GJ40-SG" (a state government bond, +314%) and
// several "*INAV" tickers (ETF indicative-NAV feeds, e.g. "ECAPININAV" at
// -99%) as if they were real equity movers. Both are non-tradeable reference
// feeds/bonds with degenerate price history, not stocks.
export function isRealEquity(instrument) {
  const symbol = instrument.tradingsymbol;
  if (symbol.endsWith("INAV")) return false; // ETF indicative NAV feed
  if (symbol.endsWith("-SG")) return false; // state government bond (SDL)
  return true;
}
