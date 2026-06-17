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
- Use tighter stop loss (0.3-0.5% from entry)
- Target should be realistic for same day (0.5-1%)
- High volume confirmation is mandatory for intraday
- Avoid entry after 2:00 PM IST
`
      : `
TRADING MODE: SWING
- Can hold position for 2-5 days
- Wider stop loss acceptable (1-2% from entry)
- Target can be 3-5% move
- Volume less critical than trend
`;

  const indicators = chartData?.indicators;
  const technicalText = indicators
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

  // If memory exists → fast analysis with just new info
  // If no memory → deep analysis and build memory
  const prompt = memory
    ? `
You are an expert Indian stock market trading assistant with memory of this stock.

YOUR MEMORY OF ${stockData.symbol}:
Character: ${memory.character}
Known Behavior: ${memory.behavior}
Key Levels: Support ₹${memory.keyLevels?.support} | Resistance ₹${memory.keyLevels?.resistance}
Last Signal: ${memory.lastAnalysis?.signal} on ${new Date(memory.lastAnalysis?.date).toLocaleDateString("en-IN")} at ₹${memory.lastAnalysis?.price || "unknown"}
Past Signals: ${memory.signalHistory?.length || 0} signals recorded
Win Rate: ${memory.winRate ?? "N/A"}% (${memory.completedSignals || 0} completed out of ${memory.totalSignals || 0} total signals)
Recent Outcomes: ${
        memory.signalHistory
          ?.filter((s) => s.outcome !== "PENDING")
          .slice(-3)
          .map((s) => `${s.signal}@₹${s.price}→${s.outcome}`)
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
