"use client";
import { useState } from "react";
import { Search, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import useTradingStore from "@/store/tradingStore";
import KiteConnect from "./KiteConnect";
import SettingsPanel from "./SettingsPanel";
import { Suspense } from "react";
import { usePathname } from "next/navigation";
import SearchModal from "./SearchModal";

export default function Navbar() {
  const pathname = usePathname();
  const { balance, tradingMode, setTradingMode } = useTradingStore();
  const [searchOpen, setSearchOpen] = useState(false);

  if (pathname === "/login") return null;

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <>
      <div className="border-b border-zinc-800 px-3 md:px-6 py-3 grid grid-cols-[auto_1fr_auto] items-center gap-2 md:gap-3">
        {/* Left — Logo + badges */}
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl shrink-0">📈</span>
          <h1 className="text-base font-bold hidden sm:block whitespace-nowrap">
            TradingBot
          </h1>

          <div className="hidden lg:flex items-center gap-2 ml-1">
            <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full whitespace-nowrap">
              Paper Trading
            </span>
            <Suspense fallback={null}>
              <KiteConnect />
            </Suspense>
          </div>
        </div>

        {/* Center — Search (desktop) + mode toggle */}
        <div className="flex items-center justify-center gap-3 min-w-0">
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden md:flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-sm px-4 py-1.5 rounded-lg transition-colors w-full max-w-64 shrink-0"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Search stocks...</span>
          </button>

          <div className="hidden sm:flex gap-1 bg-zinc-800 rounded-lg p-1 shrink-0">
            {["swing", "intraday"].map((mode) => (
              <button
                key={mode}
                onClick={() => setTradingMode(mode)}
                className={`px-2.5 md:px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                  tradingMode === mode
                    ? mode === "intraday"
                      ? "bg-orange-500 text-white"
                      : "bg-blue-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {mode === "intraday" ? "⚡ Intraday" : "📅 Swing"}
              </button>
            ))}
          </div>
        </div>

        {/* Right — Search icon (mobile) + Balance + Settings */}
        <div className="flex items-center gap-1.5 md:gap-3 justify-end">
          {/* Mobile search icon */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSearchOpen(true)}
            className="md:hidden text-zinc-400 hover:text-white"
          >
            <Search className="w-5 h-5" />
          </Button>

          <div className="text-right shrink-0">
            <div className="text-[10px] md:text-xs text-zinc-500 leading-tight">
              Balance
            </div>
            <div className="text-xs md:text-lg font-bold whitespace-nowrap tabular-nums">
              ₹
              {balance?.toLocaleString("en-IN", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-zinc-400 hover:text-white shrink-0"
              >
                <SettingsIcon className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-72 bg-zinc-900 border-zinc-800 p-4"
            >
              <SettingsPanel onLogout={handleLogout} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}
