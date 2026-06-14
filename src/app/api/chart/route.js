import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  let symbol = searchParams.get("symbol")?.toUpperCase().trim();

  if (!symbol.includes(".")) symbol = `${symbol}.NS`;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    );

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return NextResponse.json({ error: "No chart data" }, { status: 404 });
    }

    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    const closes = quotes.close;
    const highs = quotes.high;
    const lows = quotes.low;
    const volumes = quotes.volume;

    // Build candles array
    const candles = timestamps
      .map((t, i) => ({
        date: new Date(t * 1000).toLocaleDateString("en-IN"),
        open: quotes.open[i]?.toFixed(2),
        high: highs[i]?.toFixed(2),
        low: lows[i]?.toFixed(2),
        close: closes[i]?.toFixed(2),
        volume: volumes[i],
      }))
      .filter((c) => c.close !== null);

    // Calculate RSI (14 period)
    const rsi = calculateRSI(closes, 14);

    // Calculate MACD (12, 26, 9)
    const macd = calculateMACD(closes);

    // Simple trend (last 20 days)
    const last20 = closes.slice(-20).filter(Boolean);
    const trend =
      last20[last20.length - 1] > last20[0] ? "UPTREND" : "DOWNTREND";
    const trendStrength = (
      ((last20[last20.length - 1] - last20[0]) / last20[0]) *
      100
    ).toFixed(2);

    // Support & Resistance (simple: lowest low and highest high of last 20 days)
    const last20Highs = highs.slice(-20).filter(Boolean);
    const last20Lows = lows.slice(-20).filter(Boolean);
    const resistance = Math.max(...last20Highs).toFixed(2);
    const support = Math.min(...last20Lows).toFixed(2);

    // Volume analysis
    const avgVolume =
      volumes
        .slice(-20)
        .filter(Boolean)
        .reduce((a, b) => a + b, 0) / 20;
    const todayVolume = volumes[volumes.length - 1] || 0;
    const volumeRatio = (todayVolume / avgVolume).toFixed(2);
    let volumeSignal = "NORMAL";
    if (volumeRatio > 1.5) volumeSignal = "HIGH";
    if (volumeRatio > 2.5) volumeSignal = "VERY_HIGH";
    if (volumeRatio < 0.5) volumeSignal = "LOW";

    // Add to indicators in return
    return NextResponse.json({
      candles: candles.slice(-30), // last 30 days for chart
      indicators: {
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
      },
    });
  } catch (err) {
    console.error("Chart error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function calculateRSI(closes, period = 14) {
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

function calculateMACD(closes, fast = 12, slow = 26, signal = 9) {
  const validCloses = closes.filter(Boolean);
  if (validCloses.length < slow + signal)
    return { macdLine: null, signalLine: null, histogram: null };

  const emaFast = calculateEMA(validCloses, fast);
  const emaSlow = calculateEMA(validCloses, slow);

  const macdLine = emaFast - emaSlow;

  // Signal line = EMA of last 9 MACD values (simplified)
  const signalLine =
    macdLine * 0.2 +
    (calculateEMA(validCloses.slice(0, -1), fast) -
      calculateEMA(validCloses.slice(0, -1), slow)) *
      0.8;

  return {
    macdLine,
    signalLine,
    histogram: macdLine - signalLine,
  };
}

function calculateEMA(closes, period) {
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return ema;
}
