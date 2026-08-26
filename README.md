# ExecutionOS

ExecutionOS is a local, broker-aware execution operating system for preserving pre-entry intent under live market pressure.

Its core rule is simple:

> **Structure decides. P&L emotion does not.**

ExecutionOS is not a setup scanner and is not intended to replace the broker. The trader performs the market read and executes in the normal broker platform; ExecutionOS freezes the plan, applies risk rules, observes broker reality, reconstructs trade state, and creates an auditable record of management decisions.

## Core workflow

**READ -> PLAN -> TRIGGER -> RISK -> HOLD -> UPDATE -> EXIT -> REVIEW**

The live trade state is classified independently as:

- **VALID**
- **THREATENED**
- **INVALID**

The governing execution principle is:

> Entry freezes the original plan. New structure can modify it. Emotion cannot.

## Current product baseline: V2.3

The V2.3 branch (`v2-execution-system`) is a broker-aware multi-candidate workflow built around `ExecutionV23`.

Current capabilities include:

- multiple armed trade candidates listening for broker fills;
- one armed candidate per symbol;
- broker-fill binding by symbol, direction, opening effect, and arm time;
- automatic ARMED -> LIVE transition when a matching Schwab fill appears;
- edit/cancel/save behavior that preserves the last saved armed contract while edits are in progress;
- deterministic fill-during-edit ownership;
- multiple simultaneous live trades with warning above the intended concurrency limit;
- actual broker average price, quantity, peak quantity, risk information, and trade-state reconstruction;
- ENTRY / ADD / PARTIAL / FLAT / REVERSAL broker-state semantics;
- execution history and review.

V2.3 remains unmerged while final acceptance, branch reconciliation, and release closeout are completed. Do not merge or overwrite `main` casually; the newer main-side pre-V2 execution-discipline work must be reconciled deliberately.

## Broker architecture

### Schwab / thinkorswim equities

The local Schwab bridge is read-only and currently provides:

- OAuth authentication and token refresh;
- account discovery, balances, positions, orders, and transactions;
- live execution polling and latency measurement;
- historical reconstruction and replay;
- fragmented-fill handling and execution VWAP;
- trade-state reconstruction;
- local read-only state API (`/health`, `/api/state`);
- historical 1-minute OHLCV via Schwab Market Data price history for research/telemetry reconstruction.

Credentials and tokens remain local and Git-ignored. Secrets must never be printed, committed, or exposed to browser code.

### NinjaTrader futures

MES/MNQ futures are executed through NinjaTrader, not Schwab. The planned V3 sequence is:

1. close and tag V2.3;
2. define a broker-agnostic `BrokerAdapter` / `BrokerEvent` boundary;
3. add a minimal read-only NinjaTrader observer;
4. validate equivalent lifecycle semantics across Schwab and NinjaTrader before the full Management Governor rollout.

## Risk model

Maximum planned loss per trade is **0.5% of the relevant trading account equity**.

The hierarchy is:

**Structural stop -> acceptable risk -> position size**

The stop is defined by technical invalidation. If that stop is too expensive, reduce size or pass; do not tighten the stop merely to fit the dollar budget.

## Analytics preservation

The `analytics-preservation-v23` branch and draft PR #2 preserve the empirical research that motivated the V3 Management Governor.

Recovered/preserved status:

| Analysis | Status |
| --- | --- |
| Winner / loser duration | Recovered to preserved precision |
| Historical stop-management timing | Recovered to preserved precision |
| Initial-risk / realized-R | High-confidence recovery; one documented one-trade threshold discrepancy |
| 19-trade MFE windows | Benchmark + formula preserved; exact sample membership unresolved |
| 19-trade capture efficiency | Benchmark + formula preserved; exact sample membership unresolved |
| 19-trade fixed-duration counterfactuals | Benchmark + formula preserved; exact sample membership unresolved |

See `research/30-day-management-study/methodology.md` for the evidence, reconstruction rules, and explicit anti-curve-fitting boundary.

The project does **not** search arbitrary trade combinations or custom timing conventions merely to force historical benchmark matches.

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

# Tests / analytics
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

Local research exports and Schwab minute-history caches are intentionally Git-ignored.

## Documentation

- `research/30-day-management-study/methodology.md` - authoritative preservation methodology and recovery status.
- `V2-MILESTONE-1.md` - historical V2 Milestone 1 record; preserved for design history, not current system status.
- `DOCUMENTATION-STATUS.md` - map of authoritative versus historical project documents.
- **ExecutionOS Management Governor Project Specification v1.2** - current project/architecture decision record after analytics preservation.

## Development sequence

The current sequence is intentionally constrained:

1. **Analytics preservation - complete.**
2. **V2.3 final acceptance / edge hardening.**
3. **Reconcile the main-side pre-V2 work deliberately.**
4. **Update PR #1 to V2.3 reality.**
5. **Merge/tag V2.3 only after explicit approval and green acceptance tests.**
6. **Begin V3 Management Governor from the clean merged baseline.**

## V3 direction

The target Management Governor is a deterministic policy engine:

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
