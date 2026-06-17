"use client";
import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Search, Loader2, Plus, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";

export default function SearchModal({ open, onOpenChange }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [addingSymbol, setAddingSymbol] = useState(null);
  const inputRef = useRef(null);
  const { addToWatchlist, watchlist } = useTradingStore();

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => searchStocks(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const searchStocks = async (q) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };
  const handleRowClick = (stock) => {
    onOpenChange(false);
    router.push(`/stock/${stock.symbol}`);
  };

  const handleAddClick = async (e, stock) => {
    e.stopPropagation();
    setAddingSymbol(stock.symbol);
    try {
      const res = await fetch(`/api/stock?symbol=${stock.symbol}`);
      const fullData = await res.json();
      if (fullData.error) {
        toast.error("Could not fetch stock data");
        return;
      }
      await addToWatchlist(fullData);
      toast.success(`${stock.symbol.replace(".NS", "")} added to watchlist!`);
    } catch (err) {
      toast.error("Error adding stock");
    }
    setAddingSymbol(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-900 border-zinc-800 p-0 gap-0 max-w-lg top-[20%] translate-y-0">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <Search className="w-4 h-4 text-zinc-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by symbol or company name..."
            className="flex-1 bg-transparent text-white text-sm placeholder-zinc-500 focus:outline-none"
          />
          {loading && (
            <Loader2 className="w-4 h-4 text-zinc-500 animate-spin shrink-0" />
          )}
        </div>

        <div className="max-h-80 overflow-y-auto scrollbar-ghost">
          {!query.trim() && (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              Start typing a company name or symbol
            </div>
          )}

          {query.trim() && !loading && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-zinc-500">
              No results found for "{query}"
            </div>
          )}

          {results.map((stock) => {
            const alreadyAdded = watchlist.find(
              (w) => w.symbol === stock.symbol,
            );

            return (
              <div
                key={stock.symbol}
                onClick={() => handleRowClick(stock)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800 transition-colors text-left cursor-pointer group"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">
                    {stock.symbol.replace(".NS", "")}
                  </div>
                  <div className="text-xs text-zinc-500 truncate">
                    {stock.name}
                  </div>
                </div>

                <button
                  onClick={(e) => handleAddClick(e, stock)}
                  disabled={alreadyAdded || addingSymbol === stock.symbol}
                  className="flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 disabled:text-zinc-600 disabled:hover:bg-transparent disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg hover:bg-blue-500/10 transition-colors shrink-0 ml-2"
                >
                  {addingSymbol === stock.symbol ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : alreadyAdded ? (
                    <>
                      <Check className="w-3 h-3" />
                      Added
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" />
                      Add
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
