"use client";
import { useEffect, useState } from "react";

export default function MarketOverview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOverview();
    // Refresh every 5 mins
    const interval = setInterval(fetchOverview, 300000);
    return () => clearInterval(interval);
  }, []);

  const fetchOverview = async () => {
    try {
      const res = await fetch("/api/market-overview");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  const indices = data
    ? [
        { label: "NIFTY 50", data: data.nifty },
        { label: "BANK NIFTY", data: data.bankNifty },
        { label: "SENSEX", data: data.sensex },
        { label: "NIFTY IT", data: data.niftyIT },
        { label: "MIDCAP 50", data: data.niftyMidcap },
      ]
    : [];

  if (loading)
    return (
      <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-32 mb-3" />
        <div className="flex gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-10 bg-zinc-800 rounded w-28" />
          ))}
        </div>
      </div>
    );

  return (
    <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Market Overview
        </h2>
        <span className="text-xs text-zinc-600">Updates every 5 min</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {indices.map(({ label, data }) => (
          <div
            key={label}
            className={`rounded-lg px-3 py-2 border ${
              !data
                ? "border-zinc-800 bg-zinc-800/50"
                : data.change >= 0
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-red-500/20 bg-red-500/5"
            }`}
          >
            <div className="text-xs text-zinc-500 mb-1">{label}</div>
            {!data ? (
              <div className="text-xs text-zinc-600">N/A</div>
            ) : (
              <>
                <div className="text-sm font-bold text-white">
                  {data.price?.toLocaleString("en-IN", {
                    maximumFractionDigits: 0,
                  })}
                </div>
                <div
                  className={`text-xs font-medium ${data.change >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {data.change >= 0 ? "▲" : "▼"}{" "}
                  {Math.abs(data.change).toFixed(2)}%
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
