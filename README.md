# ExecutionOS

ExecutionOS is a local, broker-aware trading execution operating system for preserving pre-entry intent under live market pressure.

Its governing principle is:

> **Structure decides. P&L emotion does not.**

ExecutionOS is not a broker replacement. The trader performs the market read and places orders in the normal broker platform; ExecutionOS freezes intent, applies deterministic pre-trade risk rules, transfers authorized plans into execution ownership, observes broker reality, and creates an auditable management record.

---

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

### V2.4 PRETRADE → Execution Board integration

Accepted and closed on:

```text
v24-execution-board-handoff
```

Accepted implementation checkpoint before documentation-only closeout commits:

```text
3f794538ffbe5c5875a3d671143cb33890530b1f
```

Frozen design authority:

```text
docs/ExecutionOS_V2.4_Design_Baseline_v0.5_APPROVED.md
docs/ExecutionOS_V2.4_Design_Baseline_v0.5_Traceability_Audit_APPROVED.md
```

Implementation closeout:

```text
docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Closeout_2026-09-06.md
```

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3-compatible execution infrastructure owns execution.**

---

## Accepted end-to-end lifecycle

```text
CANDIDATE SOURCE
→ CANONICAL INGRESS
→ WAITING
→ PRETRADE_TRIGGER_EVALUATING
→ PERMISSION_EVALUATING
→ READY / CAUTION / PASS
→ OPERATOR REVIEW
→ ARM
→ IMMUTABLE HANDOFF
→ PENDING
→ CLAIMED
→ PREPARED
→ LISTENING
→ EXACT-ACCOUNT OPENING FILL
→ LIVE
→ ENTRY_FRAGMENT / ADD / PARTIAL / FLAT / REVERSAL
→ EXIT
→ OPERATOR EXIT CLASSIFICATION
→ HISTORY
→ SYMBOL OWNERSHIP RELEASE
```

The browser is presentation/operator-intent only. PRETRADE lifecycle, trigger, permission, review, OCO and ARM are authoritative server-side operations. Downstream installation/lifecycle/management state is serialized through the canonical Execution Board store.

Imported `WAITING` candidates remain proposals until the explicit operator/server workflow advances them; they are never automatically ARMED merely because the router is running.

---

## Core accepted capabilities

### PRETRADE / ARM

- canonical candidate validity, hashing, versioning and supersession;
- versioned trigger contract and durable satisfaction evidence;
- immutable permission attempts;
- structural-validity authority;
- Phase 3 DSS + Phase 4 risk integration;
- `READY / CAUTION / PASS`;
- material review-package identity;
- explicit quantity selection;
- exact-package CAUTION acknowledgement;
- same-symbol OCO authority;
- ARM as the final explicit direction/quantity confirmation, with the exact account exposed in the review package and frozen by ARM;
- fresh ARM-time revalidation;
- durable ARM operation journal and recovery;
- immutable ARMED provenance;
- exactly one immutable handoff and PENDING delivery per successful authorization;
- PRETRADE Active, Authorized/Execution and History projections;
- no generic browser lifecycle or ARM authority.

### Execution handoff/runtime

- immutable V2.4 handoff provenance;
- persistent delivery state machine;
- stable receiver identity;
- exact-account admission and broker-activity proof;
- PREPARED/LISTENING local installation;
- immutable `executionListeningAt`;
- pre-fill DISCARD/retirement with durable cutoff;
- lossless exact-account first-fill ownership;
- atomic LIVE lifecycle + visible Execution Board promotion;
- fragmented-entry / ADD / PARTIAL / FLAT / REVERSAL handling;
- canonical browser store authority;
- cross-tab Web Lock serialization;
- default-on top-level runtime router;
- router health/telemetry and restart/HMR/takeover recovery;
- read-only full trade-specification inspector.

### Slice 7 live management

- finite immutable first-entry authorization deadline;
- late-fill authorization exceptions without retroactive authorization;
- immutable ARM quantity ceiling;
- finite position-build window;
- explicit Complete Position Build;
- downward-only live ceiling after unused capacity expires/is relinquished;
- re-add gating and exposure-increase checks;
- finite lifecycle loss budget;
- explicit effective-stop authority and audit trail;
- target observation and discretionary notes without broker authority;
- durable CRITICAL Authorization Exceptions;
- explicit exception reconciliation;
- retired-authorization late-fill attribution;
- narrow legacy V2.4 compatibility without weakening native Phase 4 economics.

---

## Risk model

Maximum planned price risk per trade:

```text
0.5% of exact relevant trading-account equity
```

Hierarchy:

