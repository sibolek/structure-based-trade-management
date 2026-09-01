# ExecutionOS

ExecutionOS is a local, broker-aware trading execution operating system for preserving pre-entry intent under live market pressure.

Its governing principle is:

> **Structure decides. P&L emotion does not.**

ExecutionOS is not a setup scanner and is not a broker replacement. The trader performs the market read and places orders in the normal broker platform; ExecutionOS freezes intent, applies deterministic pre-trade risk rules, observes broker reality, reconstructs trade state, and creates an auditable management record.

## Core workflow

```text
READ → PLAN → PRE-TRADE PERMISSION → RISK → ARM → TRIGGER → HOLD → UPDATE → EXIT → REVIEW
```

The downstream live trade state remains classified independently as:

- `VALID`
- `THREATENED`
- `INVALID`

> Entry freezes the original plan. New structure can modify it. Emotion cannot.

---

## Current product baseline

### Frozen downstream execution release

The validated broker-aware execution baseline remains frozen under:

```text
v2.3.0
```

Tag target:

```text
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

V2.3 remains the trusted downstream broker-fill ownership and execution-management reference.

### V2.4 pre-trade extension now on `main`

Current `main` also contains V2.4 Phases 1–4:

1. **Candidate Ingestion** — merged.
2. **MarketDataProvider** — merged / live-accepted.
3. **DSS / Micro-Volatility Buffer** — merged / accepted.
4. **Effective-Stop Risk Sizing** — merged / accepted via PR #14.

Phase 4 merge commit:

```text
0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

The approved Phase 4 implementation sizes exclusively from the Phase 3 `effectiveStop`, caps planned entry-to-stop risk at 0.5% of exact-account equity, creates immutable risk-evaluation provenance, and requires a fresh risk evaluation for every ARM attempt.

> **Phase 3 determines the correct stop. Phase 4 determines whether and how large we can afford to trade against that stop. Phase 4 never changes the stop.**

### Critical boundary

V2.4 Phase 4 can freeze an **internal `ARMED` authorization/provenance state**, but the explicit transfer/binding of that V2.4 state into the existing V2.3 Execution Board remains future work.

Therefore:

- internal V2.4 `ARMED` does **not** place a broker order;
- it does **not** claim a fill;
- it does **not** silently change V2.3 ownership semantics;
- Schwab/thinkorswim remains the equity order-entry venue;
- the Schwab integration remains read-only.

V3 has **not** started.

---

## Current architecture

```text
PRE-TRADE / V2.4

Candidate
   ↓
Phase 3 DSS
   structural invalidation
   effectiveStop
   dssEvaluationId
   ↓
Phase 4 risk sizing
   currentExpectedEntry
   exact account equity
   instrument conversion
   maxAffordableQuantity
   riskEvaluationId
   ↓
permission consequence
   ↓
READY / CAUTION / PASS
   ↓
ARM attempt
   ↓
fresh Phase 4 evaluation
   ↓
selected quantity validation
   ↓
internal ARMED provenance freeze
   ↓
[future explicit handoff]
   ↓

EXECUTION / frozen V2.3

V2.3 Execution Board
   ↓
matching broker fill
   ↓
LIVE
   ↓
VALID / THREATENED / INVALID
```

The bracketed V2.4→V2.3 handoff is intentionally not yet implemented.

---

## Risk model

Maximum planned loss per trade is:

```text
0.5% of the exact relevant trading-account equity
```

The hierarchy is:

```text
STRUCTURE → INVALIDATION → EFFECTIVE STOP → RISK BUDGET → POSITION SIZE
```

Never reverse that hierarchy by tightening the stop to make a desired position size fit.

### Phase 3

Phase 3 converts structural invalidation into a volatility-protected `effectiveStop` using the approved 2-minute Wilder ATR buffer and protective price-increment rounding.

### Phase 4

Phase 4:

- obtains a conservative current expected entry;
- obtains exact execution-account `liquidationValue`;
- applies the fixed 0.5% planned-risk budget;
- converts equity/futures stop distance into risk per unit;
- rounds risk budget and quantity only downward/protectively;
- returns `NO_AFFORDABLE_SIZE` when even minimum size cannot fit;
- persists immutable risk evaluations;
- requires a new risk evaluation on every ARM attempt;
- permits a selected quantity below, but never above, the maximum affordable quantity.

Phase 4 does **not** impose an arbitrary notional cap at account equity. Buying power and margin eligibility are separate future concerns.

---

## V2.3 execution capabilities

The frozen V2.3 execution layer supports:

