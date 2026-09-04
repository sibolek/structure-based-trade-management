# ExecutionOS

ExecutionOS is a local, broker-aware trading execution operating system for preserving pre-entry intent under live market pressure.

Its governing principle is:

> **Structure decides. P&L emotion does not.**

ExecutionOS is not a broker replacement. The trader performs the market read and places orders in the normal broker platform; ExecutionOS freezes intent, applies deterministic pre-trade risk rules, observes broker reality, owns execution state, and creates an auditable management record.

## Current accepted state

### Frozen downstream reference

```text
v2.3.0
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

### V2.4 Phases 1–4

Merged to `main`:

1. Candidate Ingestion;
2. MarketDataProvider;
3. DSS / Micro-Volatility Buffer;
4. Effective-Stop Risk Sizing.

### V2.4 Execution Board handoff runtime

The accepted handoff/runtime integration currently lives on:

```text
v24-execution-board-handoff
```

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3 owns execution.**

Implemented/accepted on this branch:

- immutable V2.4 handoff provenance;
- sticky receiver identity;
- exact-account admission and broker-activity proof;
- PREPARED/LISTENING local installation;
- immutable `executionListeningAt`;
- pre-fill DISCARD/retirement with durable cutoff;
- lossless exact-account first-fill ownership;
- atomic LIVE lifecycle + visible Execution Board promotion;
- fragmented-entry / ADD / PARTIAL / FLAT / REVERSAL lifecycle handling;
- canonical browser store authority;
- cross-tab Web Lock serialization;
- default-on top-level runtime router;
- router health/telemetry and restart/HMR/takeover recovery;
- read-only full trade-specification inspector;
- synthetic read-only browser/runtime recovery acceptance.

The router is default-on. The only runtime switch is the negative emergency pause:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

No broker writes are authorized.

## Important operator-surface boundary

The downstream handoff receiver/router/ownership path is implemented and accepted, but the current PRE-TRADE browser surface does **not yet expose the complete**:

```text
WAITING → permission → READY/CAUTION → ARM → create/register handoff
```

workflow as one normal operator path.

Imported WAITING candidates are proposals only. Internal Phase 3, Phase 4, ARM authorization, and handoff-construction services exist and are tested, but the normal browser PRE-TRADE board does not yet orchestrate all of them end to end.

## Risk model

Maximum planned price risk per trade is:

```text
0.5% of the exact relevant trading-account equity
```

Hierarchy:

```text
STRUCTURE → INVALIDATION → EFFECTIVE STOP → RISK BUDGET → POSITION SIZE
```

Phase 3 determines the volatility-protected `effectiveStop`. Phase 4 sizes against that stop and may reduce quantity or reject affordability; it may never tighten the stop to make size fit.

For V2.4 EOD reporting, `v24.effectiveStop` remains risk-stop authority. Legacy/manual V2.3 trades continue to use `originalPlan.structuralStop`.

## Normal V2.4 startup on the accepted branch

Until the handoff branch is merged to `main`:

```bash
git checkout v24-execution-board-handoff
git pull --ff-only
```

Run:

```bash
npm run schwab:monitor
npm run v24:pretrade
npm run dev
```

The services are read-only with respect to broker writes.

## Broker architecture

### Schwab / thinkorswim equities

Schwab provides read-only:

- OAuth/account discovery;
- exact-account balances;
- positions/orders/transactions;
- market data;
- execution polling and coverage/activity provenance;
- lossless ownership-journal inputs;
- historical reconstruction/EOD reporting.

Actual equity order entry remains in thinkorswim/Schwab.

### NinjaTrader futures

Phase 4 supports normalized futures sizing calculations. Live NinjaTrader fill binding is not connected yet.

## Persistence

Server-side local V2.4 state includes:

```text
.executionos-v24-state.json
.executionos-v24-execution-board-handoffs.json
.executionos-v24-execution-board-handoff-deliveries.json
```

Browser downstream authority uses localStorage key:

```text
execution-v23-store
```

The historical key name now contains both V2.3 and V2.4 downstream namespaces. Runtime state files and private exports are Git-ignored.

## End-of-Day reporting

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

For enriched reports, export browser History from:

```text
http://localhost:5173/eod-export.html
```

See `USER-GUIDE.md` and `docs/ExecutionOS_EOD_Report.md`.

## Current limitations

- complete browser/API WAITING→permission→ARM→handoff creation orchestration;
- explicit reconciliation-resolution workflow;
- broker order placement/replacement/cancellation/flattening;
- broker-write Governor;
- buying-power/margin and portfolio-heat gates;
- live NinjaTrader binding;
- V3 Management Governor.

## Common commands

```bash
npm install
npm run dev
npm run build
npm run v24:pretrade

npm run schwab:auth
npm run schwab:account
npm run schwab:monitor
npm run schwab:eod

npm run v24:dss-test
npm run v24:risk-sizing-test
npm run v24:handoff-test
npm run v24:handoff-api-test
npm run v24:store-authority-test
npm run v24:runtime-router-test
npm run v24:router-hardening-test
npm run v24:router-browser-test

npm run analytics:test
```

## Documentation

Use:

- `USER-GUIDE.md` — current operator procedure;
- `docs/ExecutionOS_Documentation_Index.md` — authority/status map;
- `DOCUMENTATION-STATUS.md` — current vs historical records;
- approved V2.4 design baselines/addenda — frozen architecture;
- Phase 3/4 closeouts — accepted implementation evidence;
- `docs/ExecutionOS_EOD_Report.md` — reporting semantics.

V3 has not started.
