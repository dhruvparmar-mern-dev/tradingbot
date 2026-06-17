"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from "lightweight-charts";

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

    const toISTLabel = (time) => {
      const date = new Date(time * 1000);
      const istDate = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
      return {
        hh: istDate.getUTCHours().toString().padStart(2, "0"),
        mm: istDate.getUTCMinutes().toString().padStart(2, "0"),
        dd: istDate.getUTCDate().toString().padStart(2, "0"),
        mon: istDate.toLocaleString("en", { month: "short" }),
        yyyy: istDate.getUTCFullYear(),
      };
    };

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
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "#3f3f46" },
      timeScale: {
        borderColor: "#3f3f46",
        timeVisible: mode === "intraday",
        secondsVisible: false,
        tickMarkFormatter: (time) => {
          const { hh, mm, dd, mon } = toISTLabel(time);
          return mode === "intraday" ? `${hh}:${mm}` : `${dd} ${mon}`;
        },
      },
      localization: {
        timeFormatter: (time) => {
          const { hh, mm, dd, mon, yyyy } = toISTLabel(time);
          return mode === "intraday"
            ? `${dd} ${mon} ${hh}:${mm}`
            : `${dd} ${mon} ${yyyy}`;
        },
      },
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#3f3f46",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    const formattedCandles = candles
      .map((c) => {
        let time;
        if (mode === "intraday") {
          const [datePart, timePart] = c.date.split(", ");
          const [day, month, year] = datePart.split("/");
          let [time12, meridian] = timePart.split(" ");
          let [hh, mm, ss] = time12.split(":").map(Number);
          if (meridian?.toLowerCase() === "pm" && hh !== 12) hh += 12;
          if (meridian?.toLowerCase() === "am" && hh === 12) hh = 0;
          const isoString = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}+05:30`;
          time = Math.floor(new Date(isoString).getTime() / 1000);
        } else {
          const datePart = c.date.split(",")[0].trim();
          const [day, month, year] = datePart.split("/");
          time = Math.floor(
            new Date(
              `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00+05:30`,
            ).getTime() / 1000,
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
      .filter(
        (c) =>
          !isNaN(c.time) &&
          !isNaN(c.open) &&
          !isNaN(c.high) &&
          !isNaN(c.low) &&
          !isNaN(c.close),
      )
      .sort((a, b) => a.time - b.time)
      .filter(
        (c, i, arr) => i === arr.length - 1 || c.time !== arr[i + 1].time,
      );

    candleSeries.setData(formattedCandles);
    volumeSeries.setData(formattedCandles);

    if (support && formattedCandles.length > 0) {
      const supportLine = chart.addSeries(LineSeries, {
        color: "#f87171",
        lineWidth: 1,
        lineStyle: 2,
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

    if (resistance && formattedCandles.length > 0) {
      const resistanceLine = chart.addSeries(LineSeries, {
        color: "#34d399",
        lineWidth: 1,
        lineStyle: 2,
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
