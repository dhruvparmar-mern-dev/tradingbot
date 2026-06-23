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
      console.log("🔹 [1] connect() called");

      const kiteRes = await fetch("/api/kite/status");
      const { connected: kiteConnected } = await kiteRes.json();
      console.log("🔹 [2] Kite status:", kiteConnected);
      if (!kiteConnected) return;

      const res = await fetch("/api/kite/websocket");
      console.log("🔹 [3] /api/kite/websocket response ok:", res.ok);
      if (!res.ok) return;

      const { accessToken, apiKey } = await res.json();
      console.log(
        "🔹 [4] accessToken exists:",
        !!accessToken,
        "apiKey exists:",
        !!apiKey,
      );
      if (!accessToken) return;

      let watchlist = useTradingStore.getState().watchlist;
      let attempts = 0;
      while (watchlist.length === 0 && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        watchlist = useTradingStore.getState().watchlist;
        attempts++;
      }
      console.log(
        "🔹 [5] watchlist length after wait:",
        watchlist.length,
        "attempts:",
        attempts,
      );
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
      console.log(
        "🔹 [6] Final tokens count:",
        tokens.length,
        "tokenMap:",
        tokenMap,
        "tokens:",
        tokens,
      );

      if (!tokens.length) return;
      tokenMapRef.current = tokenMap;

      // Connect to Kite WebSocket
      const ws = new WebSocket(
        `wss://ws.kite.trade?api_key=${apiKey}&access_token=${accessToken}`,
      );
      wsRef.current = ws;
      console.log("🔹 [7] WebSocket object created");

      ws.onopen = () => {
        isConnectedRef.current = true;
        console.log(
          "✅ [8] Kite WS connected at",
          new Date().toLocaleTimeString(),
        );

        const subscribeMsg = { a: "subscribe", v: tokens };
        const modeMsg = { a: "mode", v: ["full", tokens] };
        console.log("🔹 [9] Sending subscribe:", JSON.stringify(subscribeMsg));
        console.log("🔹 [10] Sending mode:", JSON.stringify(modeMsg));
        ws.send(JSON.stringify(subscribeMsg));
        ws.send(JSON.stringify(modeMsg));

        toast.success("📡 Live prices connected!");
      };

      ws.onmessage = (event) => {
        console.log(
          "🔹 [11] onmessage fired, type:",
          typeof event.data,
          "isBlob:",
          event.data instanceof Blob,
        );
        if (event.data instanceof Blob) {
          const reader = new FileReader();
          reader.onload = () => {
            console.log(
              "🔹 [12] FileReader onload, byteLength:",
              reader.result?.byteLength,
            );
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
        console.log(
          "❌ [13] Kite WS disconnected at",
          new Date().toLocaleTimeString(),
          "code:",
          event.code,
          "reason:",
          event.reason,
        );

        fetch("/api/kite/status")
          .then((r) => r.json())
          .then(({ connected }) => {
            console.log("🔹 [14] Reconnect check, still connected:", connected);
            if (connected) {
              reconnectRef.current = setTimeout(connect, 5000);
            }
          });
        // // Auto reconnect after 5 seconds
        // reconnectRef.current = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.error("🔴 [15] WebSocket onerror:", err);
        toast.error("Live prices disconnected — please reconnect Kite");
        ws.close();
      };
    } catch (err) {
      console.error("🔴 [ERR] WebSocket connect error:", err);
    }
  }, []);

  const parseTick = useCallback((buffer) => {
    try {
      console.log("🔹 [16] parseTick called, byteLength:", buffer.byteLength);
      const view = new DataView(buffer);
      if (buffer.byteLength < 2) {
        console.log("🔹 [17] Heartbeat/tiny packet, skipping");
        return;
      }

      const numPackets = view.getInt16(0);
      console.log("🔹 [18] numPackets:", numPackets);
      let offset = 2;
      const ticks = [];

      for (let i = 0; i < numPackets; i++) {
        if (offset + 2 > buffer.byteLength) {
          console.log("🔹 [19] Breaking — offset exceeds buffer at packet", i);
          break;
        }
        const packetLength = view.getInt16(offset);
        console.log(`🔹 [20] Packet ${i} length:`, packetLength);
        offset += 2;

        if (packetLength >= 44) {
          const token = view.getInt32(offset);
          const lastPrice = view.getInt32(offset + 4) / 100;
          const high = view.getInt32(offset + 16) / 100;
          const low = view.getInt32(offset + 20) / 100;
          const open = view.getInt32(offset + 24) / 100;
          const close = view.getInt32(offset + 28) / 100;
          const volume = view.getInt32(offset + 32);
          const change = close > 0 ? ((lastPrice - close) / close) * 100 : 0;

          console.log(`🔹 [21] Packet ${i} token:`, token, "price:", lastPrice);
          //   // Find symbol by token
          //   const symbol = Object.keys(INSTRUMENT_TOKENS).find(
          //     (k) => INSTRUMENT_TOKENS[k] === token,
          //   );

          const symbol = Object.keys(tokenMapRef.current).find(
            (k) => tokenMapRef.current[k] === token,
          );
          console.log(
            `🔹 [22] Matched symbol for token ${token}:`,
            symbol || "NO MATCH",
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
        } else {
          console.log(
            `🔹 [23] Packet ${i} too small (${packetLength} bytes), skipping`,
          );
        }
        offset += packetLength;
      }

      console.log("🔹 [24] Total ticks extracted:", ticks.length);

      if (ticks.length > 0) {
        // Update store with live prices
        console.log(
          "🟢 [25] WS ticks received:",
          ticks.map((t) => `${t.symbol}: ₹${t.price}`).join(", "),
        );

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

        console.log("🔹 [26] Store updated with new ticks");

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
      const holding = portfolio.find((p) => p.symbol === tick.symbol);
      if (!holding) continue;

      try {
        const memRes = await fetch(
          `/api/memory?symbol=${tick.symbol}&mode=${tradingMode}`,
        );
        const memory = await memRes.json();
        if (!memory?.lastAnalysis) continue;

        const { stopLoss, target } = memory.lastAnalysis;

        const targetBuffer = target * 0.998; // 0.2% buffer
        if (target && currentPrice >= targetBuffer) {
          await sellStock(holding.symbol, holding.quantity, tick.price);
          await fetch("/api/outcome", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: holding.symbol,
              outcome: "WIN",
              price: tick.price,
              mode: tradingMode,
            }),
          });
          toast.success(
            `🎯 Target hit! Sold ${holding.symbol?.replace(".NS", "")} at ₹${tick.price}`,
          );
        } else if (stopLoss && tick.price <= stopLoss) {
          await sellStock(holding.symbol, holding.quantity, tick.price);
          await fetch("/api/outcome", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: holding.symbol,
              outcome: "LOSS",
              price: tick.price,
              mode: tradingMode,
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
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  return { isConnected: isConnectedRef.current };
}
