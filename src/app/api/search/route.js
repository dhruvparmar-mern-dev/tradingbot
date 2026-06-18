import { NextResponse } from "next/server";
import kite from "@/lib/kite";
import { connectDB } from "@/lib/mongoose";
import KiteSession from "@/models/KiteSession";
import { getNSEInstruments } from "@/lib/kiteInstruments";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim().toUpperCase();

  if (!query || query.length < 1) return NextResponse.json([]);

  try {
    await connectDB();
    const session = await KiteSession.findOne({ userId: "default" });

    if (!session?.accessToken) {
      return NextResponse.json([]);
    }

    kite.setAccessToken(session.accessToken);

    const instruments = await getNSEInstruments();

    const results = instruments
      .filter(
        (i) =>
          i.instrument_type === "EQ" &&
          (i.tradingsymbol.toUpperCase().includes(query) ||
            i.name?.toUpperCase().includes(query)),
      )
      .slice(0, 10)
      .map((i) => ({
        symbol: `${i.tradingsymbol}.NS`,
        name: i.name,
        exchange: "NSE",
      }));

    return NextResponse.json(results);
  } catch (err) {
    console.error("Search error:", err.message);
    return NextResponse.json([]);
  }
}
