// Pure IST time-math, zero dependencies — safe to import from both client
// components and server-side API routes (unlike attemptAutoBuy.js, which
// pulls in the Zustand store and toast).
const MARKET_OPEN_MIN = 9 * 60 + 15; // 9:15 AM IST
const MARKET_CLOSE_MIN = 15 * 60 + 15; // 3:15 PM IST

export function isMarketOpenNow() {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + istOffset);
  const timeInMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return timeInMinutes >= MARKET_OPEN_MIN && timeInMinutes <= MARKET_CLOSE_MIN;
}

// Deliberately NOT the same as isMarketOpenNow(): that's false all night,
// which would also block legitimate after-hours viewing of today's real
// closing data. This is only false in the 00:00-09:15 IST dead zone, where
// the calendar date has already rolled over but today hasn't traded yet --
// a scan run then would log yesterday's stale last-traded price under
// today's date (real incident: a manual scan at 12:12 AM logged 15 bogus
// "today" entries before the market had opened).
export function hasMarketOpenedToday() {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + istOffset);
  const timeInMinutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return timeInMinutes >= MARKET_OPEN_MIN;
}
