"use client";
import useTradingStore from "@/store/tradingStore";
import { useTheme } from "next-themes";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { LogOut, Sun, Moon } from "lucide-react";
import KiteConnect from "./KiteConnect";
import { Suspense } from "react";

export default function SettingsPanel({ onLogout }) {
  const { theme, setTheme } = useTheme();
  const {
    autoTrade,
    minConfidence,
    maxPerTrade,
    tradingMode,
    dailyAiBudgetUSD,
    setAutoTrade,
    setMinConfidence,
    setMaxPerTrade,
    setTradingMode,
    setDailyAiBudgetUSD,
  } = useTradingStore();

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-base font-bold text-foreground">Settings</h2>

      <div className="flex items-center gap-2 flex-wrap lg:hidden">
        <span className="text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">
          Paper Trading
        </span>
        <Suspense fallback={null}>
          <KiteConnect />
        </Suspense>
      </div>

      <Separator className="lg:hidden" />

      {/* Trading mode — visible everywhere settings is open */}
      <div className="sm:hidden">
        <div className="text-sm font-medium text-foreground mb-2">
          Trading Mode
        </div>
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-1 w-fit">
          {["swing", "intraday"].map((mode) => (
            <button
              key={mode}
              onClick={() => setTradingMode(mode)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors ${
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

      <Separator className="sm:hidden" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {theme === "dark" ? (
            <Moon className="w-4 h-4 text-zinc-400" />
          ) : (
            <Sun className="w-4 h-4 text-zinc-400" />
          )}
          <span className="text-sm text-foreground">Theme</span>
        </div>
        <Switch
          checked={theme === "dark"}
          onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-foreground">
            Auto Trading
          </div>
          <div className="text-xs text-zinc-500">Bot trades automatically</div>
        </div>
        <Switch checked={autoTrade} onCheckedChange={setAutoTrade} />
      </div>

      <div>
        <div className="flex justify-between mb-2">
          <span className="text-sm text-zinc-300">Min Confidence</span>
          <span className="text-sm text-foreground font-medium">
            {minConfidence}/10
          </span>
        </div>
        <Slider
          min={5}
          max={10}
          step={1}
          value={[minConfidence]}
          onValueChange={([v]) => setMinConfidence(v)}
        />
      </div>

      <div>
        <div className="flex justify-between mb-2">
          <span className="text-sm text-zinc-300">Max per Trade</span>
          <span className="text-sm text-foreground font-medium">
            ₹{maxPerTrade.toLocaleString("en-IN")}
          </span>
        </div>
        <Slider
          min={1000}
          max={50000}
          step={1000}
          value={[maxPerTrade]}
          onValueChange={([v]) => setMaxPerTrade(v)}
        />
      </div>

      <div>
        <div className="flex justify-between mb-2">
          <span className="text-sm text-zinc-300">Daily AI Budget</span>
          <span className="text-sm text-foreground font-medium">
            ${dailyAiBudgetUSD.toFixed(2)}
          </span>
        </div>
        <Slider
          min={0.1}
          max={5}
          step={0.1}
          value={[dailyAiBudgetUSD]}
          onValueChange={([v]) => setDailyAiBudgetUSD(v)}
        />
      </div>

      <Separator />

      <Button
        onClick={onLogout}
        variant="destructive"
        size="sm"
        className="w-full gap-2"
      >
        <LogOut className="w-4 h-4" />
        Logout
      </Button>
    </div>
  );
}
