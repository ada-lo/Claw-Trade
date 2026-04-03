# Intent Model

Trade intents are submitted as a structured envelope:

```json
{
  "id": "intent-123",
  "actor_id": "openclaw-trader",
  "session_id": "demo-session",
  "created_at": "2026-04-03T03:23:04.246Z",
  "nonce": "unique-per-intent",
  "intent": {
    "type": "trade",
    "tool": "alpaca.place_order",
    "action": "buy",
    "ticker": "AAPL",
    "asset_class": "us_equity",
    "quantity": 10,
    "limit_price": 150
  },
  "context": {
    "channel": "openclaw",
    "raw_inputs": [
      "Buy 10 shares of AAPL if policy allows it."
    ]
  },
  "evidence": {
    "sources": [
      { "provider": "alpaca", "uri": "alpaca://quotes/AAPL" },
      { "provider": "reuters", "uri": "reuters://news/AAPL" }
    ]
  },
  "state": {
    "market_hours_open": true,
    "current_daily_notional_usd": 0,
    "current_portfolio_exposure_usd": 0,
    "prior_trade_count_1m": 0,
    "focused_tickers": ["AAPL"]
  }
}
```

## Required Fields

- `id`, `actor_id`, `session_id`, `created_at`, `nonce`
- `intent.type`, `intent.tool`
- For trades: `intent.action`, `intent.ticker`, `intent.asset_class`, `intent.quantity`, `intent.limit_price`

## Why This Shape

- It is explicit enough for deterministic validation.
- It carries source provenance for the data-trust layer.
- It carries enough state for exposure, rate, and market-hours checks.
- It gives the signer and audit log a stable object to hash and prove later.
