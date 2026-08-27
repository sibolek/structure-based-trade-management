# ExecutionOS

ExecutionOS is a local, broker-aware execution operating system for preserving pre-entry intent under live market pressure.

Its core rule is simple:

> **Structure decides. P&L emotion does not.**

ExecutionOS is not a setup scanner and is not intended to replace the broker. The trader performs the market read and executes in the normal broker platform; ExecutionOS freezes the plan, applies risk rules, observes broker reality, reconstructs trade state, and creates an auditable record of management decisions.

## Core workflow

**READ -> PLAN -> RISK -> ARM -> TRIGGER -> HOLD -> UPDATE -> EXIT -> REVIEW**

The live trade state is classified independently as:

- **VALID**
- **THREATENED**
- **INVALID**

The governing execution principle is:

> Entry freezes the original plan. New structure can modify it. Emotion cannot.

## Current product baseline

The validated V2.3 execution release is frozen under the annotated tag:

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

Current `main` contains that frozen execution baseline plus the subsequently merged **read-only End-of-Day reporting workflow** from PR #7. PR #7 merged on 27 August 2026 at:

```text
bedd70979a3b18844386bcf8f927fd8a1f62307f
```

The EOD addition does not add broker-write authority and does not change the validated production trade-state engine.

V3 has **not** started and requires separate explicit authorization.

## V2.3 execution capabilities

- multiple armed trade candidates;
- one armed candidate per symbol;
- broker-fill binding by symbol, direction, opening effect, and arm time;
- automatic ARMED -> LIVE transition when a matching Schwab fill appears;
- deterministic edit/fill ownership;
- multiple simultaneous live trades;
- actual broker average price, quantity, peak quantity, and trade-state reconstruction;
- ENTRY / ADD / PARTIAL / FLAT / REVERSAL semantics;
- execution History and review;
- browser-local persistence.

## End-of-Day reporting

ExecutionOS now includes a read-only EOD reporter:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

The report reconstructs broker-authoritative Schwab trade cycles and can enrich them with ExecutionOS Trade Contract data.

For a **fully enriched** report, completed trades must first be present in ExecutionOS History and the browser History must be exported while the Vite app is still running:

```text
http://localhost:5173/eod-export.html
```

Choose **DOWNLOAD EXECUTIONOS EOD HISTORY**, then run the EOD command. Without that export, broker trade/P&L reconstruction still works, but setup, planned risk, R multiple, ownership, and process fields cannot be fully populated.

See:

- `USER-GUIDE.md` — complete operating procedure, including the required enriched-EOD sequence;
- `docs/ExecutionOS_EOD_Report.md` — dedicated EOD reporting reference.

Generated EOD HTML reports are written by default under:

```text
reports/eod/YYYY-MM-DD.html
```

and remain Git-ignored/local.

## Broker architecture

### Schwab / thinkorswim equities

The local Schwab bridge is read-only and provides:

- OAuth authentication and token refresh;
- account discovery, balances, positions, orders, and transactions;
- live execution polling and latency measurement;
- historical reconstruction and replay;
- fragmented-fill handling and execution VWAP;
- trade-state reconstruction;
- local read-only state API (`/health`, `/api/state`);
- historical 1-minute OHLCV via Schwab Market Data price history;
- read-only EOD trade-cycle reconstruction and reporting.

Credentials and tokens remain local and Git-ignored. Secrets must never be printed, committed, or exposed to browser code.

### NinjaTrader futures

MES/MNQ futures are executed through NinjaTrader, not Schwab. Automatic NinjaTrader binding is not connected yet.

The planned future sequence is:

1. begin V3 only after explicit authorization;
2. define a broker-agnostic `BrokerAdapter` / `BrokerEvent` boundary;
3. add a minimal read-only NinjaTrader observer;
4. validate equivalent lifecycle semantics across Schwab and NinjaTrader before Management Governor enforcement.

## Risk model

Maximum planned loss per trade is **0.5% of the relevant trading account equity**.

The hierarchy is:

**Structural stop -> acceptable risk -> position size**

The stop is defined by technical invalidation. If that stop is too expensive, reduce size or pass; do not tighten the stop merely to fit the dollar budget.

## Analytics preservation

The empirical research that motivated the future Management Governor is preserved in the repository.

| Analysis | Status |
| --- | --- |
| Winner / loser duration | Recovered to preserved precision |
| Historical stop-management timing | Recovered to preserved precision |
| Initial-risk / realized-R | High-confidence recovery; one documented one-trade threshold discrepancy |
| 19-trade MFE windows | Benchmark + formula preserved; exact sample membership unresolved |
| 19-trade capture efficiency | Benchmark + formula preserved; exact sample membership unresolved |
| 19-trade fixed-duration counterfactuals | Benchmark + formula preserved; exact sample membership unresolved |

See `research/30-day-management-study/methodology.md` for evidence, reconstruction rules, and the anti-curve-fitting boundary.

## Common commands

```bash
npm install
npm run dev
npm run build

# Schwab bridge
npm run schwab:status
npm run schwab:account
npm run schwab:monitor
npm run schwab:history
npm run schwab:price-history-test

# End-of-Day reporting
npm run schwab:eod
npm run schwab:eod -- --date=2026-08-27

# Tests / analytics
npm run schwab:state-test
npm run analytics:test
npm run analytics:report
npm run analytics:duration
npm run analytics:stops
npm run analytics:r
npm run analytics:mfe
npm run analytics:capture
npm run analytics:counterfactuals

# Historical reconstruction / diagnostics
npm run research:enrich-stops
npm run research:report-recovered
npm run research:audit-market-data
npm run research:diagnose-fast-winners
npm run research:diagnose-fast-winner-strata
npm run research:validate-fast-winners-schwab
npm run research:diagnose-minute-alignment
```

Local research exports, Schwab minute-history caches, EOD exports, and generated EOD reports are intentionally kept local/Git-ignored.

## Documentation

- `USER-GUIDE.md` — authoritative living operator guide, including the complete enriched-EOD procedure.
- `docs/ExecutionOS_EOD_Report.md` — dedicated EOD report behavior, inputs, interpretation, and validation.
- `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` — dated architecture/project decision record. Its embedded repository status is historical; do not rewrite it to mimic later project state.
- `research/30-day-management-study/methodology.md` — authoritative analytics provenance.
- `DOCUMENTATION-STATUS.md` — current-versus-historical documentation map.
- `docs/ExecutionOS_Documentation_Index.md` — cross-document authority/index record.
- `V2-MILESTONE-1.md` — historical V2 Milestone 1 record.

## Current development sequence

1. **Analytics preservation — complete.**
2. **Pre-V2 documentation/history reconciliation — complete.**
3. **V2.3 final acceptance/release gate — complete.**
4. **V2.3 merged into `main` — complete.**
5. **Post-merge V2.3 documentation finalization — complete.**
6. **Annotated `v2.3.0` tag — created and verified.**
7. **Read-only EOD reporting — complete; PR #7 merged and validated.**
8. **Current documentation closeout — in progress.**
9. **V3 Management Governor — not started; requires explicit approval.**

## V3 direction

The target Management Governor remains a deterministic policy engine:

```text
evaluateManagementAction(
  contract,
  executionState,
  marketState,
  requestedAction
)
=> AUTHORIZED | WARNING | OVERRIDE_REQUIRED | BLOCKED
```

V3 should preserve intent, not force duration. Preauthorized actions should remain fast; renegotiating the plan under emotional pressure should be deliberately frictional. No AI belongs in the latency-sensitive order path.
