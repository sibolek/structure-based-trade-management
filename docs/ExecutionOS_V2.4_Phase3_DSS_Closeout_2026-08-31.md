# ExecutionOS V2.4 — Phase 3 DSS / Micro-Volatility Buffer Closeout

**Date:** 2026-08-31  
**Status:** IMPLEMENTATION COMPLETE / ACCEPTED  
**Project:** `sibolek/structure-based-trade-management`  
**Implementation branch:** `v24-dss-phase3`  
**Design authority:** `docs/ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md`  
**Relationship to V2.3:** Upstream pre-trade decision support only; frozen/trusted V2.3 execution ownership remains unchanged  

---

## 1. Closeout decision

ExecutionOS V2.4 **Phase 3 — DSS / Micro-Volatility Buffer** is accepted as implementation-complete as of 2026-08-31.

Phase 3 now deterministically transforms an already-resolved structural invalidation into an immutable, volatility-protected `effectiveStop` using fresh, validated market data and trusted instrument metadata.

The governing boundary remains:

```text
STRUCTURAL INVALIDATION
        ↓
PHASE 3 MICRO-VOLATILITY BUFFER
        ↓
EFFECTIVE STOP
        ↓
PHASE 4 RISK SIZING
```

Phase 3 determines the correct protected stop. It does **not** determine whether the trade is affordable and it does **not** alter the stop to make a trade affordable.

> If the correct stop is unaffordable, downstream sizing must reduce size or pass the trade.

---

## 2. Implemented Phase 3 scope

Phase 3 implementation includes:

- canonical pre-trade lifecycle terminology and legacy-state normalization;
- deterministic 2-minute Wilder ATR(14) reconstruction;
- RTH-only ATR policy;
- versioned trusted DSS policy;
- deterministic effective-stop calculation;
- directionally protective price-increment rounding;
- immutable DSS evaluation contract and provenance;
- strict quote/bar freshness and market-data integrity validation;
- DSS lifecycle persistence and immutable evaluation history;
- DSS runtime reuse, staleness, retry, freeze, and exact handoff behavior;
- live Schwab input assembly from read-only market data;
- final live-quote refresh before DSS evaluation;
- verified instrument-price-increment metadata resolution;
- pre-variable-MPI Reg NMS Rule 612 equity fallback with an explicit future cutoff;
- read-only live DSS capability probe;
- production permission-service integration joining persisted candidate identity, live input assembly, DSS runtime, persistence, and exact Phase 4 handoff;
- visible candidate ingestion/persistence/PRE-TRADE UI smoke testing.

No Phase 4 sizing, READY/CAUTION/PASS decision gate, ARM authority, broker order placement, stop replacement, cancellation, or flattening authority was added.

---

## 3. Frozen DSS calculation policy

The accepted Phase 3 V1 policy is:

| Item | Accepted rule |
|---|---|
| Structural / decision timeframe | 5m |
| Entry timeframe | 2m |
| Micro-volatility measure | Wilder ATR(14), 2m |
| Session data used for ATR | RTH only |
| First RTH bar true range | `high - low`; overnight gap excluded |
| Wilder state | Carries across RTH sessions |
| Reconstruction history | 20 completed RTH sessions + current RTH session when applicable |
| Forming bars | Excluded |
| Persisted authoritative ATR accumulator | None |
| Extended-hours ATR updates | None |
| Volatility buffer | `ATR(14,2m) × 0.30` |
| LONG raw effective stop | structural invalidation − buffer |
| SHORT raw effective stop | structural invalidation + buffer |
| LONG rounding | Down to valid `priceIncrement` |
| SHORT rounding | Up to valid `priceIncrement` |
| Quote maximum age | 5 seconds |
| Newly completed 2m publication grace | 10 seconds |
| DSS statuses | `VALID`, `BLOCKED`, `ERROR` only |

No arbitrary minimum/maximum volatility clamp is applied.

A legitimately large ATR produces a larger buffer and a wider effective stop. Any affordability consequence belongs to Phase 4.

---

## 4. Market-data integrity and ATR reconstruction

Phase 3 reconstructs ATR from normalized source bars rather than trusting a persisted indicator accumulator.

