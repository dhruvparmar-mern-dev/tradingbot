import { NextResponse } from "next/server";

export async function POST(request) {
  const { stockData, news, chartData, memory, marketContext, tradingMode } =
    await request.json();

  const newsText =
    news.length > 0
      ? news.map((n) => `- ${n.title} (${n.source})`).join("\n")
      : "No news available";

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
- Stop loss should be 0.5-0.7% from entry (tight, but not so tight that normal volatility triggers it)
- Target should be 1-1.5% from entry (must clear transaction costs)
- High volume confirmation is mandatory for intraday
- Avoid entry after 2:00 PM IST
- Risk-reward ratio should be at least 1:1.5 (target distance should exceed stop-loss distance by 50%)
`
      : `
TRADING MODE: SWING
- Can hold position for 2-5 days
- Wider stop loss acceptable (1-2% from entry)
- Target can be 3-5% move
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
Trend: ${indicators.trend} (${indicators.trendStrength} over 20 days)
RSI (14): ${indicators.rsi} ${indicators.rsi > 70 ? "⚠️ Overbought" : indicators.rsi < 30 ? "⚠️ Oversold" : "✅ Neutral"}
MACD: ${indicators.macd.value} | Signal: ${indicators.macd.signal} | Histogram: ${indicators.macd.histogram}
MACD Crossover: ${indicators.macd.crossover}
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
Last Signal: ${memory.lastAnalysis?.signal} on ${new Date(memory.lastAnalysis?.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })} at ₹${memory.lastAnalysis?.price || "unknown"}
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

NEW NEWS TODAY:
${newsText}

${marketText}

${modeText}

${costAwarenessText}

RULES FOR DECISION MAKING:
- Your PRIMARY signal must come from technical analysis: RSI, MACD, trend, support/resistance, volume confirmation.
- News and market context are SECONDARY — use them only to:
  (a) avoid trades during clearly negative fundamental events (scam, regulatory action, major selloff), or
  (b) add minor confidence when technicals and news align.
- Do NOT generate a BUY/SELL signal primarily because of news sentiment alone. If technicals are neutral/weak, say HOLD even if news sounds positive.

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

RECENT NEWS:
${newsText}

${marketText}

${modeText}

${costAwarenessText}

RULES FOR DECISION MAKING:
- Your PRIMARY signal must come from technical analysis: RSI, MACD, trend, support/resistance, volume confirmation.
- News and market context are SECONDARY — use them only to:
  (a) avoid trades during clearly negative fundamental events (scam, regulatory action, major selloff), or
  (b) add minor confidence when technicals and news align.
- Do NOT generate a BUY/SELL signal primarily because of news sentiment alone. If technicals are neutral/weak, say HOLD even if news sounds positive.

Respond in this exact JSON format only, no extra text:
{
  "signal": "BUY" or "SELL" or "HOLD",
  "confidence": number 1-10,
  "reason": "3-4 lines with full analysis mentioning RSI, MACD, trend and news",
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
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json();

  if (!data.content || !data.content[0]) {
    return NextResponse.json(
      { error: data.error?.message || "AI analysis failed" },
      { status: 500 },
    );
  }
  const text = data.content[0].text;
  const clean = text.replace(/```json|```/g, "").trim();

  try {
    return NextResponse.json(JSON.parse(clean));
  } catch (err) {
    console.error("JSON parse error:", clean);
    return NextResponse.json(
      { error: "AI returned invalid response" },
      { status: 500 },
    );
  }
}
