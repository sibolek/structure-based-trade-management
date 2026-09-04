# ExecutionOS End-of-Day Report

**Status:** Current read-only reporting reference  
**Added:** 27 August 2026  
**Updated:** 4 September 2026  
**Current accepted integration branch:** `v24-execution-board-handoff`  
**Original implementation merge:** PR #7, merge commit `bedd70979a3b18844386bcf8f927fd8a1f62307f`

## Purpose

The EOD reporter creates a close-of-business summary from Schwab's read-only execution history and, when available, completed Trade Contracts stored in ExecutionOS browser History.

It is a **reporting utility only**. It does not place, replace, cancel, modify, reduce, or flatten broker orders.

Default command:

```bash
npm run schwab:eod
```

Explicit date:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

Default HTML output:

```text
reports/eod/YYYY-MM-DD.html
```

---

## 1. Two-source reporting model

### 1.1 Schwab execution history — broker authority

Schwab provides authoritative fills used to reconstruct broker trade cycles.

The broker-derived layer can show:

- completed/open reconstructed cycles;
- winners / losers / flat trades;
- win rate;
- reconstructed gross realized P/L for complete-context cycles;
- average winner / loser;
- gross profit factor;
- average win/loss factor;
- symbol/direction;
- peak quantity;
- entry/exit VWAP;
- current risk snapshot when the local monitor is running.

A broker-only report can be generated without an ExecutionOS export.

### 1.2 ExecutionOS History export — plan/process enrichment

The ExecutionOS export can add:

- origin (`LEGACY_MANUAL_V23` or `V24_HANDOFF`);
- setup/timeframe;
- thesis/trigger/invalidation;
- structural invalidation / legacy structural stop;
- V2.4 effective stop when applicable;
- target/management plan;
- expected entry/intended size;
- planned dollar risk;
- entry-VWAP stop risk;
- realized R;
- exit classification/reason;
- lifecycle decision timeline;
- structural-state transition statistics;
- ExecutionOS ownership classification.

Unmatched broker cycles remain explicitly **broker-only**. The reporter never fabricates a plan, risk value, R multiple, or ownership relationship.

---

## 2. Required enriched-report workflow

1. Confirm expected trades have completed into **ExecutionOS History**.
2. Keep Vite running.
3. Use the same browser profile/origin used during the session.
4. Open:

```text
http://localhost:5173/eod-export.html
```

5. Choose:

```text
DOWNLOAD EXECUTIONOS EOD HISTORY
```

6. Run:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

For maximum certainty, specify the export explicitly:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD --executionos=~/Downloads/executionos-eod-history-YYYY-MM-DD.json
```

Verify the intended History export loaded and that ExecutionOS-owned vs broker-only counts are plausible before trusting enriched statistics.

---

## 3. Ownership matching rules

ExecutionOS History matching is conservative and one-to-one.

The reporter requires:

- normalized symbol match;
- direction match;
- broker entry-detection timing near reconstructed cycle start;
- maximum entry matching window of five minutes;
- each History trade may own at most one broker cycle.

The goal is to avoid false ownership, not maximize match count.

---

## 4. Position-context rule

The reporter never invents cost basis.

If a symbol's first same-day execution is `CLOSING`, the position may have opened before the report window. Those legs are excluded from reconstructed P/L and the report is marked context-incomplete.

When context warnings appear, reconstructed gross realized P/L is **not** a definitive whole-account daily P/L total.

---

## 5. Risk and R interpretation

Risk-stop authority is now origin-aware.

### Legacy/manual V2.3

```text
execution stop = originalPlan.structuralStop
planned risk = abs(expected entry - execution stop) * intended size
```

### V2.4-origin

```text
execution stop = v24.effectiveStop
planned risk = abs(expected entry - effective stop) * intended size
```

For V2.4, `originalPlan.structuralStop` is retained as structural invalidation context/provenance but is **not** used as the execution-risk stop when `v24.effectiveStop` is authoritative.

Entry-VWAP stop risk follows the same origin-aware execution-stop rule.

Realized R is:

```text
R = reconstructed realized gross P/L / planned risk
```

Broker-only trades do not receive fabricated planned-risk or R values.

The optional COB risk snapshot is a **current** monitor snapshot, not a reconstructed historical per-trade ARM budget.

---

## 6. Profit-factor fields

```text
Gross Profit Factor = gross profit / gross loss
```

```text
Average Win/Loss Factor = average winner / abs(average loser)
```

These are separate metrics and must not be conflated.

---

## 7. Other command options

Single symbol:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD --symbol=NVDA
```

Custom output:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD --out=~/Desktop/eod-YYYY-MM-DD.html
```

The report date is interpreted in the local machine timezone.

---

## 8. Privacy

Generated HTML and browser History exports are private local artifacts. Do not commit them or raw broker data to Git.

---

## 9. Validation history

The original EOD implementation was accepted with PR #7. Subsequent V2.4 integration added origin-aware stop-risk semantics on 4 September 2026.

`tests/eod-report.test.mjs` now covers:

- scaled long entry;
- partial/full exit and gross P/L;
- short cycle;
- closing-first context protection;
- conservative History matching;
- legacy planned-risk/R semantics;
- **V2.4 effective-stop planned-risk/R semantics with structural invalidation deliberately different from effective stop**;
- structural-state transition statistics;
- gross profit factor;
- average winner/loser and average win/loss factor.

For normal operator procedure, see `USER-GUIDE.md`.
