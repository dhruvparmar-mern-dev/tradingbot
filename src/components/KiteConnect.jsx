"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

export default function KiteConnect() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();

  useEffect(() => {
    checkStatus();

    // Check if redirected back from Kite
    const kiteParam = searchParams.get("kite");
    if (kiteParam === "connected")
      toast.success("Kite connected! Live prices active 🎉");
    if (kiteParam === "error") toast.error("Kite connection failed, try again");
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/kite/status");
      const data = await res.json();
      setConnected(data.connected);
    } catch {
      setConnected(false);
    }
    setLoading(false);
  };

  if (loading) return null;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${
        connected
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          : "bg-zinc-800 border-zinc-700 text-zinc-400"
      }`}
    >
      <div
        className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-zinc-500"}`}
      />
      {connected ? (
        "Kite Live"
      ) : (
        <a
          href="/api/kite/login"
          className="hover:text-white transition-colors"
        >
          Connect Kite
        </a>
      )}
    </div>
  );
}
