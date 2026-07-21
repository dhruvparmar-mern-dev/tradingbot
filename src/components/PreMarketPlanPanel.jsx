"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Sunrise } from "lucide-react";
import Link from "next/link";

const STATUS_COLOR = {
  pending: "text-amber-400",
  confirmed: "text-emerald-400",
  invalidated: "text-red-400",
  expired: "text-zinc-500",
};

export default function PreMarketPlanPanel() {
  const [plans, setPlans] = useState(null);
  const [generating, setGenerating] = useState(false);

  const loadPlans = async () => {
    try {
      const res = await fetch("/api/premarket-plan");
      const data = await res.json();
      setPlans(data.plans || []);
    } catch (err) {
      console.error("Failed to load pre-market plans:", err);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- plain fetch-on-mount, matches the pattern already used elsewhere
    loadPlans();
  }, []);

  const generatePlans = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/premarket-plan", { method: "POST" });
      const data = await res.json();
      if (data.error) return toast.error(data.error);
      toast.success(`Planned ${data.planned} stocks for ${data.forDate}`);
      loadPlans();
    } catch (err) {
      toast.error("Plan generation failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Sunrise className="w-4 h-4 text-purple-400" />
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Pre-Market Plan
          </h2>
        </div>
        <button
          onClick={generatePlans}
          disabled={generating}
          className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          {generating ? "Generating…" : "Generate Tomorrow's Plan"}
        </button>
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        Free, no-AI check of each watchlist stock&apos;s chart as of today&apos;s
        close — run this near/after market close. Stocks in a clean uptrend
        with bullish MACD get a &quot;watch for continuation&quot; plan. At
        tomorrow&apos;s open, if auto-trade is on, the actual gap is checked
        against the plan every 20s — a confirming gap triggers real AI
        analysis immediately instead of waiting ~20-40 min for today&apos;s own
        volume confirmation to build up from scratch.
      </p>

      {plans === null && <p className="text-xs text-zinc-500">Loading…</p>}

      {plans?.length === 0 && (
        <p className="text-xs text-zinc-500">
          No plan for today yet. Click &quot;Generate Tomorrow&apos;s Plan&quot; the
          evening before to set one up.
        </p>
      )}

      {plans?.length > 0 && (
        <div className="flex flex-col gap-2">
          {plans.map((p) => (
            <Link
              key={p.symbol}
              href={`/stock/${p.symbol}`}
              className="flex items-center justify-between bg-zinc-800/50 hover:bg-zinc-800 rounded-lg px-3 py-2.5 transition-colors gap-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-white truncate">
                  {p.symbol?.replace(".NS", "")}
                </div>
                <div className="text-[11px] text-zinc-500 truncate">{p.reasoning}</div>
              </div>
              <span className={`text-xs font-medium shrink-0 ${STATUS_COLOR[p.status]}`}>
                {p.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
