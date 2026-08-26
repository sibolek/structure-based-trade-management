# ExecutionOS analytics

This directory contains broker-agnostic, UI-agnostic analytical functions used by historical research, automated tests, future telemetry, and eventually the React review/analytics UI.

## Design rules

- Analytics modules are pure functions over normalized trade / market records.
- React components must not own analytical formulas.
- Broker-specific payload parsing stays in broker adapters / bridge code.
- Historical study methodology is preserved separately under `research/`.
- Production MFE/MAE supports scaling-aware realized + unrealized telemetry; legacy window analysis remains available to reproduce the original study.

## Modules

- `execution-metrics.mjs` — outcome counts and winner/loser duration statistics.
- `management-metrics.mjs` — stop-change timing and protective stop behavior.
- `r-metrics.mjs` — initial risk and realized R statistics.
- `mfe-mae.mjs` — legacy fixed-window excursion plus scaling-aware MFE_R / MAE_R.
- `capture-efficiency.mjs` — realized result versus favorable excursion.
- `counterfactuals.mjs` — fixed-duration exit counterfactuals.
- `index.mjs` — public analytics export surface.

## Normalized trade shape

The research runner accepts JSON with a top-level `trades` array. A trade may contain:

```js
{
  id,
  symbol,
  direction: "LONG" | "SHORT",
  entryAt,
  exitAt,
  entryPrice,
  initialQuantity,
  realizedPnl,
  initialStop,
  managementEvents: [
    { type: "STOP_CHANGED", timestamp, previousStop, newStop }
  ],
  marketSamples: [
    { timestamp, high, low, last }
  ]
}
```

The shape is intentionally broker-agnostic so Schwab and future NinjaTrader adapters can feed the same analytics.
