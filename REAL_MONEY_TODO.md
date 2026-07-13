# Before switching from paper to real money

Things deliberately deferred while testing with paper trades — revisit before
any real capital goes through this bot.

## 1. Auto-buy doesn't re-check the 1% target floor against the live execution price

**Where:** `src/lib/attemptAutoBuy.js`

The server-side 1% minimum-target validation (`src/app/api/ai-signal/route.js`)
checks the AI's target against the price it was given *at analysis time*. AI
response latency is commonly 3-10s, sometimes more. If price drifts during
that window — even by less than the 1.5% threshold that triggers a full
re-analysis — the *real* remaining gap between live price and the AI's target
can fall below 1% by the time `attemptAutoBuy` actually executes the buy.
Manual buys are covered (the confirm dialog in `StockCard.jsx` uses the live
`stock.price` at click time), but auto-buy isn't.

**Fix (reverted on 2026-07-13, was working):** re-check
`(target - livePrice) / livePrice` right before calling `buyStock` inside
`attemptAutoBuy`, after the staleness/re-analysis block, and skip the buy if
it's fallen under 1%.

**Why deferred:** paper money — a few thin/no-edge trades slipping through
don't matter yet. Do this before real money is at risk.

## 2. ATR may underestimate intraday volatility

Discussed 2026-07-13 (TECHM stop-loss hit in 70s from ordinary noise). ATR-14
is Wilder-smoothed over the whole multi-day 5-minute window, so it reacts
slowly to a stock suddenly being more volatile *today* than its recent
history — the stop-loss can end up tighter than the real intraday noise,
causing premature stop-outs. VWAP is already session-scoped (only today's
candles); ATR isn't. Possible fix: compute a supplementary session-scoped ATR
(or a today's-realized-range floor) for intraday stop-sizing specifically.
Not implemented — needs a careful design pass, shared code with swing mode.
