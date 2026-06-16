import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";

// Cache instruments globally
let cachedInstruments = null;
let cacheTime = null;

export async function GET(request) {
  await connectDB();
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  const session = await KiteSession.findOne({ userId: "default" });
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not connected" }, { status: 401 });
  }

  kite.setAccessToken(session.accessToken);

  try {
    const cleanSymbol = symbol.replace(".NS", "").replace(".BO", "");

    // Use cache if less than 1 hour old
    if (!cachedInstruments || !cacheTime || Date.now() - cacheTime > 3600000) {
      cachedInstruments = await kite.getInstruments("NSE");
      cacheTime = Date.now();
    }

    const instrument = cachedInstruments.find(
      (i) => i.tradingsymbol === cleanSymbol,
    );

    if (!instrument) {
      return NextResponse.json(
        { error: "Instrument not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      token: instrument.instrument_token,
      symbol: instrument.tradingsymbol,
      name: instrument.name,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
