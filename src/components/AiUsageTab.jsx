"use client";
import { useEffect, useState } from "react";

const SIGNAL_COLORS = {
  BUY: "text-emerald-400",
  SELL: "text-red-400",
  HOLD: "text-amber-400",
  ERROR: "text-zinc-500",
};

export default function AiUsageTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai-usage");
      setData(await res.json());
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  if (loading)
    return (
      <div className="text-center text-zinc-500 py-16 text-sm">Loading...</div>
    );

  if (!data)
    return (
      <div className="text-center text-zinc-500 py-16 text-sm">
        Couldn&apos;t load AI usage data.
      </div>
    );

  const budgetUsedPct = Math.min(
    100,
    (data.today.total / data.dailyBudget) * 100,
  );
  const budgetColor =
    budgetUsedPct >= 100
      ? "bg-red-500"
      : budgetUsedPct >= 75
        ? "bg-amber-500"
        : "bg-emerald-500";

  return (
    <div className="flex flex-col gap-4">
      {/* Today's budget */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-sm font-semibold text-white">
            Today&apos;s AI Spend
          </span>
          <span className="text-sm text-zinc-400">
            ${data.today.total.toFixed(4)} / ${data.dailyBudget.toFixed(2)}
          </span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full ${budgetColor} transition-all`}
            style={{ width: `${budgetUsedPct}%` }}
          />
        </div>
        <div className="text-xs text-zinc-500 mt-2">
          {data.today.calls} AI call{data.today.calls === 1 ? "" : "s"} today
          {budgetUsedPct >= 100 && (
            <span className="text-red-400 font-medium">
              {" "}
              — daily budget reached, further calls are blocked until
              tomorrow (adjust in Settings)
            </span>
          )}
        </div>
      </div>

      {/* Totals grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Today",
            value: `$${data.today.total.toFixed(4)}`,
            sub: `${data.today.calls} calls`,
          },
          {
            label: "This Month",
            value: `$${data.month.total.toFixed(4)}`,
            sub: `${data.month.calls} calls`,
          },
          {
            label: "All Time (AI cost)",
            value: `$${data.allTime.total.toFixed(4)}`,
            sub: `${data.allTime.calls} calls`,
          },
          {
            label: "Realized P&L (₹)",
            value: `${data.totalRealizedPnL >= 0 ? "+" : ""}₹${data.totalRealizedPnL.toFixed(2)}`,
            sub: "from closed trades",
            color:
              data.totalRealizedPnL >= 0 ? "text-emerald-400" : "text-red-400",
          },
        ].map(({ label, value, sub, color }) => (
          <div
            key={label}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4"
          >
            <div className="text-xs text-zinc-500 mb-1">{label}</div>
            <div className={`text-lg font-bold ${color || "text-white"}`}>
              {value}
            </div>
            <div className="text-xs text-zinc-600 mt-0.5">{sub}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-600 -mt-2">
        AI cost is in USD, realized P&L is in INR — shown side by side, not
        converted or combined (no live exchange rate wired up).
      </p>

      {/* Cost by signal type */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">
          Cost by Signal Type
        </h3>
        {data.bySignal.length === 0 ? (
          <p className="text-xs text-zinc-500">No AI calls recorded yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {data.bySignal
              .sort((a, b) => b.total - a.total)
              .map((s) => (
                <div
                  key={s.signal}
                  className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-2.5"
                >
                  <span
                    className={`text-xs font-bold ${SIGNAL_COLORS[s.signal] || "text-zinc-400"}`}
                  >
                    {s.signal}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {s.calls} call{s.calls === 1 ? "" : "s"}
                  </span>
                  <span className="text-sm text-white font-medium tabular-nums">
                    ${s.total.toFixed(4)}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
