# ExecutionOS End-of-Day Report

**Status:** Current read-only reporting reference  
**Added:** 27 August 2026  
**Current branch:** `main`  
**Implementation merge:** PR #7, merge commit `bedd70979a3b18844386bcf8f927fd8a1f62307f`

## Purpose

The EOD reporter creates a close-of-business summary from Schwab's read-only execution history and, when available, the completed Trade Contracts stored in ExecutionOS browser History.

It is a **reporting utility only**. It does not place, replace, cancel, modify, or flatten broker orders.

The default command is:

```bash
npm run schwab:eod
```

A date can be specified explicitly:

```bash
npm run schwab:eod -- --date=2026-08-27
```

The reporter prints a terminal summary and writes a self-contained HTML report by default to:

```text
reports/eod/YYYY-MM-DD.html
```

`reports/eod/` is Git-ignored.

---

## 1. Two-source reporting model

An enriched EOD report combines two independent sources.

### 1.1 Schwab execution history — broker authority

Schwab provides the authoritative execution/fill history used to reconstruct broker trade cycles.

The broker-derived report can show:

- completed trade cycles;
- open reconstructed cycles;
- winners / losers / flat trades;
- win rate;
- reconstructed gross realized P/L;
- average winner;
- average loser;
- gross profit factor;
- average win/loss factor;
- largest winner / loser;
- symbol and direction;
- peak quantity;
- entry VWAP;
- exit VWAP;
- realized gross P/L per trade;
- current 0.5% risk snapshot when the local monitor is running.

A broker-only report can be generated without an ExecutionOS export.

### 1.2 ExecutionOS History export — plan/process enrichment

Schwab does not know the original ExecutionOS Trade Contract.

For setup/risk/process enrichment, the reporter needs the completed Trade Contracts stored in browser History.

The ExecutionOS export can add:

- setup;
- timeframe;
- thesis;
- trigger;
- invalidation;
- structural stop;
- target;
- management plan;
- expected entry;
- intended size;
- original planned dollar risk;
- entry-VWAP stop risk at reconstructed peak quantity;
- realized R multiple;
- exit classification / reason;
- lifecycle decision timeline;
- `THREATENED` count;
- `THREATENED -> VALID` count;
- `INVALID` count;
- ExecutionOS ownership classification.

Unmatched broker cycles remain explicitly **broker-only**. The reporter never fabricates a plan, risk value, R multiple, or ownership relationship.

---

## 2. Required enriched-report workflow

### 2.1 Confirm trades are complete in ExecutionOS History

Before exporting, confirm the trades expected to be enriched have completed their ExecutionOS lifecycle and are visible in **History**.

The helper reads the browser's persisted:

```text
execution-v23-store
```

A trade that has not completed into History is not available for EOD enrichment.

### 2.2 Keep Vite running and use the same browser origin

The export helper reads browser `localStorage`, which is origin-specific.

If ExecutionOS is running at:

```text
http://localhost:5173
```

open:

```text
http://localhost:5173/eod-export.html
```

Use the same browser profile/origin used for ExecutionOS. Switching between `localhost`, `127.0.0.1`, ports, or browser profiles can expose a different local-storage namespace and produce an empty/incomplete export.

### 2.3 Download ExecutionOS EOD History

Choose:

```text
DOWNLOAD EXECUTIONOS EOD HISTORY
```

The helper reads only ExecutionOS History and downloads a local JSON file named like:

```text
executionos-eod-history-2026-08-27.json
```

The helper does not contact Schwab and does not mutate/delete browser History.

### 2.4 Run the reporter

Default / newest export auto-detection:

```bash
npm run schwab:eod -- --date=2026-08-27
```

The reporter searches `~/Downloads` for the newest file matching:

```text
executionos-eod-history-*.json
```

For maximum certainty, specify the export explicitly:

```bash
npm run schwab:eod -- --date=2026-08-27 --executionos=~/Downloads/executionos-eod-history-2026-08-27.json
```

### 2.5 Verify enrichment before trusting enriched statistics

Do not treat successful HTML generation as proof that the plan/process layer was loaded.

Verify terminal output and the report:

- an ExecutionOS export was loaded or auto-detected;
- ExecutionOS-owned count is plausible relative to that day's History;
- trades known to have been run through ExecutionOS are not all broker-only;
- owned trades show setup/process fields;
- owned trades show planned risk / R where supported by the original contract;
- unmatched trades remain broker-only rather than being force-matched.