- multiple armed candidates;
- one armed candidate per symbol;
- broker-fill binding by symbol, direction, opening effect, and arm time;
- automatic downstream `ARMED → LIVE` transition when a matching Schwab fill is observed;
- deterministic edit/fill ownership;
- multiple simultaneous live trades;
- actual broker average price, quantity, peak quantity, and state reconstruction;
- `ENTRY / ADD / PARTIAL / FLAT / REVERSAL` semantics;
- History and execution review;
- browser-local persistence.

These semantics remain frozen/trusted and were regression-validated during Phase 4 closeout.

---

## Broker architecture

### Schwab / thinkorswim equities

The local Schwab boundary remains read-only and provides:

- OAuth authentication and token refresh;
- account discovery and exact-account balances;
- positions, orders, and transactions;
- read-only market data;
- live execution polling and latency observation;
- trade-state reconstruction;
- historical reconstruction/replay;
- EOD reporting;
- Phase 3 market-data inputs;
- Phase 4 exact-account risk inputs.

Credentials/tokens remain local and Git-ignored. Secrets must never be committed or exposed to browser code.

### NinjaTrader futures

MES/MNQ futures remain executed through NinjaTrader. Automatic NinjaTrader fill binding is not connected yet.

Phase 4 supports normalized futures sizing metadata/calculation, but that is not the same as live NinjaTrader integration.

---

## End-of-Day reporting

ExecutionOS includes a read-only EOD reporter:

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

For a **fully enriched** report, completed trades must first be present in ExecutionOS History and the browser History must be exported while Vite is still running.

Open on the same browser origin/profile used for ExecutionOS:

```text
http://localhost:5173/eod-export.html
```

Choose **DOWNLOAD EXECUTIONOS EOD HISTORY**, then run the EOD command.

Without the ExecutionOS History export, Schwab broker-cycle reconstruction can still work for complete-context trades, but setup, planned risk, R, ownership, and process fields cannot be treated as complete.

Generated reports default to:

```text
reports/eod/YYYY-MM-DD.html
```

See:

- `USER-GUIDE.md` — complete operator sequence;
- `docs/ExecutionOS_EOD_Report.md` — report semantics and limitations.

---

## Validation baseline

Final Phase 4 acceptance on 2026-09-01:

```text
v24:risk-sizing-test  170/170 PASS
v24:dss-test           91/91 PASS
analytics:test        293/293 PASS
schwab:state-test      10/10 PASS
production build      PASS
```

The frozen V2.3 deterministic state suite remained 10/10 green.

---

## Common commands

```bash
npm install
npm run dev
npm run build

# Schwab / broker
npm run schwab:status
npm run schwab:account
npm run schwab:monitor
npm run schwab:history
npm run schwab:state-test

# EOD
npm run schwab:eod
npm run schwab:eod -- --date=YYYY-MM-DD

# V2.4 validation
npm run v24:dss-test
npm run v24:risk-sizing-test

# Full repository tests
npm run analytics:test
```

Research/forensic commands remain documented in `USER-GUIDE.md` and `research/30-day-management-study/methodology.md`.

---

## Documentation

Use these in order of purpose:

- `USER-GUIDE.md` — current operating procedure and limitations.
- `docs/ExecutionOS_Documentation_Index.md` — documentation authority/status map.
- `DOCUMENTATION-STATUS.md` — current vs historical records.
- `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` — overall V2.4 design.
- `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` — Phase 3 implementation/acceptance.
- `docs/ExecutionOS_V2.4_Phase4_Effective_Stop_Risk_Sizing_Design_Baseline_v0.1_APPROVED.md` — Phase 4 design.
- `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` — Phase 4 implementation/acceptance/merge record.
- `docs/ExecutionOS_EOD_Report.md` — EOD reference.
- `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` — dated architecture / Governor direction.
- `research/30-day-management-study/methodology.md` — research provenance.

---

## Current development sequence

Completed:

1. V2.3 broker-aware execution validation and frozen tag.
2. Analytics preservation.
3. Read-only EOD reporting.
4. V2.4 Phase 1 Candidate Ingestion.
5. V2.4 Phase 2 MarketDataProvider.
6. V2.4 Phase 3 DSS / effective stop.
7. V2.4 Phase 4 Effective-Stop Risk Sizing and internal ARM provenance freeze.

Next V2.4 work must be treated as a new phase/scope and should include, as appropriate:

- broader context / decision-gate completion;
- explicit internal V2.4 `ARMED` → V2.3 Execution Board handoff;
- any separate buying-power/margin gate;
- operator/UI exposure of the merged pre-trade internals.

Broker-write authority remains out of scope unless separately designed, validated, and explicitly authorized.

V3 Management Governor remains **not started**.