Accepted integrity behavior includes:

- source 1-minute RTH continuity validation;
- missing and duplicate minute detection;
- deterministic aggregation to aligned 2-minute bars;
- source completeness and temporal closure treated separately;
- incomplete or forming 2-minute intervals excluded;
- current-session reconstruction beginning at 09:30 ET;
- premarket evaluation using the most recent valid completed RTH ATR without PM bars;
- after-hours evaluation requiring the current day's supplied RTH session to be complete;
- fail-closed behavior for malformed, missing, duplicate, forming, extended-hours, or insufficient history.

Completed historical raw 1-minute sessions may be cached in memory as immutable source data. The ATR accumulator itself is not persisted as authority.

---

## 5. Effective-stop calculation

The effective-stop calculator resolves the trusted DSS policy internally. Candidate payloads cannot override the approved multiplier or policy version.

For a LONG:

```text
rawBuffer = ATR(14,2m) × 0.30
rawEffectiveStop = structuralInvalidation - rawBuffer
effectiveStop = protectiveRoundDown(rawEffectiveStop, priceIncrement)
```

For a SHORT:

```text
rawBuffer = ATR(14,2m) × 0.30
rawEffectiveStop = structuralInvalidation + rawBuffer
effectiveStop = protectiveRoundUp(rawEffectiveStop, priceIncrement)
```

Protective rounding may never reduce the intended stop protection.

---

## 6. Instrument price-increment metadata

Live Schwab testing established that an equity quote can return `tick: 0`, which is not sufficient evidence for executable price-increment rounding.

Phase 3 therefore does not silently assume `$0.01` merely because an instrument is labeled `EQUITY`.

Accepted metadata priority is:

1. positive live quote tick when supplied by the provider;
2. a verified metadata resolver with explicit provider/provenance;
3. otherwise fail closed with an invalid/unverified price increment.

For the current pre-variable-MPI U.S. NMS-equity regime, the implementation includes a narrowly scoped Reg NMS Rule 612 resolver. It requires evidence consistent with an exchange-listed NBBO equity and rejects unsupported, ambiguous, or explicitly OTC cases.

The resolver carries explicit provenance:

```text
provider = SEC_REG_NMS_RULE_612
regime = PRE_VARIABLE_MPI_RULE_612
```

The legacy penny-regime fallback has a hard boundary at:

```text
2026-11-02
```

On and after that date, absent an authoritative symbol-specific MPI source, the resolver fails closed with `VARIABLE_MPI_SOURCE_REQUIRED` rather than continuing to assume a penny increment.

This boundary must be revisited before or at the variable-MPI transition.

---

## 7. Immutable DSS evaluation and lifecycle behavior

Each DSS calculation produces an immutable evaluation with a unique `dssEvaluationId` and complete candidate, structure, policy, market-data, ATR, rounding, and stop provenance.

Accepted lifecycle behavior:

```text
WAITING
   ↓
PRETRADE_TRIGGER_EVALUATING
   ↓
PERMISSION_EVALUATING
   ↓
Phase 3 DSS evaluation
```

Rules:

- Phase 3 evaluation is not continuously recomputed while a candidate is merely WAITING.
- New DSS calculations occur only when pre-trade permission evaluation requires them.
- A fresh `VALID` evaluation is reused on quote-only permission activity.
- Quote ticks alone do not trigger ATR/effective-stop recalculation.
- A newer completed 2-minute bar marks the current evaluation stale while permission remains active.
- The next permission cycle after staleness may create a new immutable evaluation.
- `BLOCKED` and `ERROR` evaluations are retained for audit and may be retried.
- Candidate structural-definition changes require an explicit candidate revision/version; Phase 3 does not mutate candidate structure.
- Once a DSS evaluation is authorized for ARM, that exact evaluation identity freezes Phase 3.
- Phase 3 performs no post-ARM recalculation.

Persisted evaluation identities are append-only and may not be reused.

---

## 8. Production permission-service integration

The final Phase 3 integration joins the previously separate live-input and persisted-runtime boundaries:

