const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "https://tradingbot.dhruvparmar.in";

export async function runAnalysisServerSide(
  stock,
  tradingMode,
  forceFreshChart = false,
  cookieHeader = "",
) {
  const authHeaders = { Cookie: cookieHeader };

  const memoryRes = await fetch(
    `${BASE_URL}/api/memory?symbol=${stock.symbol}&mode=${tradingMode}`,
    { headers: authHeaders },
  );
  const memoryData = await memoryRes.json();
  const hasMemory = memoryData && memoryData.lastAnalysis;

  const needsChart = !hasMemory || forceFreshChart;

  let chartEndpoint = `${BASE_URL}/api/chart?symbol=${stock.symbol}`;
  if (needsChart) {
    const kiteRes = await fetch(`${BASE_URL}/api/kite/status`);
    const { connected: kiteConnected } = await kiteRes.json();
    if (kiteConnected) {
      const rangeParam = tradingMode === "intraday" ? "&range=5D" : "&range=3M";
      chartEndpoint = `${BASE_URL}/api/kite/historical?symbol=${stock.symbol}&mode=${tradingMode}${rangeParam}`;
    }
  }

  const fetchPromises = [
    fetch(`${BASE_URL}/api/news?symbol=${stock.symbol}`, {
      headers: authHeaders,
    }),
    fetch(`${BASE_URL}/api/market-context?symbol=${stock.symbol}`, {
      headers: authHeaders,
    }),
    ...(needsChart ? [fetch(chartEndpoint, { headers: authHeaders })] : []),
  ];
  const responses = await Promise.all(fetchPromises);
  const newsData = await responses[0].json();
  const marketContextData = await responses[1].json();
  const chartData = needsChart ? await responses[2].json() : null;

  const aiRes = await fetch(`${BASE_URL}/api/ai-signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify({
      stockData: stock,
      news: newsData,
      chartData,
      memory: hasMemory ? memoryData : null,
      marketContext: marketContextData,
      tradingMode,
    }),
  });
  const aiData = await aiRes.json();
  if (!aiRes.ok) throw new Error(aiData.error || "AI analysis failed");

  const newLastAnalysis = {
    signal: aiData.signal,
    confidence: aiData.confidence,
    rsi: chartData?.indicators?.rsi || memoryData?.lastAnalysis?.rsi,
    trend: chartData?.indicators?.trend || memoryData?.lastAnalysis?.trend,
    reason: aiData.reason,
    stopLoss: aiData.stopLoss,
    target: aiData.target,
    price: stock.price,
    date: new Date(),
  };

  if (aiData.memoryUpdate) {
    const newMemory = {
      ...memoryData,
      character: aiData.memoryUpdate.character,
      behavior: aiData.memoryUpdate.behavior,
      keyLevels: aiData.memoryUpdate.keyLevels,
      lastAnalysis: newLastAnalysis,
      signalHistory: [
        ...(memoryData?.signalHistory || []),
        {
          signal: aiData.signal,
          confidence: aiData.confidence,
          price: stock.price,
          date: new Date(),
          outcome: "PENDING",
        },
      ].slice(-20),
    };
    await fetch(`${BASE_URL}/api/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({
        symbol: stock.symbol,
        memory: newMemory,
        mode: tradingMode,
      }),
    });
  }

  return { ...aiData, lastAnalysis: newLastAnalysis, news: newsData };
}
