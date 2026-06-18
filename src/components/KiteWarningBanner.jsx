"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

export default function KiteWarningBanner() {
  const [connected, setConnected] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 60000); // recheck every 1 min
    return () => clearInterval(interval);
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch("/api/kite/status");
      const data = await res.json();
      setConnected(data.connected);
    } catch {
      setConnected(false);
    }
    setChecked(true);
  };

  if (!checked || connected) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2 flex items-center justify-center gap-2 text-xs text-amber-400">
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      <span>
        Kite not connected — using delayed prices (Yahoo Finance).{" "}
        <a
          href="/api/kite/login"
          className="underline hover:text-amber-300 font-medium"
        >
          Connect now
        </a>
      </span>
    </div>
  );
}
