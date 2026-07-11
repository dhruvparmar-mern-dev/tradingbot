import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import AiUsage from "@/models/AiUsage";
import { getUser } from "@/lib/auth";

// Sonnet 5 intro pricing runs through 2026-08-31 — update to $3 / $15 after that.
// (Prompt caching was tried and reverted — our static system content is
// ~250-300 tokens, well under Anthropic's ~1024-token minimum for a
// cacheable block on Sonnet-class models, so cache_control was silently
// ignored. Not worth inflating the prompt just to cross that floor.)
const PRICING = {
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
};

// Single source of truth for the timezone used to format any date embedded
// in the prompt — the audit log below reads this same constant, so it can
// never drift out of sync with what's actually sent to the model.
const PROMPT_TIMEZONE = "Asia/Kolkata";

function estimateCost(model, usage) {
  const rate = PRICING[model];
  if (!rate || !usage) return null;
  return (
    (usage.input_tokens / 1e6) * rate.input +
    (usage.output_tokens / 1e6) * rate.output
  );
}

export async function POST(request) {
  const { stockData, news, chartData, memory, marketContext, tradingMode } =
    await request.json();

  await connectDB();
  const sessionUser = await getUser();
  const dailyBudget = sessionUser?.dailyAiBudgetUSD ?? 1.0;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [{ total: spentToday } = { total: 0 }] = await AiUsage.aggregate([
    { $match: { time: { $gte: startOfDay } } },
    { $group: { _id: null, total: { $sum: "$costUSD" } } },
  ]);

  if (spentToday >= dailyBudget) {
    return NextResponse.json(
      {
        error: `Daily AI budget of $${dailyBudget.toFixed(2)} reached ($${spentToday.toFixed(4)} spent today). Raise the limit in Settings or try again tomorrow.`,
      },
      { status: 429 },
    );
  }

  // News is deliberately not fed into the decision — trading only on technicals
  // + market context for now. Re-enable by uncommenting this and the
  // NEW NEWS TODAY / RECENT NEWS sections below.
  // const newsText =
  //   news.length > 0
  //     ? news
  //         .map((n) => {
  //           const age =
  //             n.daysAgo == null
  //               ? ""
  //               : n.daysAgo === 0
  //                 ? ", today"
  //                 : n.daysAgo === 1
  //                   ? ", 1 day ago"
  //                   : `, ${n.daysAgo} days ago`;
  //           return `- ${n.title} (${n.source}${age})`;
  //         })
  //         .join("\n")
  //     : "No news available";

  const marketText = marketContext
    ? `
MARKET CONTEXT:
NIFTY 50: ${marketContext.nifty?.change >= 0 ? "▲" : "▼"} ${Math.abs(marketContext.nifty?.change || 0).toFixed(2)}% (${marketContext.nifty?.sentiment})
Sector (${marketContext.sector?.name}): ${marketContext.sector?.change >= 0 ? "▲" : "▼"} ${Math.abs(marketContext.sector?.change || 0).toFixed(2)}% (${marketContext.sector?.sentiment})
Overall Market: ${marketContext.marketSentiment}

Rules:
- If NIFTY is BEARISH, avoid BUY signals unless stock is very strong
- If NIFTY is BULLISH, BUY signals are more reliable
- If sector is BEARISH but stock is up, it may be short lived
- If sector is BULLISH and stock is up, strong confirmation
`
    : "";

  const modeText =
    tradingMode === "intraday"
      ? `
TRADING MODE: INTRADAY
- Position must be closed by 3:15 PM IST today
- Stop loss should be approximately 0.75x-1x ATR from entry (use the ATR value given below — this scales to how much THIS stock actually moves, not a fixed %)
- Target should be approximately 1.5x-2x ATR from entry, and must still clear at least a 1% move (see cost awareness below)
- High volume confirmation is mandatory for intraday
- Avoid entry after 2:00 PM IST
- Risk-reward ratio should be at least 1:1.5 (target distance should exceed stop-loss distance by 50%)
`
      : `
TRADING MODE: SWING
- Can hold position for 2-5 days
- Stop loss should be approximately 1.5x-2x ATR from entry (use the ATR value given below)
- Target should be approximately 3x-4x ATR from entry
- Volume less critical than trend
`;

  const indicators = chartData?.indicators;
  const hasValidIndicators =
    indicators &&
    indicators.rsi !== null &&
    indicators.rsi !== undefined &&
    indicators.macd?.value !== null;

  const technicalText = hasValidIndicators
    ? `
TECHNICAL ANALYSIS:
Trend: ${indicators.trend} (price is ${indicators.trendStrength} vs its 20-period EMA)
RSI (14): ${indicators.rsi} ${indicators.rsi > 70 ? "⚠️ Overbought" : indicators.rsi < 30 ? "⚠️ Oversold" : "✅ Neutral"}
MACD: ${indicators.macd.value} | Signal: ${indicators.macd.signal} | Histogram: ${indicators.macd.histogram}
MACD Crossover: ${indicators.macd.crossover}
ATR (14): ₹${indicators.atr ?? "N/A"} — use this to size stop-loss/target (see trading mode rules below), not a fixed %
${
  indicators.volume
    ? `Volume: ${Number(indicators.volume.today).toLocaleString("en-IN")} vs ${Number(indicators.volume.avg20Day).toLocaleString("en-IN")} avg (20-period) — ${indicators.volume.ratio}x, ${indicators.volume.signal}`
    : ""
}
${
  indicators.vwap
    ? `VWAP (today): ₹${indicators.vwap} — price is currently ${stockData.price >= indicators.vwap ? "ABOVE" : "BELOW"} VWAP (${stockData.price >= indicators.vwap ? "bullish" : "bearish"} intraday bias)${
        indicators.vwapCandleCount != null && indicators.vwapCandleCount < 6
          ? ` — ⚠️ only ${indicators.vwapCandleCount} candles into the session (< 30 min since open), VWAP is not settled yet, treat as low-confidence`
          : ""
      }`
    : ""
}
Support: ₹${indicators.support}
Resistance: ₹${indicators.resistance}
`
    : "No technical data available";

  const costAwarenessText = `
TRANSACTION COST AWARENESS:
- Every round-trip trade (buy + sell) costs approximately ₹50-60 in brokerage, STT, and other charges, regardless of trade size.
- For a trade to be genuinely profitable after costs, the target must represent AT LEAST a 1% move from entry price (1.5% preferred for higher confidence).
- Do NOT suggest BUY signals where the target is less than 1% above entry price — such trades are not worth taking even if technically valid, since transaction costs will exceed the profit.
- If technicals only support a sub-1% move, signal should be HOLD instead of BUY, regardless of other positive factors.
`;

  // If memory exists → fast analysis with just new info
  // If no memory → deep analysis and build memory
  const prompt = memory
    ? `
You are an expert Indian stock market trading assistant with memory of this stock.

YOUR MEMORY OF ${stockData.symbol}:
Character: ${memory.character}
Known Behavior: ${memory.behavior}
Key Levels: Support ₹${memory.keyLevels?.support} | Resistance ₹${memory.keyLevels?.resistance}
Last Signal: ${memory.lastAnalysis?.signal} on ${new Date(memory.lastAnalysis?.date).toLocaleDateString("en-IN", { timeZone: PROMPT_TIMEZONE })} at ₹${memory.lastAnalysis?.price || "unknown"}
Past Signals: ${memory.signalHistory?.length || 0} signals recorded
Win Rate: ${memory.winRate ?? "N/A"}% (${memory.completedSignals || 0} completed out of ${memory.totalSignals || 0} total signals)
Recent Outcomes: ${
        memory.signalHistory
          ?.filter((s) => s.outcome !== "PENDING")
          .slice(-5)
          .map(
            (s) =>
              `${s.signal}@₹${s.price}→${s.outcome}${s.outcome === "FORCED_EXIT" ? "(time-based)" : ""}`,
          )
          .join(", ") || "No completed signals yet"
      }

TODAY'S UPDATE:
Price: ₹${stockData.price} (${stockData.change?.toFixed(2)}% change)
High: ₹${stockData.high} | Low: ₹${stockData.low}
Volume: ${stockData.volume?.toLocaleString()}
${technicalText}

${marketText}

${modeText}

${costAwarenessText}

RULES FOR DECISION MAKING:
- Your signal must come from technical analysis: RSI, MACD, trend, support/resistance, volume confirmation.
- Market context (NIFTY/sector) is SECONDARY — use it only to:
  (a) avoid trades during a clearly bearish broad market, or
  (b) add minor confidence when technicals and market context align.

Based on your memory + today's update, give a quick decision.
Respond in this exact JSON format only, no extra text:
{
  "signal": "BUY" or "SELL" or "HOLD",
  "confidence": number 1-10,
  "reason": "2-3 lines referencing your memory + what changed today",
  "stopLoss": number,
  "target": number,
  "riskLevel": "LOW" or "MEDIUM" or "HIGH",
  "memoryUpdate": {
    "character": "updated character if anything changed, else keep same",
    "behavior": "updated behavior observation",
    "keyLevels": { "support": number, "resistance": number }
  }
}
`
    : `
You are an expert Indian stock market trading assistant. Do a DEEP analysis of this stock and build a memory profile.

STOCK INFO:
Symbol: ${stockData.symbol} (${stockData.name})
Exchange: ${stockData.exchange}
Current Price: ₹${stockData.price}
Change Today: ${stockData.change?.toFixed(2)}% (₹${stockData.changeAmount?.toFixed(2)})
Open: ₹${stockData.open} | Prev Close: ₹${stockData.prevClose}
High: ₹${stockData.high} | Low: ₹${stockData.low}
52W High: ₹${stockData.fiftyTwoWeekHigh} | 52W Low: ₹${stockData.fiftyTwoWeekLow}
Volume: ${stockData.volume?.toLocaleString()}

${technicalText}

${marketText}

${modeText}

${costAwarenessText}

RULES FOR DECISION MAKING:
- Your signal must come from technical analysis: RSI, MACD, trend, support/resistance, volume confirmation.
- Market context (NIFTY/sector) is SECONDARY — use it only to:
  (a) avoid trades during a clearly bearish broad market, or
  (b) add minor confidence when technicals and market context align.

Respond in this exact JSON format only, no extra text:
{
  "signal": "BUY" or "SELL" or "HOLD",
  "confidence": number 1-10,
  "reason": "3-4 lines with full analysis mentioning RSI, MACD, trend and support/resistance",
  "stopLoss": number,
  "target": number,
  "riskLevel": "LOW" or "MEDIUM" or "HIGH",
  "memoryUpdate": {
    "character": "1-2 lines about this stock personality, sector, what affects it",
    "behavior": "1-2 lines about how this stock typically behaves based on what you see",
    "keyLevels": { "support": number, "resistance": number }
  }
}
`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1000,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();
  const model = "claude-sonnet-5";
  const cost = estimateCost(model, data.usage);

  if (!data.content || !data.content[0]) {
    await AiUsage.create({
      symbol: stockData.symbol,
      mode: tradingMode,
      signal: null,
      model,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      costUSD: cost,
      prompt,
      rawResponseText: JSON.stringify(data),
    });
    return NextResponse.json(
      { error: data.error?.message || "AI analysis failed" },
      { status: 500 },
    );
  }
  const text = data.content[0].text;
  const clean = text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(clean);
    await AiUsage.create({
      symbol: stockData.symbol,
      mode: tradingMode,
      signal: parsed.signal,
      model,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      costUSD: cost,
      prompt,
      rawResponseText: text,
      parsedResponse: parsed,
    });
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("JSON parse error:", clean);
    await AiUsage.create({
      symbol: stockData.symbol,
      mode: tradingMode,
      signal: null,
      model,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      costUSD: cost,
      prompt,
      rawResponseText: text,
    });
    return NextResponse.json(
      { error: "AI returned invalid response" },
      { status: 500 },
    );
  }
}
