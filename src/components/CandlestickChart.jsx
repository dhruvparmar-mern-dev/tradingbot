"use client";
import { useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";

export default function CandlestickChart({
  candles,
  support,
  resistance,
  mode,
}) {
  const chartRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !candles?.length) return;

    // Create chart
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 400,
      layout: {
        background: { color: "#09090b" },
        textColor: "#a1a1aa",
      },
      grid: {
        vertLines: { color: "#27272a" },
        horzLines: { color: "#27272a" },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: "#3f3f46",
      },
      timeScale: {
        borderColor: "#3f3f46",
        timeVisible: mode === "intraday",
        secondsVisible: false,
      },
    });

    chartRef.current = chart;

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    // Volume series
    const volumeSeries = chart.addHistogramSeries({
      color: "#3f3f46",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // Format candles for lightweight-charts
    const formattedCandles = candles
      .map((c) => {
        // Handle both swing (date string) and intraday (datetime string)
        let time;
        if (mode === "intraday") {
          time = Math.floor(new Date(c.date).getTime() / 1000);
        } else {
          const [day, month, year] = c.date.split("/");
          time = Math.floor(
            new Date(`${year}-${month}-${day}`).getTime() / 1000,
          );
        }
        return {
          time,
          open: parseFloat(c.open),
          high: parseFloat(c.high),
          low: parseFloat(c.low),
          close: parseFloat(c.close),
          value: c.volume,
          color:
            parseFloat(c.close) >= parseFloat(c.open)
              ? "#22c55e30"
              : "#ef444430",
        };
      })
      .filter((c) => !isNaN(c.time) && c.open && c.high && c.low && c.close)
      .sort((a, b) => a.time - b.time);

    candleSeries.setData(formattedCandles);
    volumeSeries.setData(formattedCandles);

    // Support line
    if (support) {
      const supportLine = chart.addLineSeries({
        color: "#f87171",
        lineWidth: 1,
        lineStyle: 2, // dashed
        title: "Support",
      });
      supportLine.setData([
        { time: formattedCandles[0].time, value: parseFloat(support) },
        {
          time: formattedCandles[formattedCandles.length - 1].time,
          value: parseFloat(support),
        },
      ]);
    }

    // Resistance line
    if (resistance) {
      const resistanceLine = chart.addLineSeries({
        color: "#34d399",
        lineWidth: 1,
        lineStyle: 2, // dashed
        title: "Resistance",
      });
      resistanceLine.setData([
        { time: formattedCandles[0].time, value: parseFloat(resistance) },
        {
          time: formattedCandles[formattedCandles.length - 1].time,
          value: parseFloat(resistance),
        },
      ]);
    }

    chart.timeScale().fitContent();

    // Responsive resize
    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [candles, support, resistance, mode]);

  if (!candles?.length)
    return (
      <div className="h-[400px] flex items-center justify-center text-zinc-500 text-sm">
        No chart data available
      </div>
    );

  return <div ref={containerRef} className="w-full h-[400px]" />;
}
