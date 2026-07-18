import { useEffect, useRef, useCallback } from "react";
import useTradingStore from "@/store/tradingStore";
import { toast } from "sonner";

// Kite instrument tokens for NSE stocks
// These are fixed tokens from Zerodha
const INSTRUMENT_TOKENS = {
  "RELIANCE.NS": 738561,
  "TCS.NS": 2953217,
  "HDFCBANK.NS": 341249,
  "INFY.NS": 408065,
  "ICICIBANK.NS": 1270529,
  "BHARTIARTL.NS": 2714625,
  "LT.NS": 2939649,
  "WIPRO.NS": 3787777,
  "HCLTECH.NS": 1850625,
  "TECHM.NS": 3465729,
  "ADANIENT.NS": 25601,
  "TATAMOTORS.NS": 884737,
  "BAJFINANCE.NS": 738561,
  "SBIN.NS": 779521,
  "MRF.NS": 225537,
};

export default function useKiteWebSocket() {
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const isConnectedRef = useRef(false);
  const tokenMapRef = useRef({});

  const connect = useCallback(async () => {
    try {
      const kiteRes = await fetch("/api/kite/status");
      const { connected: kiteConnected } = await kiteRes.json();
      if (!kiteConnected) return;

      const res = await fetch("/api/kite/websocket");
      if (!res.ok) return;

      const { accessToken, apiKey } = await res.json();

      if (!accessToken) return;

      let watchlist = useTradingStore.getState().watchlist;
      let attempts = 0;
      while (watchlist.length === 0 && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        watchlist = useTradingStore.getState().watchlist;
        attempts++;
      }

      if (!watchlist.length) return;

      //   // Get tokens for watchlist stocks
      //   const tokens = watchlist
      //     .map((s) => INSTRUMENT_TOKENS[s.symbol])
      //     .filter(Boolean);

      //   if (!tokens.length) return;

      // Fetch instrument tokens dynamically
      const tokenMap = {};
      await Promise.all(
        watchlist.map(async (s) => {
          try {
            const r = await fetch(`/api/kite/instruments?symbol=${s.symbol}`);
            const data = await r.json();
            if (data.token) tokenMap[s.symbol] = data.token;
          } catch (err) {
            console.error("🔴 Token fetch failed for", s.symbol, err);
          }
        }),
      );

      const tokens = Object.values(tokenMap).map((t) => Number(t)); // ← Number() se explicitly convert

      if (!tokens.length) return;
      tokenMapRef.current = tokenMap;

      // Connect to Kite WebSocket
      const ws = new WebSocket(
        `wss://ws.kite.trade?api_key=${apiKey}&access_token=${accessToken}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        isConnectedRef.current = true;

        const subscribeMsg = { a: "subscribe", v: tokens };
        const modeMsg = { a: "mode", v: ["full", tokens] };
        ws.send(JSON.stringify(subscribeMsg));
        ws.send(JSON.stringify(modeMsg));

        toast.success("📡 Live prices connected!");
      };

      ws.onmessage = (event) => {
        if (event.data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            parseTick(reader.result);
          };
          reader.onerror = (err) => {
            console.error("🔴 [12-ERR] FileReader error:", err);
          };
          reader.readAsArrayBuffer(event.data);
        }
      };

      ws.onclose = (event) => {
        isConnectedRef.current = false;

        fetch("/api/kite/status")
          .then((r) => r.json())
          .then(({ connected }) => {
            if (connected) {
              reconnectRef.current = setTimeout(connect, 5000);
            }
          });
        // // Auto reconnect after 5 seconds
        // reconnectRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        toast.error("Live prices disconnected — please reconnect Kite");
        ws.close();
      };
    } catch (err) {
      console.error("🔴 [ERR] WebSocket connect error:", err);
    }
  }, []);

  const parseTick = useCallback((buffer) => {
    try {
      const view = new DataView(buffer);
      if (buffer.byteLength < 2) {
        return;
      }

      const numPackets = view.getInt16(0);
      let offset = 2;
      const ticks = [];

      for (let i = 0; i < numPackets; i++) {
        if (offset + 2 > buffer.byteLength) {
          break;
        }
        const packetLength = view.getInt16(offset);
        offset += 2;

        if (packetLength >= 44) {
          const token = view.getInt32(offset);
          const lastPrice = view.getInt32(offset + 4) / 100;
          const volume = view.getInt32(offset + 16); // ← volume yahan hai, high/low nahi
          const open = view.getInt32(offset + 28) / 100; // ← sahi offset
          const high = view.getInt32(offset + 32) / 100; // ← sahi offset
          const low = view.getInt32(offset + 36) / 100; // ← sahi offset
          const close = view.getInt32(offset + 40) / 100; // ← sahi offset
          const change = close > 0 ? ((lastPrice - close) / close) * 100 : 0;

          //   // Find symbol by token
          const symbol = Object.keys(tokenMapRef.current).find(
            (k) => Number(tokenMapRef.current[k]) === token,
          );

          if (symbol) {
            ticks.push({
              symbol,
              price: lastPrice,
              high,
              low,
              open,
              prevClose: close,
              volume,
              change,
            });
          }
        }
        offset += packetLength;
      }

      if (ticks.length > 0) {
        // Update store with live prices
        useTradingStore.setState((state) => ({
          watchlist: state.watchlist.map((s) => {
            const tick = ticks.find((t) => t.symbol === s.symbol);
            return tick ? { ...s, ...tick } : s;
          }),
          portfolio: state.portfolio.map((s) => {
            const tick = ticks.find((t) => t.symbol === s.symbol);
            return tick ? { ...s, price: tick.price, change: tick.change } : s;
          }),
        }));

        // Check stop loss / target for each tick
        checkStopLossTarget(ticks);
      }
    } catch (err) {
      console.error("🔴 [ERR] Tick parse error:", err);
    }
  }, []);

  const checkStopLossTarget = useCallback(async (ticks) => {
    const { portfolio, sellStock, tradingMode } = useTradingStore.getState();

    for (const tick of ticks) {
      // filter, not find -- the same symbol can be held under both swing and
      // intraday at once, each with its own target/stop-loss to check.
      const holdings = portfolio.filter((p) => p.symbol === tick.symbol);

      for (const holding of holdings) {
        const holdingMode = holding.mode || tradingMode;

        try {
          const memory = await useTradingStore
            .getState()
            .getMemory(tick.symbol, holdingMode);
          if (!memory?.lastAnalysis) continue;

          const { stopLoss, target } = memory.lastAnalysis;
          // const targetBuffer = target * 0.998; // 0.2% buffer
          if (target && tick.price >= target) {
            await sellStock(
              holding.symbol,
              holding.quantity,
              tick.price,
              holdingMode,
            );
            await fetch("/api/outcome", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol: holding.symbol,
                outcome: "WIN",
                price: tick.price,
                mode: holdingMode,
              }),
            });
            toast.success(
              `🎯 Target hit! Sold ${holding.symbol?.replace(".NS", "")} at ₹${tick.price}`,
            );
          } else if (stopLoss && tick.price <= stopLoss) {
            await sellStock(
              holding.symbol,
              holding.quantity,
              tick.price,
              holdingMode,
            );
            await fetch("/api/outcome", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                symbol: holding.symbol,
                outcome: "LOSS",
                price: tick.price,
                mode: holdingMode,
              }),
            });
            toast.error(
              `🛑 Stop loss hit! Sold ${holding.symbol?.replace(".NS", "")} at ₹${tick.price}`,
            );
          }
        } catch (err) {
          console.error("Stop loss check error:", err);
        }
      }
    }
  }, []);

  // Adds one more symbol to the already-open subscription instead of
  // tearing down and reconnecting the whole socket — used when a stock is
  // added to the watchlist after this hook's initial connect() already ran.
  const subscribeSymbol = useCallback(async (symbol) => {
    if (tokenMapRef.current[symbol]) return;
    try {
      const r = await fetch(`/api/kite/instruments?symbol=${symbol}`);
      const data = await r.json();
      if (!data.token) return;
      tokenMapRef.current[symbol] = data.token;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const token = Number(data.token);
        wsRef.current.send(JSON.stringify({ a: "subscribe", v: [token] }));
        wsRef.current.send(JSON.stringify({ a: "mode", v: ["full", [token]] }));
      }
    } catch (err) {
      console.error("🔴 Failed to subscribe new symbol", symbol, err);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  // Exposed via the store (not props) since addToWatchlist lives in
  // tradingStore.js, outside the React tree.
  useEffect(() => {
    useTradingStore.setState({ subscribeToLiveTicks: subscribeSymbol });
  }, [subscribeSymbol]);

  return { isConnected: isConnectedRef.current };
}
