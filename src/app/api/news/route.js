import { NextResponse } from "next/server";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  const cleanSymbol = symbol.replace(/\.(NS|BO)$/i, "");

  try {
    const res = await fetch(
      `https://news.google.com/rss/search?q=${cleanSymbol}+NSE+stock&hl=en-IN&gl=IN&ceid=IN:en`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    );

    const text = await res.text();
    const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];

    if (items.length === 0) {
      return NextResponse.json([]);
    }

    const MAX_AGE_DAYS = 45; // older news is unlikely to still be moving the stock
    const now = Date.now();

    const news = items
      .map((match) => {
        const item = match[1];
        const title =
          item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ||
          item.match(/<title>(.*?)<\/title>/)?.[1] ||
          "No title";
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
        const source =
          item.match(/<source[^>]*>(.*?)<\/source>/)?.[1] || "Google News";
        const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "#";
        const pubTimestamp = pubDate ? Date.parse(pubDate) : NaN;
        const daysAgo = Number.isNaN(pubTimestamp)
          ? null
          : Math.floor((now - pubTimestamp) / (1000 * 60 * 60 * 24));

        return { title, pubDate, source, link, daysAgo };
      })
      .filter((n) => n.daysAgo === null || n.daysAgo <= MAX_AGE_DAYS)
      .sort((a, b) => (a.daysAgo ?? Infinity) - (b.daysAgo ?? Infinity))
      .slice(0, 6);

    return NextResponse.json(news);
  } catch (err) {
    console.error("News error:", err.message);
    return NextResponse.json([]);
  }
}
