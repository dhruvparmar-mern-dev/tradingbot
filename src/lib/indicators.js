export function calculateRSI(closes, period = 14) {
  const validCloses = closes.filter(Boolean);
  if (validCloses.length < period + 1) return null;

  let gains = 0,
    losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = validCloses[i] - validCloses[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < validCloses.length; i++) {
    const diff = validCloses[i] - validCloses[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss =
      (avgLoss * (period - 1) + (diff < 0 ? Math.abs(diff) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function calculateEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}

// Full EMA series aligned to `values` indices (null before the EMA is
// computable), so multiple EMAs can be lined up and subtracted point-by-point.
function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;

  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = ema;
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// Real MACD: signal line is a 9-period EMA of the MACD line itself over
// time, not a blend of the last two MACD values.
export function calculateMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const validCloses = closes.filter(Boolean);
  if (validCloses.length < slow + signalPeriod)
    return { macdLine: null, signalLine: null, histogram: null };

  const emaFast = emaSeries(validCloses, fast);
  const emaSlow = emaSeries(validCloses, slow);

  const macdSeries = validCloses
    .map((_, i) =>
      emaFast[i] != null && emaSlow[i] != null ? emaFast[i] - emaSlow[i] : null,
    )
    .filter((v) => v !== null);

  if (macdSeries.length < signalPeriod)
    return { macdLine: macdSeries.at(-1) ?? null, signalLine: null, histogram: null };

  const signalSeries = emaSeries(macdSeries, signalPeriod);
  const macdLine = macdSeries.at(-1);
  const signalLine = signalSeries.at(-1);

  return { macdLine, signalLine, histogram: macdLine - signalLine };
}

// Average True Range (Wilder's smoothing) — a volatility measure in price
// units, so stop-loss/target can scale to how much a stock actually moves
// instead of using the same fixed % for a stable large-cap and a jumpy one.
export function calculateATR(highs, lows, closes, period = 14) {
  const trueRanges = [];
  for (let i = 1; i < closes.length; i++) {
    trueRanges.push(
      Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ),
    );
  }
  if (trueRanges.length < period) return null;

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

// Volume-weighted average price. Only meaningful over a single session's
// candles — the caller is responsible for passing just today's intraday
// candles (there's no "date" concept in this generic indicator lib).
export function calculateVWAP(highs, lows, closes, volumes) {
  let cumulativePV = 0;
  let cumulativeVolume = 0;
  for (let i = 0; i < closes.length; i++) {
    if (!volumes[i]) continue;
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    cumulativePV += typicalPrice * volumes[i];
    cumulativeVolume += volumes[i];
  }
  return cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : null;
}

// Swing-point support/resistance: a swing high/low is a candle whose
// high/low is the most extreme among `strength` candles on either side —
// i.e. an actual price reversal, not just the single most extreme print in
// the window. Picks the nearest confirmed swing level above/below the
// current price, which is what a stop-loss/target should actually reference.
// Falls back to a flat lookback min/max when there isn't enough data to
// confirm any swing points (e.g. a recently-listed stock).
function findSwingLevels(highs, lows, currentPrice, lookback = 40, strength = 2) {
  const start = Math.max(0, highs.length - lookback);
  const swingHighs = [];
  const swingLows = [];

  for (let i = start + strength; i < highs.length - strength; i++) {
    const highWindow = highs.slice(i - strength, i + strength + 1);
    const lowWindow = lows.slice(i - strength, i + strength + 1);
    if (highs[i] === Math.max(...highWindow)) swingHighs.push(highs[i]);
    if (lows[i] === Math.min(...lowWindow)) swingLows.push(lows[i]);
  }

  const resistanceCandidates = swingHighs.filter((h) => h >= currentPrice);
  const supportCandidates = swingLows.filter((l) => l <= currentPrice);

  const resistance = resistanceCandidates.length
    ? Math.min(...resistanceCandidates)
    : swingHighs.length
      ? Math.max(...swingHighs)
      : null;
  const support = supportCandidates.length
    ? Math.max(...supportCandidates)
    : swingLows.length
      ? Math.min(...swingLows)
      : null;

  return { support, resistance };
}

// Shared by both /api/chart (Yahoo) and /api/kite/historical (Kite) so
// technical indicators are computed the same way regardless of data source.
export function computeIndicators({ closes, highs, lows, volumes }) {
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const atr = calculateATR(highs, lows, closes, 14);

  // Trend: price vs its own 20-period EMA, not a first-vs-last comparison —
  // the old method could call a stock "UPTREND" even if it went up, reversed,
  // and went flat, as long as the endpoint was above the start.
  const validClosesForTrend = closes.filter(Boolean);
  const ema20Series = emaSeries(validClosesForTrend, 20);
  const currentEma20 = ema20Series.at(-1);
  const currentPriceForTrend = validClosesForTrend.at(-1);
  const hasEmaTrend = currentEma20 != null && currentPriceForTrend != null;

  const trend = hasEmaTrend
    ? currentPriceForTrend > currentEma20
      ? "UPTREND"
      : "DOWNTREND"
    : validClosesForTrend.length > 1 &&
        validClosesForTrend.at(-1) > validClosesForTrend[0]
      ? "UPTREND"
      : "DOWNTREND";
  const trendStrength = hasEmaTrend
    ? (((currentPriceForTrend - currentEma20) / currentEma20) * 100).toFixed(2)
    : "0.00";

  const validHighs = highs.filter(Boolean);
  const validLows = lows.filter(Boolean);
  const currentPrice = closes.filter(Boolean).at(-1);
  const swingLevels =
    validHighs.length === highs.length && validLows.length === lows.length
      ? findSwingLevels(highs, lows, currentPrice)
      : { support: null, resistance: null };

  const last20Highs = highs.slice(-20).filter(Boolean);
  const last20Lows = lows.slice(-20).filter(Boolean);
  const resistanceValue =
    swingLevels.resistance ??
    (last20Highs.length ? Math.max(...last20Highs) : null);
  const supportValue =
    swingLevels.support ??
    (last20Lows.length ? Math.min(...last20Lows) : null);
  const resistance = resistanceValue != null ? resistanceValue.toFixed(2) : null;
  const support = supportValue != null ? supportValue.toFixed(2) : null;

  const validVolumes = volumes.slice(-20).filter(Boolean);
  const avgVolume = validVolumes.length
    ? validVolumes.reduce((a, b) => a + b, 0) / validVolumes.length
    : 0;
  const todayVolume = volumes[volumes.length - 1] || 0;
  const volumeRatio = avgVolume ? (todayVolume / avgVolume).toFixed(2) : "0.00";
  let volumeSignal = "NORMAL";
  if (volumeRatio > 1.5) volumeSignal = "HIGH";
  if (volumeRatio > 2.5) volumeSignal = "VERY_HIGH";
  if (volumeRatio < 0.5) volumeSignal = "LOW";

  return {
    rsi: rsi?.toFixed(2),
    macd: {
      value: macd.macdLine?.toFixed(2),
      signal: macd.signalLine?.toFixed(2),
      histogram: macd.histogram?.toFixed(2),
      crossover: macd.histogram > 0 ? "BULLISH" : "BEARISH",
    },
    atr: atr?.toFixed(2) ?? null,
    trend,
    trendStrength: `${trendStrength}%`,
    support,
    resistance,
    volume: {
      today: todayVolume,
      avg20Day: Math.round(avgVolume),
      ratio: volumeRatio,
      signal: volumeSignal,
    },
  };
}
