export async function runAnalysis(stock, tradingMode, forceFreshChart = false) {
  const memoryRes = await fetch(
    `/api/memory?symbol=${stock.symbol}&mode=${tradingMode}`,
  );
  const memoryData = await memoryRes.json();
  const hasMemory = memoryData && memoryData.lastAnalysis;
  const needsChart = !hasMemory || forceFreshChart; // ← key change

  const fetchPromises = [
    fetch(`/api/news?symbol=${stock.symbol}`),
    fetch(`/api/market-context?symbol=${stock.symbol}`),
    ...(needsChart ? [fetch(`/api/chart?symbol=${stock.symbol}`)] : []),
  ];
  const responses = await Promise.all(fetchPromises);
  const newsData = await responses[0].json();
  const marketContextData = await responses[1].json();
  const chartData = needsChart ? await responses[2].json() : null;

  const aiRes = await fetch("/api/ai-signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: stock.symbol,
        memory: newMemory,
        mode: tradingMode,
      }),
    });
  }

  return { ...aiData, lastAnalysis: newLastAnalysis, news: newsData };
}
