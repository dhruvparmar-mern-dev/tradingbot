import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { connectDB } from "@/lib/mongoose";
import AiUsage from "@/models/AiUsage";
import { getUser } from "@/lib/auth";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });

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
  const costAwarenessEnabled = sessionUser?.costAwarenessEnabled ?? false;

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
- If NIFTY is BEARISH, avoid BUY signals unless the stock is "very strong" -- defined concretely as: HIGH or VERY_HIGH volume confirmation, MACD and trend both aligned with the direction (not conflicting), and the target already clears the 1% floor. A stock meeting all three should not be vetoed just because NIFTY is down. Note BEARISH here can mean NIFTY is down as little as 0.5% -- a mild, ordinary down day, not a selloff -- so don't treat it as a strong signal on its own.
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
- Stop loss should be AT LEAST 0.75x-1x ATR from entry (use the ATR value given below) — this is a baseline, not a rigid range. Place the stop where the trade thesis is genuinely invalidated (beyond a real support level, or beyond how much this stock is actually swinging today) — if that's wider than 0.75x-1x ATR, use the wider stop. A stop tighter than the stock's real noise gets tagged by ordinary wobble, not a real reversal.
- Target should be AT LEAST 1.5x-2x ATR from entry, and must still clear at least a 1% move (see minimum target rule below) — this is a floor, not a ceiling. If the stock is showing strong breakout momentum (high volume, strong trend, already-expanding range), size the target to the realistic move potential — don't cap it at 1.5x-2x ATR just because that's the baseline.
- High volume confirmation is mandatory for intraday
- Avoid entry after 2:00 PM IST
- Risk-reward ratio should be at least 1:1.5 (target distance should exceed stop-loss distance by 50%)
`
      : `