```text
PERSISTED CANDIDATE
        ↓
exact source / candidateId / contractVersion / contentHash
        ↓
upstream structural definition + structureEvaluation
        ↓
LIVE DSS INPUT ASSEMBLY
        ↓
DssRuntime
        ↓
immutable persisted DSS evaluation
        ↓
exact dssEvaluationId
        ↓
Phase 4 handoff
```

The persisted candidate is authoritative for candidate identity.

The permission service preserves these behaviors:

- source-scoped identity mismatch fails before market-data assembly;
- evaluation outside `PERMISSION_EVALUATING` fails before market-data assembly;
- a fresh `VALID` DSS evaluation is reused without unnecessary structure reevaluation or market-data reads;
- a newer completed 2-minute bar permits reassembly/recalculation;
- `BLOCKED` / `ERROR` outcomes remain retryable;
- authorized DSS identity freezes further Phase 3 work;
- Phase 4 handoff returns the exact immutable `VALID` evaluation and exact `dssEvaluationId`.

Phase 3 does not own state-transition authority into READY, CAUTION, PASS, or ARM.

---

## 9. Live Schwab end-to-end acceptance

A read-only live probe was run on 2026-08-31 using NVDA with a deliberately synthetic LONG structural invalidation of `216.25`.

The structural price was diagnostic operator input only; it was **not** a trade recommendation or authorization.

Observed live result:

```text
Symbol/direction: NVDA LONG
Probe structure:  216.25 — synthetic operator input
Quote:            bid 218.02 · ask 218.03 · last 218.02 · mark 218.02
Quote age at DSS: 375 ms
Instrument:       EQUITY
Listing evidence: Nasdaq (Q) · NBBO
Schwab tick:      0
Price increment:  0.01 · VERIFIED_METADATA_RESOLVER
Metadata provider: SEC_REG_NMS_RULE_612
Reg NMS regime:   PRE_VARIABLE_MPI_RULE_612

ATR sessions:     20/20 completed RTH
Evaluation sess.: RTH
Execution bars:   4061 complete 2m RTH bars
DSS status:       VALID
Reason codes:     none
ATR(14,2m):       0.250291
Raw buffer:       0.075087
Effective stop:   216.17
```

Calculation check:

```text
ATR = 0.250291
buffer = 0.250291 × 0.30
       = 0.0750873

raw LONG effective stop
= 216.25 - 0.0750873
= 216.1749127

protective penny rounding
= 216.17
```

This established the complete live Phase 3 calculation path:

```text
real Schwab quote
    ↓
validated fresh market snapshot
    ↓
verified listing / price-increment provenance
    ↓
20-session + current-session RTH reconstruction
    ↓
Wilder ATR(14), 2m
    ↓
0.30 ATR buffer
    ↓
directionally protective rounding
    ↓
VALID effective stop
```

The probe remained read-only and performed no Phase 4 sizing, READY/CAUTION/PASS decision, ARM, or broker write.

---

## 10. Candidate ingestion → PRE-TRADE UI smoke acceptance

On 2026-08-31 a synthetic `MANUAL_TEST` NVDA LONG candidate was submitted through the real candidate import boundary:

```text
POST /api/candidates/import
```

The candidate was accepted into `WAITING`, persisted by the V2.4 pre-trade service, returned through:

```text
GET /api/candidates
```

and visibly rendered in the browser's **PRE-TRADE → Waiting Candidate Board**.

The displayed test card correctly showed:

- symbol/direction: NVDA LONG;
- setup: `ExecutionOS UI smoke test`;
- lifecycle status: `WAITING`;
- trigger: `TEST TRIGGER @ 218 ABOVE`;
- structural invalidation: `216.25`;
- target: `220`;
- requested ARM mode: `MANUAL`;
- source: `MANUAL_TEST`;
- synthetic thesis text.

This proves:

```text
candidate JSON
    ↓
import API
    ↓
validation / normalization
    ↓
persistence
    ↓
WAITING
    ↓
GET /api/candidates
    ↓
UI polling
    ↓
PRE-TRADE candidate card
```

It does **not** prove candidate transfer into the existing V2.3 Execution Board, and it should not: a WAITING candidate is not ARMED and is not eligible to bind a broker fill.

The later path remains:

