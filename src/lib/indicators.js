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

export function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  const validCloses = closes.filter(Boolean);
  if (validCloses.length < slow + signal)
    return { macdLine: null, signalLine: null, histogram: null };

  const emaFast = calculateEMA(validCloses, fast);
  const emaSlow = calculateEMA(validCloses, slow);
  const macdLine = emaFast - emaSlow;

  const signalLine =
    macdLine * 0.2 +
    (calculateEMA(validCloses.slice(0, -1), fast) -
      calculateEMA(validCloses.slice(0, -1), slow)) *
      0.8;

  return { macdLine, signalLine, histogram: macdLine - signalLine };
}

// Shared by both /api/chart (Yahoo) and /api/kite/historical (Kite) so
// technical indicators are computed the same way regardless of data source.
export function computeIndicators({ closes, highs, lows, volumes }) {
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);

  const last20 = closes.slice(-20).filter(Boolean);
  const trend =
    last20.length > 1 && last20[last20.length - 1] > last20[0]
      ? "UPTREND"
      : "DOWNTREND";
  const trendStrength =
    last20.length > 1
      ? (
          ((last20[last20.length - 1] - last20[0]) / last20[0]) *
          100
        ).toFixed(2)
      : "0.00";

  const last20Highs = highs.slice(-20).filter(Boolean);
  const last20Lows = lows.slice(-20).filter(Boolean);
  const resistance = last20Highs.length
    ? Math.max(...last20Highs).toFixed(2)
    : null;
  const support = last20Lows.length ? Math.min(...last20Lows).toFixed(2) : null;

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
