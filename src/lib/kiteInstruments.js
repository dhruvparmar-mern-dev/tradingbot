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
