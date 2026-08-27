# ExecutionOS End-of-Day Report

## Purpose

The EOD reporter creates a close-of-business summary from Schwab's read-only execution history and the existing ExecutionOS trade-state engine. It is a reporting utility only: it does not place, replace, cancel, or modify broker orders.

The default command is:

```bash
npm run schwab:eod
```

It prints a terminal summary and writes a self-contained HTML report to:

```text
reports/eod/YYYY-MM-DD.html
```

## What the broker-only report contains

Without any browser-history export, the report still reconstructs complete same-day Schwab trade cycles and shows:

- completed trade cycles
- open reconstructed cycles
- winners / losers / flat trades
- win rate
- reconstructed gross realized P/L
- average winner / loser
- profit factor
- largest winner / loser
- symbol, side, peak quantity, entry VWAP, exit VWAP and realized P/L per trade
- current 0.5% risk snapshot when the local Schwab monitor is running

## Important position-context rule

The reporter never invents a cost basis.

If a symbol's first same-day execution is a `CLOSING` fill, that position may have been opened before the report window. Those execution legs are excluded from reconstructed P/L and the report is explicitly marked context-incomplete.

This is especially important for swing positions that are reduced or closed during the day.

Accordingly, when context warnings appear, the displayed gross realized P/L is **not** presented as a definitive whole-account daily P/L total. It is the realized P/L reconstructed from complete-context Schwab fill cycles only.

## Add ExecutionOS plan / risk / process data

ExecutionOS V2.3 stores completed Trade Contracts in browser local storage. A terminal process cannot read Chrome local storage directly, so the repository includes a same-origin export helper.

With the Vite app running on the same `localhost:5173` origin used for ExecutionOS, open:

```text
http://localhost:5173/eod-export.html
```

Click:

```text
DOWNLOAD EXECUTIONOS EOD HISTORY
```

The helper reads only the browser's `execution-v23-store` history and downloads a local JSON file named like:

```text
executionos-eod-history-2026-08-27.json
```

It does not contact Schwab.

After downloading, run:

```bash
npm run schwab:eod
```

The reporter automatically uses the newest `executionos-eod-history-*.json` file in `~/Downloads` when present.

You can also specify one explicitly:

```bash
npm run schwab:eod -- --executionos=~/Downloads/executionos-eod-history-2026-08-27.json
```

When an ExecutionOS history export is loaded, matching uses symbol, direction and entry-detection time, with a five-minute maximum matching window.

Matched ExecutionOS-owned trades add:

- setup and timeframe
- thesis
- trigger
- invalidation
- structural stop
- target
- management plan
- expected entry and intended size
- original planned dollar risk
- entry-VWAP stop risk at peak reconstructed quantity
- realized R multiple using original planned risk
- exit classification and reason
- lifecycle decision timeline
- `THREATENED`, `THREATENED → VALID`, and `INVALID` transition counts

Unmatched completed Schwab cycles are labeled broker-only when an ExecutionOS export was supplied.

## Other options

Specific date:

```bash
npm run schwab:eod -- --date=2026-08-27
```

Single symbol:

```bash
npm run schwab:eod -- --date=2026-08-27 --symbol=NVDA
```

Custom HTML path:

```bash
npm run schwab:eod -- --out=~/Desktop/eod-2026-08-27.html
```

The date is interpreted in the local machine timezone.

## Risk interpretation

`planned risk` is computed from the frozen ExecutionOS Trade Contract:

```text
abs(expected entry - structural stop) × intended size
```

`R` is computed as:

```text
reconstructed realized gross P/L / original planned risk
```

The optional COB risk snapshot is read from the already-running local read-only monitor API. It is labeled as a current close-of-business snapshot and is **not** treated as the historical frozen 0.5% budget for each trade because V2.3 did not persist that budget inside completed Trade Contracts.

## Validation

The pure reconstruction/enrichment logic is covered by `tests/eod-report.test.mjs`, including:

- scaled long entry
- partial exit
- full exit and gross P/L
- short trade cycle
- closing-first context protection
- ExecutionOS history matching
- planned risk and R calculation
- structural-state transition statistics