If ownership looks wrong, rerun with an explicit `--executionos=<path>` and inspect the selected History export before accepting enriched totals.

---

## 3. Ownership matching rules

ExecutionOS History matching is conservative and one-to-one.

The reporter requires:

- normalized symbol match;
- direction match;
- broker entry-detection timing near the reconstructed broker cycle start;
- maximum entry matching window of five minutes;
- each browser-History trade can own at most one broker cycle.

The goal is to avoid false ownership, not maximize the match count.

---

## 4. Important position-context rule

The reporter never invents cost basis.

If a symbol's first same-day execution is a `CLOSING` fill, the position may have been opened before the report window. Those legs are excluded from reconstructed P/L and the report is marked context-incomplete.

This commonly matters for swing positions carried into the day.

Accordingly, when context warnings appear, displayed reconstructed gross realized P/L is **not** a definitive whole-account daily P/L total. It represents realized P/L reconstructed only from complete-context Schwab fill cycles.

---

## 5. Risk and R interpretation

For a matched ExecutionOS-owned trade, original planned risk is computed from the frozen Trade Contract:

```text
planned risk = abs(expected entry - structural stop) * intended size
```

Realized R is:

```text
R = reconstructed realized gross P/L / original planned risk
```

Broker-only trades do not receive fabricated planned-risk or R values.

The optional COB risk snapshot is read from the current local read-only monitor API. It is a **current close-of-business snapshot**, not the historical frozen 0.5% risk budget for every completed trade, because V2.3 did not persist that account-level budget inside each completed Trade Contract.

---

## 6. Profit-factor fields

The report intentionally separates two metrics.

### Gross Profit Factor

```text
Gross Profit Factor = gross profit / gross loss
```

This is the standard trade-system profit factor.

### Average Win/Loss Factor

```text
Average Win/Loss Factor = average winner / abs(average loser)
```

This describes the average payoff ratio and is not the same metric as gross profit factor.

Do not label one as the other.

---

## 7. Other command options

Single symbol:

```bash
npm run schwab:eod -- --date=2026-08-27 --symbol=NVDA
```

Custom HTML output path:

```bash
npm run schwab:eod -- --date=2026-08-27 --out=~/Desktop/eod-2026-08-27.html
```

The report date is interpreted in the local machine timezone.

---

## 8. Generated output and privacy

Default HTML output:

```text
reports/eod/YYYY-MM-DD.html
```

Downloaded browser History export:

```text
executionos-eod-history-YYYY-MM-DD.json
```

These files are local/private working artifacts. Do not commit private History exports or raw broker data to Git.

The generated HTML is self-contained for local review and is not a broker statement.

---

## 9. Validation status

The EOD implementation was validated before PR #7 merged.

### Deterministic / regression validation

- `npm run analytics:test` — **PASS 19/19**;
- `npm run schwab:state-test` — **PASS 10/10**;
- `npm run build` — **PASS**;
- `git diff --check v2.3.0...HEAD` — **PASS**;
- clean tracked worktree confirmed.

### Real 27 August 2026 EOD acceptance

The real-date run reconstructed:

- 29 completed Schwab cycles;
- 0 open reconstructed cycles;
- 18 winners / 11 losers / 0 flat;
- gross profit factor and average win/loss factor reconciled numerically;
- 9 ExecutionOS-owned cycles;
- 20 broker-only cycles;
- all 9 same-day ExecutionOS History trades matched one-to-one to broker cycles;
- zero unexplained same-day ExecutionOS History trades;
- planned-risk and R enrichment verified on real data;
- no carry-in/context warning on that run;
- generated HTML visually reviewed and passed.

The real acceptance run demonstrates the enrichment/reconciliation workflow; it does not convert the reporter into a broker statement or eliminate the documented carry-in limitation for other dates.

---

## 10. Tests covered by `tests/eod-report.test.mjs`

The EOD suite includes deterministic coverage for:

- scaled long entry;
- partial exit;
- full exit / gross P&L;
- short trade cycle;
- closing-first context protection;
- ExecutionOS History matching;
- planned-risk calculation;
- R calculation;
- structural-state transition statistics;
- standard gross profit factor;
- average winner / loser;
- average win/loss factor as a separate metric.

For normal operator steps, see `USER-GUIDE.md`, especially **Generating an accurate enriched EOD report** and the end-of-session checklist.
