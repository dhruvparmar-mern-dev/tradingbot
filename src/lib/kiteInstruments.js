import kite from "./kite";

let cachedInstruments = null;
let cacheTime = null;

export async function getNSEInstruments() {
  if (!cachedInstruments || !cacheTime || Date.now() - cacheTime > 3600000) {
    cachedInstruments = await kite.getInstruments("NSE");
    cacheTime = Date.now();
  }
  return cachedInstruments;
}