```text
STRUCTURE → INVALIDATION → EFFECTIVE STOP → RISK BUDGET → POSITION SIZE
```

Phase 3 determines the volatility-protected `effectiveStop`. Phase 4 sizes against that stop and may reduce quantity or reject affordability; it may never tighten the stop to make size fit.

For live V2.4 management, realized losses consume the finite authorization budget. Profits do not replenish it. A tighter valid effective stop may free risk only within existing authorization ceilings; a wider stop cannot manufacture new capacity.

---

## Broker boundary

```text
readOnly === true
brokerWriteAuthority === false
```

ExecutionOS does **not**:

- place orders;
- replace orders;
- cancel orders;
- modify broker stops;
- automatically reduce exposure;
- flatten positions.

Actual equity order entry remains in thinkorswim/Schwab.

Schwab provides read-only exact-account balances, positions, orders/transactions, market data, execution polling, coverage/activity provenance and lossless ownership-journal evidence. Authoritative broker `executionTime` controls ownership chronology.

---

## Runtime router

The router is default-on.

Emergency negative switch:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

Semantics:

```text
unset / false -> enabled
true          -> PAUSED
other nonempty value -> BLOCKED / fail closed
```

Router health states:

```text
RUNNING
WAITING_FOR_SCHWAB
WAITING_FOR_PRETRADE
WAITING_FOR_ROUTER_LOCK
PAUSED
STALE
BLOCKED
ERROR
```

---

## Normal V2.4 startup on the accepted branch

Until the integration branch is explicitly merged to `main`:

```bash
git checkout v24-execution-board-handoff
git pull --ff-only
```

Run three terminals:

```bash
npm run schwab:monitor
npm run v24:pretrade
npm run dev
```

The services remain non-broker-writing.

---

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

The historical key name now carries both V2.3 and V2.4 downstream namespaces. Runtime state files and private exports are Git-ignored.

---

## End-of-Day reporting

```bash
npm run schwab:eod -- --date=YYYY-MM-DD
```

For enriched reports, export browser History from:

```text
http://localhost:5173/eod-export.html
```

Current EOD risk enrichment is origin-aware:

```text
V24_HANDOFF        -> v24.effectiveStop
LEGACY_MANUAL_V23  -> originalPlan.structuralStop
```

V2.4 structural invalidation remains separate provenance. Slice 7 live managed-stop changes do not rewrite the EOD planned-risk stop basis.

See `USER-GUIDE.md` and `docs/ExecutionOS_EOD_Report.md`.

---

## Futures / NinjaTrader

Phase 4 supports normalized futures sizing calculations. Live NinjaTrader fill binding is not connected yet.

---

## Current deferred work

- broker order placement/replacement/cancellation/modification/flattening;
- general broker-write Governor enforcement;
- buying-power/margin eligibility and portfolio-heat gates;
- live NinjaTrader execution binding;
- cloud/multi-device authority;
- generic coverage/provenance reconciliation beyond the implemented Authorization Exception reconciliation path;
- V3 Management Governor.

V3 has not started.

---

## Final acceptance evidence

```text
Focused Slice 7:                  26 / 26 PASS
Downstream lifecycle E2E:          1 / 1 PASS
Canonical PRETRADE→Execution E2E:  1 / 1 PASS
Full repository regression:       734 / 734 PASS
Production build:                 PASS
Implementation worktree:          CLEAN
Broker writes introduced:         NONE
```

The production build was run at `2dbfbf23e5c7e4352777c31b8bbb5b6e628e9796`; the only subsequent implementation change through accepted checkpoint `3f794538ffbe5c5875a3d671143cb33890530b1f` was the addition of the canonical PRETRADE→Execution E2E test, so production code was unchanged.

---

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
npm run v24:full-lifecycle-e2e-test
node --test tests/execution-v24-pretrade-full-e2e.test.mjs

npm run analytics:test
```

---

## Documentation

Use:

- `USER-GUIDE.md` — current operator procedure;
- `docs/ExecutionOS_Documentation_Index.md` — authority/status map;
- `DOCUMENTATION-STATUS.md` — current vs historical records;
- `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_APPROVED.md` — frozen current V2.4 architecture;
- `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_Traceability_Audit_APPROVED.md` — Decision 22–97 coverage;
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Closeout_2026-09-06.md` — accepted Slices 1–7 implementation evidence;
- Phase 3/4 closeouts — subsystem acceptance evidence;
- `docs/ExecutionOS_EOD_Report.md` — reporting semantics.

Historical approved documents remain preserved as approval-time evidence even when their implementation-status wording is no longer current.