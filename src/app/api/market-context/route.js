import { NextResponse } from "next/server";

// Sector mapping for Indian stocks. Deliberately broader than just the
// largest names — market-scan surfaces stocks outside the usual watchlist,
// and those need real sector context too instead of falling back to UNKNOWN.
const SECTOR_MAP = {
  // IT
  TCS: "IT",
  INFY: "IT",
  WIPRO: "IT",
  HCLTECH: "IT",
  TECHM: "IT",
  LTIM: "IT",
  MPHASIS: "IT",
  COFORGE: "IT",
  PERSISTENT: "IT",
  LTTS: "IT",
  KPITTECH: "IT",
  OFSS: "IT",
  ZENSARTECH: "IT",
  // Banking
  HDFCBANK: "BANKING",
  ICICIBANK: "BANKING",
  SBIN: "BANKING",
  KOTAKBANK: "BANKING",
  AXISBANK: "BANKING",
  BANDHANBNK: "BANKING",
  INDUSINDBK: "BANKING",
  FEDERALBNK: "BANKING",
  IDFCFIRSTB: "BANKING",
  AUBANK: "BANKING",
  RBLBANK: "BANKING",
  YESBANK: "BANKING",
  PNB: "PSU_BANK",
  BANKBARODA: "PSU_BANK",
  CANBK: "PSU_BANK",
  UNIONBANK: "PSU_BANK",
  // Auto
  MARUTI: "AUTO",
  TATAMOTORS: "AUTO",
  BAJAJ_AUTO: "AUTO",
  HEROMOTOCO: "AUTO",
  EICHERMOT: "AUTO",
  M_M: "AUTO",
  ASHOKLEY: "AUTO",
  TVSMOTOR: "AUTO",
  BHARATFORG: "AUTO",
  MOTHERSON: "AUTO",
  BOSCHLTD: "AUTO",
  // Pharma
  SUNPHARMA: "PHARMA",
  DRREDDY: "PHARMA",
  CIPLA: "PHARMA",
  DIVISLAB: "PHARMA",
  APOLLOHOSP: "PHARMA",
  LUPIN: "PHARMA",
  AUROPHARMA: "PHARMA",
  BIOCON: "PHARMA",
  ALKEM: "PHARMA",
  TORNTPHARM: "PHARMA",
  ZYDUSLIFE: "PHARMA",
  // Energy
  RELIANCE: "ENERGY",
  ONGC: "ENERGY",
  NTPC: "ENERGY",
  POWERGRID: "ENERGY",
  BPCL: "ENERGY",
  IOC: "ENERGY",
  GAIL: "ENERGY",
  ADANIGREEN: "ENERGY",
  TATAPOWER: "ENERGY",
  ADANIPOWER: "ENERGY",
  // FMCG
  HINDUNILVR: "FMCG",
  ITC: "FMCG",
  NESTLEIND: "FMCG",
  BRITANNIA: "FMCG",
  DABUR: "FMCG",
  MARICO: "FMCG",
  GODREJCP: "FMCG",
  COLPAL: "FMCG",
  TATACONSUM: "FMCG",
  VBL: "FMCG",
  // Metals
  TATASTEEL: "METALS",
  JSWSTEEL: "METALS",
  HINDALCO: "METALS",
  COALINDIA: "METALS",
  VEDL: "METALS",
  SAIL: "METALS",
  JINDALSTEL: "METALS",
  NMDC: "METALS",
  HINDZINC: "METALS",
  // Finance / NBFC
  BAJFINANCE: "FINANCE",
  BAJAJFINSV: "FINANCE",
  HDFCLIFE: "FINANCE",
  SBILIFE: "FINANCE",
  SBICARD: "FINANCE",
  CHOLAFIN: "FINANCE",
  MUTHOOTFIN: "FINANCE",
  ICICIPRULI: "FINANCE",
  ICICIGI: "FINANCE",
  PFC: "FINANCE",
  RECLTD: "FINANCE",
  // Realty
  DLF: "REALTY",
  LODHA: "REALTY",
  GODREJPROP: "REALTY",
  OBEROIRLTY: "REALTY",
  PHOENIXLTD: "REALTY",
  PRESTIGE: "REALTY",
};

const SECTOR_ETF = {
  IT: "NIFTY_IT.NS",
  BANKING: "NIFTYBANK.NS",
  PSU_BANK: "NIFTY_PSU_BANK.NS",
  AUTO: "NIFTY_AUTO.NS",
  PHARMA: "NIFTY_PHARMA.NS",
  ENERGY: "RELIANCE.NS",
  FMCG: "NIFTY_FMCG.NS",
  METALS: "NIFTY_METAL.NS",
  FINANCE: "NIFTY_FIN_SERVICE.NS",
  REALTY: "NIFTY_REALTY.NS",
};

async function fetchQuote(symbol) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    );
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) return null;
    const change =
      ((meta.regularMarketPrice - meta.chartPreviousClose) /
        meta.chartPreviousClose) *
      100;
    return {
      price: meta.regularMarketPrice,
      change: parseFloat(change.toFixed(2)),
      volume: meta.regularMarketVolume,
    };
  } catch {
    return null;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  const cleanSymbol = symbol?.replace(/\.(NS|BO)$/i, "").toUpperCase();
  const sector = SECTOR_MAP[cleanSymbol] || "UNKNOWN";
  const sectorSymbol = SECTOR_ETF[sector];

  try {
    // Fetch NIFTY 50 + sector in parallel
    const [nifty, sectorData] = await Promise.all([
      fetchQuote("^NSEI"),
      sectorSymbol ? fetchQuote(sectorSymbol) : Promise.resolve(null),
    ]);

    // Market sentiment
    let marketSentiment = "NEUTRAL";
    if (nifty?.change > 0.5) marketSentiment = "BULLISH";
    else if (nifty?.change < -0.5) marketSentiment = "BEARISH";

    // Sector sentiment
    let sectorSentiment = "NEUTRAL";
    if (sectorData?.change > 0.5) sectorSentiment = "BULLISH";
    else if (sectorData?.change < -0.5) sectorSentiment = "BEARISH";

    return NextResponse.json({
      nifty: {
        price: nifty?.price,
        change: nifty?.change,
        sentiment: marketSentiment,
      },
      sector: {
        name: sector,
        change: sectorData?.change || null,
        sentiment: sectorSentiment,
      },
      marketSentiment,
      summary: `NIFTY ${nifty?.change >= 0 ? "▲" : "▼"} ${Math.abs(nifty?.change || 0).toFixed(2)}% | ${sector} sector ${sectorData?.change >= 0 ? "▲" : "▼"} ${Math.abs(sectorData?.change || 0).toFixed(2)}%`,
    });
  } catch (err) {
    console.error("Market context error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
