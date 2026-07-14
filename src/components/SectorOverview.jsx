"use client";
import { useState, useEffect } from "react";
import { BarChart3 } from "lucide-react";

export default function SectorOverview() {
  const [sectors, setSectors] = useState(null);

  useEffect(() => {
    fetch("/api/sector-overview")
      .then((r) => r.json())
      .then((data) => setSectors(data.sectors || []))
      .catch(() => setSectors([]));
  }, []);

  if (!sectors?.length) return null;

  return (
    <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-blue-400" />
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Sector Overview
        </h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {sectors.map((s) => (
          <div
            key={s.name}
            className={`text-xs px-2.5 py-1.5 rounded-lg tabular-nums ${
              s.change >= 0
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-red-500/10 text-red-400"
            }`}
          >
            {s.name.replace("_", " ")} {s.change >= 0 ? "+" : ""}
            {s.change}%
          </div>
        ))}
      </div>
    </div>
  );
}
