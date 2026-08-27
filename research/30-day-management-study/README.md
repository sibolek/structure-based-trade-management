# 30-day management study

This study folder preserves the empirical research that motivated the ExecutionOS Management Governor while keeping the reusable calculations in `analytics/`.

## Commands

```bash
npm run analytics:test
npm run analytics:report
npm run analytics:duration
npm run analytics:stops
npm run analytics:r
npm run analytics:mfe
npm run analytics:capture
npm run analytics:counterfactuals
npm run research:30day-management
```

Without a recovered normalized source dataset, report commands run in preservation mode and print the historical benchmark from `expected-results.json`. They intentionally do not fabricate source trades.

When source data is recovered or reconstructed, run:

```bash
npm run analytics:report -- --input /path/to/normalized-trades.json
```

The reusable modules are designed to feed both command-line research and the future ExecutionOS review/analytics UI.
