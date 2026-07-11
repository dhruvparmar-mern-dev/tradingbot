import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import Stock from "@/models/Stock";

// Atomically flips lastAnalysis.acted from falsy -> true, but only if it was
// still falsy at the moment of the write. Two callers can race here (the 30s
// poll and an immediate post-analysis trigger both reaching this at once) —
// Mongo's findOneAndUpdate with a match condition on the current value makes
// this a compare-and-swap, so only one of them ever gets claimed: true. The
// other must back off instead of also executing a buy.
export async function POST(request) {
  await connectDB();
  const { symbol, mode } = await request.json();
  const field = `memory${mode.charAt(0).toUpperCase() + mode.slice(1)}`;

  const updated = await Stock.findOneAndUpdate(
    {
      symbol,
      [`${field}.lastAnalysis.signal`]: "BUY",
      [`${field}.lastAnalysis.acted`]: { $ne: true },
    },
    {
      $set: {
        [`${field}.lastAnalysis.acted`]: true,
        [`${field}.lastAnalysis.actedAt`]: new Date(),
      },
    },
    { new: true },
  );

  return NextResponse.json({ claimed: !!updated });
}