```text
WAITING
   ↓
permission evaluation
   ↓
Phase 3 DSS
   ↓
Phase 4 sizing
   ↓
context / decision gate
   ↓
READY
   ↓
ARM
   ↓
existing V2.3 Execution Board
```

That downstream ARM-boundary acceptance remains future V2.4 work.

---

## 11. Final deterministic acceptance gate

The final Phase 3 closeout gate was executed in the user's local Phase 3 worktree on 2026-08-31.

Results:

```text
v24:dss-test       91/91 PASS
analytics:test     123/123 PASS
schwab:state-test  10/10 PASS
production build   PASS
```

The focused DSS suite includes the final permission-service production-integration tests covering:

- persisted candidate identity and upstream structure preservation;
- fail-before-assembly outside `PERMISSION_EVALUATING`;
- source-scoped identity mismatch;
- fresh VALID reuse without structure/market-data work;
- completed-2m-bar staleness and subsequent new evaluation;
- retry of BLOCKED/ERROR outcomes;
- authorized DSS freeze;
- exact immutable Phase 4 risk handoff.

The full regression suite completed with zero failures, and the frozen V2.3 deterministic trade-state suite remained 10/10 green.

---

## 12. Safety and authority boundary at closeout

Phase 3 has **no authority** to:

- size a trade;
- decide READY / CAUTION / PASS;
- ARM a candidate;
- place an order;
- change or cancel a broker order;
- replace a stop;
- flatten a position;
- take ownership of a broker fill.

The Schwab market-data boundary remains read-only.

The existing trusted V2.3 execution-management layer remains downstream and unchanged in authority.

---

## 13. Phase 3 → Phase 4 handoff

Phase 3 hands Phase 4 only a fresh, non-stale, immutable `VALID` DSS evaluation containing:

- resolved structural invalidation;
- `effectiveStop`;
- exact DSS provenance;
- exact `dssEvaluationId`.

Phase 4 must independently obtain fresh:

- `currentExpectedEntry`;
- account equity / maximum dollar risk;
- required instrument value / sizing metadata.

Phase 4 sizes exclusively from `effectiveStop`.

Phase 4 may reduce position size but may never alter:

- structural invalidation;
- `effectiveStop`.

If the minimum valid position cannot fit within the configured risk budget, Phase 4 must return `NO_AFFORDABLE_SIZE`, later mapped by the permission layer to `PASS — STOP_RISK_CONFLICT`.

Every risk evaluation must reference the exact Phase 3 `dssEvaluationId`.

---

## 14. Known follow-up / deferred work

The following are intentionally **not** Phase 3 defects:

1. **Phase 4 risk-sizing design and implementation** — fresh expected-entry semantics, fresh account-risk snapshot, instrument-value conversion, minimum size, quantity rounding, risk-evaluation schema, and Phase 4 staleness/recalculation remain to be designed/implemented.
2. **READY / CAUTION / PASS decision logic** — later phase.
3. **Controlled ARM boundary** — later phase; only after all required permission inputs are valid/fresh.
4. **Transfer into existing V2.3 Execution Board** — intentionally occurs only after ARM, not from WAITING.
5. **Variable-MPI source for 2026-11-02 and later** — a symbol-specific authoritative MPI source must replace the temporary pre-variable-MPI Rule 612 fallback where Schwab does not expose a usable tick.
6. **Exchange-calendar early-close awareness** — if future live history windows expose valid shortened RTH sessions, session-calendar handling should be addressed explicitly rather than silently treating shortened sessions as corrupt or assuming a 390-minute day.
7. **Full candidate-source registry/capability policy** — broader unattended source trust remains outside Phase 3 DSS calculation scope.

---

## 15. Acceptance statement

As of 2026-08-31, ExecutionOS V2.4 Phase 3 is accepted as complete for its defined scope.

The system can now:

> consume a persisted candidate and resolved structure, obtain and validate live read-only market data, reconstruct deterministic local micro-volatility, calculate a directionally protected effective stop, persist that DSS result immutably, reuse or stale it according to the approved lifecycle, and hand the exact valid evaluation identity to downstream risk sizing.

The next implementation phase is:

**ExecutionOS V2.4 Phase 4 — Effective-Stop Risk Sizing**.