TRADING MODE: SWING
- Can hold position for 2-5 days
- Stop loss should be AT LEAST 1.5x-2x ATR from entry (use the ATR value given below) — this is a baseline, not a rigid range. Place it where the trade thesis is genuinely invalidated (a real support break), even if that's wider than 1.5x-2x ATR.
- Target should be AT LEAST 3x-4x ATR from entry — this is a floor, not a ceiling. A stock in a strong confirmed trend can be sized for a bigger realistic move.
- Volume is secondary to trend here -- a confirmed multi-day trend with aligned MACD is enough on its own. Do not default to HOLD just because volume is below average; that repeatedly misses real swing moves that run before volume catches up.
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

  // Indicators are a reliable numeric summary, but they don't tell the model
  // WHEN today's move happened (a spike-then-fade reads very differently
  // than a steady grind, even with identical end-of-day RSI/MACD). Give it
  // the last few candles' actual shape instead of the full raw series —
  // enough for shape/timing context without ballooning token cost or
  // drowning the model in a long raw-number table it won't reliably parse.
  const RECENT_CANDLE_COUNT = 10;
  const candles = chartData?.candles;
  const nowText = new Date().toLocaleString("en-IN", {
    timeZone: PROMPT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
  const recentPriceActionText =
    candles && candles.length > 0
      ? (() => {
          const recent = candles.slice(-RECENT_CANDLE_COUNT);
          const span = tradingMode === "intraday" ? "5-min candles" : "daily candles";
          const lines = recent
            .map((c) => `${c.date}: ₹${c.open}→₹${c.close} (H ₹${c.high} / L ₹${c.low})`)
            .join("\n");
          return `
RECENT PRICE ACTION:
Current time: ${nowText} IST. Below: last ${recent.length} ${span} (${recent[0].date} to ${recent.at(-1).date}).
${lines}
`;
        })()
      : "";

  const feeExplanationText = costAwarenessEnabled
    ? `Every round-trip trade (buy + sell) costs approximately ₹50-60 in brokerage, STT, and other charges, regardless of trade size. `
    : "";

  const costAwarenessText = `
MINIMUM TARGET RULE:
- ${feeExplanationText}For a trade to be genuinely worth taking, the target must represent AT LEAST a 1% move from entry price (1.5% preferred for higher confidence).
- Do NOT suggest BUY signals where the target is less than 1% above entry price — such trades are not worth taking even if technically valid.
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
Recent Outcomes (VERIFIED against real subsequent price data, not self-reported): ${
        memory.signalHistory
          ?.filter((s) => s.outcome !== "PENDING")
          .slice(-5)
          .map((s) => {
            const pct = s.realOutcomePct;
            let pctPart = "";
            if (pct != null) {
              const sign = pct >= 0 ? "+" : "";
              const flag =
                s.signal !== "BUY" && pct >= 1
                  ? " -- MISSED, this would have been a real BUY opportunity"
                  : s.signal === "BUY" && pct <= -1
                    ? " -- would have LOST if traded"
                    : "";
              pctPart = ` (${sign}${pct}% actual move${flag})`;
            }
            return `${s.signal}@₹${s.price}→${s.outcome}${s.outcome === "FORCED_EXIT" ? "(time-based)" : ""}${pctPart}`;
          })
          .join(", ") || "No completed signals yet"
      }

TODAY'S UPDATE:
Price: ₹${stockData.price} (${stockData.change?.toFixed(2)}% change)
High: ₹${stockData.high} | Low: ₹${stockData.low}
Volume: ${stockData.volume?.toLocaleString()}
${technicalText}
${recentPriceActionText}

${marketText}

${modeText}

${costAwarenessText}

RULES FOR DECISION MAKING:
- Your signal must come from technical analysis: RSI, MACD, trend, support/resistance, volume confirmation.
- RSI above 70 alone is NOT a reason to avoid a BUY -- a genuinely trending stock can stay overbought for a while. Only treat it as an exhaustion warning when it comes WITH other real evidence: MACD histogram already shrinking from a peak, price failing to make new highs on the most recent candles, or volume fading despite continued price rise. If volume/trend/MACD are all still confirming the move, high RSI reflects strength, not automatic exhaustion.
- Low or normal volume ALONE is NOT a reason to stay in HOLD when price has already broken a real level and trend + MACD both confirm the move -- this applies especially in SWING mode, where volume is explicitly secondary to trend (see trading mode rules below). Many genuine multi-day breakouts run on thin volume before participation catches up; treat "needs volume confirmation" as a caution for a FRESH, unconfirmed setup, not as a repeatable veto against a move that has already run 2%+ and held there across multiple sessions. For INTRADAY, volume confirmation stays mandatory for a brand-new same-day breakout entry -- this softening is about not re-litigating a move that already has real prior confirmation, not about chasing a fresh intraday spike with no volume behind it.
- Before calling something a "fresh breakout," check current price against today's High given above. A genuine fresh breakout trades AT or NEAR today's high. If price has already pulled back meaningfully (~1-2%+) from today's high after a big earlier move, that's a spike that already topped and is fading -- not a fresh entry point, even if volume/MACD still look bullish from the initial spike.
- Market context (NIFTY/sector) is SECONDARY — use it only to:
  (a) avoid trades during a clearly bearish broad market, or
  (b) add minor confidence when technicals and market context align.
- Recent Outcomes above is VERIFIED against real price data, not your own past self-report. If it shows a past call that was wrong (e.g. a HOLD/SELL that was actually followed by a big move up, or a BUY followed by a drop), treat that as ground truth. Do NOT reuse a past reason (e.g. "RSI reversal confirmed bearish last time") to justify today's signal unless Recent Outcomes actually backs it up -- if it contradicts your memory's character/behavior notes, correct those notes in memoryUpdate instead of repeating the same mistake.

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
${recentPriceActionText}

${marketText}

${modeText}

${costAwarenessText}

RULES FOR DECISION MAKING:
- Your signal must come from technical analysis: RSI, MACD, trend, support/resistance, volume confirmation.
- RSI above 70 alone is NOT a reason to avoid a BUY -- a genuinely trending stock can stay overbought for a while. Only treat it as an exhaustion warning when it comes WITH other real evidence: MACD histogram already shrinking from a peak, price failing to make new highs on the most recent candles, or volume fading despite continued price rise. If volume/trend/MACD are all still confirming the move, high RSI reflects strength, not automatic exhaustion.
- Low or normal volume ALONE is NOT a reason to stay in HOLD when price has already broken a real level and trend + MACD both confirm the move -- this applies especially in SWING mode, where volume is explicitly secondary to trend (see trading mode rules below). Many genuine multi-day breakouts run on thin volume before participation catches up; treat "needs volume confirmation" as a caution for a FRESH, unconfirmed setup, not as a repeatable veto against a move that has already run 2%+ and held there across multiple sessions. For INTRADAY, volume confirmation stays mandatory for a brand-new same-day breakout entry -- this softening is about not re-litigating a move that already has real prior confirmation, not about chasing a fresh intraday spike with no volume behind it.
- Before calling something a "fresh breakout," check current price against today's High given above. A genuine fresh breakout trades AT or NEAR today's high. If price has already pulled back meaningfully (~1-2%+) from today's high after a big earlier move, that's a spike that already topped and is fading -- not a fresh entry point, even if volume/MACD still look bullish from the initial spike.
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

  const model = "claude-sonnet-5";
  let message;
  try {
    message = await anthropic.messages.create({
      model,
      // Thinking blocks share this budget with the JSON response. 2000 was
      // still not enough -- a real call (SBIN, 2026-07-14) hit the ceiling
      // mid-JSON and lost the whole signal (unparseable, silent HOLD-null).
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    // SDK throws on non-2xx (APIError) instead of returning an error body,
    // so there's no usage/cost data to log for this failure path.
    await AiUsage.create({
      symbol: stockData.symbol,
      mode: tradingMode,
      signal: null,
      model,
      prompt,
      rawResponseText: JSON.stringify({ error: err.message, status: err.status }),
    });
    return NextResponse.json(
      { error: err.message || "AI analysis failed" },
      { status: err.status || 500 },
    );
  }

  const cost = estimateCost(model, message.usage);

  // With thinking enabled, content[0] can be a "thinking" block instead of
  // the text block — find the text block explicitly rather than assuming
  // it's first.
  const textBlock = message.content?.find((b) => b.type === "text");
  if (!textBlock) {
    await AiUsage.create({
      symbol: stockData.symbol,
      mode: tradingMode,
      signal: null,
      model,
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
      costUSD: cost,
      prompt,
      rawResponseText: JSON.stringify(message),
    });
    return NextResponse.json(
      { error: "AI analysis failed" },
      { status: 500 },
    );
  }
  const text = textBlock.text;
  const clean = text.replace(/```json|```/g, "").trim();

  try {
    const parsed = JSON.parse(clean);

    // The prompt tells the model to enforce a 1% minimum target, but it
    // doesn't always do the arithmetic itself (seen live: TECHM got a BUY
    // with a target only 0.45% above entry). This is a floor check only —
    // it never touches or caps a target that's already >= 1%, so a stock
    // with real momentum can still get a much bigger target from the model.
    if (parsed.signal === "BUY" && typeof parsed.target === "number") {
      const gapPct = ((parsed.target - stockData.price) / stockData.price) * 100;
      if (gapPct < 1) {
        parsed.signal = "HOLD";
        parsed.reason = `[Auto-overridden BUY→HOLD: target was only ${gapPct.toFixed(2)}% above entry, below the 1% minimum] ${parsed.reason}`;
      }
    }

    await AiUsage.create({
      symbol: stockData.symbol,
      mode: tradingMode,
      signal: parsed.signal,
      model,
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
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
      inputTokens: message.usage?.input_tokens,
      outputTokens: message.usage?.output_tokens,
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
