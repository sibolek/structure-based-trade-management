# ExecutionOS Documentation Status

**Updated:** 2026-09-12

This file distinguishes current authoritative project records from historical planning snapshots and dated approval artifacts.

---

## Current authoritative records

### `USER-GUIDE.md`

Living operator guide for the accepted V2.4 system now merged to `main`.

Stable operating branch:

```text
main
```

Release distinction:

- V2.4 Phases 1–4 are merged to `main`;
- the accepted PRETRADE → ARM → Execution Board integration is also merged to `main`;
- final merged implementation checkpoint: `26ad8f86d2f0b4af96c186b26f250f4bb10a9dec`;
- subsequent documentation-only commits may advance the tip of `main` without changing that accepted implementation checkpoint;
- the former feature branch `v24-execution-board-handoff` has been retired and deleted;
- accepted SOD rendering remains isolated on `v24-sod-orchestration-lineage`; production-provider hardening is active on `v24-sod-production-analysis-provider`, and automated SOD is not yet an operator-ready `main` capability;
- manual SOD / standalone trade-card ingestion is implementation-accepted on `v24-manual-sod-trade-card-ingestion` at `b2a1a20f60b12f011fe2f5ff87d325752131ac06`; merge/main release and any later operator-facing Submit workflow remain pending.

### Current frozen / approved design authority

- `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_APPROVED.md` — consolidated V2.4 PRETRADE → ARM architecture and Decisions 22–97.
- `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_Traceability_Audit_APPROVED.md` — approved 76/76 Decision 22–97 traceability companion.
- `docs/ExecutionOS_V2.4_PRETRADE_Quantity_Safety_Addendum_v0.1_APPROVED.md` — approved September 8 PRETRADE quantity-safety policy supplement; Phase 4 stop-risk sizing and effective-stop semantics remain unchanged.
- `docs/sod/ExecutionOS_V2.4_SOD_Artifact_Rendering_Baseline_v1.0.md` — accepted/frozen deterministic SOD rendering authority for the SOD feature branch at checkpoint `4144c5c59494ae318bb736d64fba751a22046512`.
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md` — approved/frozen manual SOD and standalone trade-card ingestion architecture, implementation contracts, Contract Reconciliations A–B, and Acceptance Test Matrix A–T.
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Implementation_Handoff_v1.0.md` — approved Codex implementation handoff constrained by the manual-ingestion design baseline.
- `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Design_Baseline_v1.0_APPROVED.md` — approved/frozen production SOD/OpenAI provider hardening, response trust, resource limits, durable run identity/recovery, PRETRADE freshness, readiness, and Acceptance Matrix A–V.
- `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Implementation_Handoff_v1.0.md` — approved Codex implementation handoff constrained by the production-provider baseline; not implementation evidence.

The v0.5 baseline supersedes conflicting earlier top-level design assumptions. Earlier approved baselines/addenda remain frozen historical approval-time evidence and should not be rewritten to simulate later state. The quantity-safety addendum supplements the frozen baseline for its narrowly defined PRETRADE policy. The SOD rendering baseline governs only its isolated feature-branch scope and does not rewrite the frozen PRETRADE→ARM→Execution architecture. The manual-ingestion baseline remains the frozen design authority for its explicit manual-submission scope; implementation acceptance is recorded separately in the September 11 closeout. The production-provider baseline governs only the September 12 hardening/run-integrity slice and is not implementation or live-provider acceptance evidence.

### Accepted implementation / closeout records

- `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md`.
- `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md`.
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Closeout_2026-09-06.md` — Slices 1–7 accepted implementation and September 6 validation evidence.
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Final_Merge_Closeout_2026-09-08.md` — final merge, TODO #18/#19 completion, regression, branch/worktree retirement, and September 8 repository closeout.
- `docs/sod/ExecutionOS_V2.4_SOD_Artifact_Rendering_Baseline_v1.0.md` — accepted/frozen SOD artifact-rendering implementation boundary and September 9 acceptance evidence.
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md` — user-accepted manual-ingestion implementation and validation record at `b2a1a20f60b12f011fe2f5ff87d325752131ac06`.

---

## Current implementation / release state

### Frozen downstream execution release

```text
v2.3.0
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

Legacy/manual V2.3 remains the frozen downstream reference. V2.4-origin trades use the accepted exact-account ownership/lifecycle path and do not use the legacy symbol-only / `detectedAt` ownership path.

### V2.4 merged state on `main`

- Phase 1 Candidate Ingestion — **COMPLETE / MERGED**;
- Phase 2 MarketDataProvider — **COMPLETE / MERGED / LIVE-ACCEPTED**;
- Phase 3 DSS / Micro-Volatility Buffer — **COMPLETE / ACCEPTED / MERGED**;
- Phase 4 Effective-Stop Risk Sizing — **COMPLETE / ACCEPTED / MERGED via PR #14**;
- PRETRADE → ARM → Execution Board handoff integration — **COMPLETE / ACCEPTED / MERGED**;
- TODO #18 structural-evidence UX enforcement — **COMPLETE / CLOSED**;
- TODO #19 PRETRADE quantity-safety policy — **COMPLETE / CLOSED**.

Final merged implementation checkpoint:

```text
26ad8f86d2f0b4af96c186b26f250f4bb10a9dec
```

Status:

```text
SLICES 1–7: ACCEPTED / CLOSED
DECISIONS 22–97: FROZEN
TODO #18: COMPLETED / CLOSED
TODO #19: COMPLETED / CLOSED
BROKER AUTHORITY: READ ONLY / NO BROKER WRITES
```

### Active SOD orchestration / lineage feature branch

```text
v24-sod-orchestration-lineage
```

Accepted/frozen through:

```text
4144c5c59494ae318bb736d64fba751a22046512
```

Accepted capabilities through this checkpoint:

- strict automated candidate-ingress policy and byte-preserving Candidate Feeder path;
- SOD candidate lineage classification: NEW / UNCHANGED / REVISED;
- source-date collision protection and exact prior immutable-contract reuse;
- separation of lineage classification from PRETRADE supersession authority;
- atomic candidate publication;
- vendor-neutral analysis-provider contract with no lifecycle/execution/path authority;
- loopback SOD orchestration service and browser-client boundary;
- trusted immutable raster chart ingestion using opaque `sod-chart:` refs;
- provider access to chart bytes only through the authorized resolver boundary;
- exact 19-section structured SOD content contract;
- deterministic canonical Markdown report rendering;
- deterministic canonical dark HTML rendering with persistent 250px TOC and compact A+ trade cards;
- deterministic light-theme SOD dashboard rendering;
- mandatory VIX context;
- renderer-owned standing execution, risk, and process rules;
- A+ Trades and Morning Priority rendered from canonical post-export/post-lineage candidates;
- unchanged PRETRADE → ARM → read-only Execution authority boundary.

Not yet complete:

- production-provider hardening and run-integrity acceptance under the September 12 baseline;
- credentialed live OpenAI acceptance evidence;
- complete operator-ready automated SOD workflow;
- release/merge of SOD orchestration to `main`;
- authoritative automated REVISED-candidate supersession preflight remains an explicit later design/implementation decision.

Substantial OpenAI Responses adapter, production HTTP transport, provider-module wiring, browser initiation, structured output, and mocked tests already exist. That code is starting implementation, not an accepted production capability under the hardening baseline.

Manual ChatGPT Start-of-Day generation remains the current manual-generation workflow. The accepted manual-ingestion feature-branch implementation provides the explicit Manual Proposal Inbox-to-PRETRADE path for its structured candidate artifacts, but it has not yet been merged or released to `main`.

### Active production SOD analysis-provider hardening branch

```text
v24-sod-production-analysis-provider
```

Exact design and implementation base:

```text
e2357933147600e702c5e252020b257debbe3392
```

Governing baseline:

```text
docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Design_Baseline_v1.0_APPROVED.md
```

Implementation handoff:

```text
docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Implementation_Handoff_v1.0.md
```

Current status:

```text
DESIGN: APPROVED / FROZEN
IMPLEMENTATION: PENDING
LIVE PROVIDER ACCEPTANCE: PENDING
MERGE / MAIN RELEASE: PENDING
BROKER AUTHORITY: READ ONLY / NO BROKER WRITES
```

The approved scope hardens artifact-link trust, chart/request/response resources, strict local structured-output validation, durable per-date run identity and recovery, post-provider PRETRADE freshness, pre-publication authority fencing, deterministic publication recovery, readiness reporting, and explicit live acceptance. It preserves candidate identity and all existing PRETRADE, Candidate Feeder, ARM, execution, and broker boundaries.

### Active manual SOD / trade-card ingestion feature branch

```text
v24-manual-sod-trade-card-ingestion
```

Created from accepted predecessor commit:

```text
ecd007e7ab34e81b5d1500b0c72f3556a62ea626
```

Governing baseline:

```text
docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md
```

Implementation handoff:

```text
docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Implementation_Handoff_v1.0.md
```

Implementation closeout:

```text
docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md
```

Current feature-branch status:

```text
DECISIONS 1–31: APPROVED / FROZEN
CONTRACT RECONCILIATIONS A–B: APPROVED / FROZEN
IMPLEMENTATION CONTRACTS 1–4: APPROVED / FROZEN
ACCEPTANCE TEST MATRIX A–T: APPROVED / FROZEN
DESIGN: APPROVED / FROZEN
IMPLEMENTATION: ACCEPTED
ACCEPTED SHA: b2a1a20f60b12f011fe2f5ff87d325752131ac06
MERGE / MAIN RELEASE: PENDING
BROKER AUTHORITY: READ ONLY / NO BROKER WRITES
```

Accepted implementation includes:

- explicit submission semantics at the dedicated Dropbox Manual Proposal Inbox boundary;
- dedicated Dropbox Manual Proposal Inbox;
- strict closed/versioned manual-ingestion envelope;
- open/extensible candidate JSON with arbitrary optional content substantive by default;
- independent optional `managementPlan` and required machine-defined `managementContract`;
- deterministic bounded canonicalization and structural safety limits;
- durable submission claim/journal/reconciliation and crash recovery;
- explicit submission identity independent of candidateId and contractVersion;
- preserved NEW / UNCHANGED / REVISED lineage;
- state-bound PRETRADE authorization for every materially REVISED manual candidate;
- canonical substantive diff and explicit confirmation before supersession;
- removal of permissive unspecified/null production ingress semantics;
- Candidate Feeder remains transport only;
- mandatory dedicated manual-ingestion tests plus existing SOD/feeder/build/full-V2.4 regression gates;
- publication as nonterminal transport progress until authoritative PRETRADE/Candidate Feeder resolution;
- deterministic receipt ordering, explicit durable decline, ACTION_REQUIRED resumption, and fail-closed recovery ambiguity handling.

The design baseline and implementation handoff remain frozen historical authority records. Runtime implementation acceptance is claimed only by the separate September 11 closeout at the accepted SHA above.

### Retired integration branch

Former branch:

```text
v24-execution-board-handoff
```

After verified fast-forward merge to `main`, the feature worktree, local branch, and remote branch were retired/deleted. It is no longer an operating branch.

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
→ IMMUTABLE EXECUTION BOARD HANDOFF
→ PENDING
→ CLAIMED
→ PREPARED
→ LISTENING
→ EXACT-ACCOUNT OPENING FILL
→ LIVE
→ PARTIAL / SCALE / MANAGEMENT
→ FLAT
→ EXIT
→ OPERATOR EXIT CLASSIFICATION
→ HISTORY
→ SYMBOL OWNERSHIP RELEASE
```

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3-compatible execution infrastructure owns execution.**

The browser is presentation/operator-intent only. Server-side PRETRADE services remain authoritative for lifecycle, trigger, permission, review, OCO, and ARM. Downstream canonical store authorities remain separate and serialized.

For SOD-related feature work, upstream publication remains proposal-only: SOD analysis/rendering/manual ingestion cannot ARM, create execution handoff, or acquire broker-write authority merely through candidate creation or submission.

---

## Accepted PRETRADE / ARM capabilities

Implemented/accepted:

- canonical candidate import, validity, hashing, versioning and supersession;
- trigger relevance/satisfaction separation and durable trigger evidence;
- immutable permission attempts;
- structural-validity authority;
- operator `STRUCTURE = VALID` requires a non-empty structural evidence/reference before permission submission;
- browser wording and button state enforce that requirement while backend `MISSING_STRUCTURE_PROVENANCE` enforcement remains authoritative;
- Phase 3 DSS + Phase 4 risk integration;
- `READY / CAUTION / PASS` permission outcomes;
- retryable/integrity blockers;
- material review-package identity;
- explicit quantity selection;
- separate PRETRADE quantity-safety evaluation using authoritative DSS 2-minute Wilder ATR(14);
- 2-ATR volatility-stress maximum quantity is evaluated separately from Phase 4 stop-risk sizing;
- first explicit review freezes the candidate/version reviewed quantity ceiling;
- final allowed quantity is bounded by Phase 4 max, 2-ATR volatility max, and the reviewed ceiling;
- ARM-time fresh revalidation may reduce that ceiling but may not increase it without a new explicit operator review;
- the quantity-safety policy does not move structural invalidation or effective stop and does not rewrite Phase 4 `riskDistance` or `plannedDollarRisk`;
- exact-package CAUTION acknowledgement;
- OCO grouping and same-symbol ARM gate;
- ARM as the final explicit direction/quantity confirmation, with the exact account exposed in the current review package and frozen by ARM;
- fresh final ARM revalidation;
- durable ARM operation journal and recovery;
- immutable ARMED provenance;
- immutable handoff + PENDING delivery creation;
- PRETRADE Active, Authorized/Execution, and History projections;
- no generic browser lifecycle or ARM authority.

Imported WAITING candidates remain proposals until the explicit operator/server workflow advances them. They are not auto-ARMED by the runtime router.

---

## Accepted downstream/runtime capabilities

Implemented/accepted:

- immutable V2.4 authorization/handoff provenance;
- handoff persistence and delivery state machine;
- stable browser receiver identity;
- exact-account broker cleanliness/admission;
- authoritative Schwab `executionTime` and lossless activity/journal proof;
- PREPARED/LISTENING installation and immutable `executionListeningAt`;
- universal pre-fill DISCARD/retirement with immutable cutoff;
- exact-account first-fill ownership;
- atomic LIVE lifecycle + visible V2.4 Execution Board promotion;
- fragmented-entry / ADD / PARTIAL / FLAT / REVERSAL lifecycle semantics;
- canonical browser store authority and serialized cross-tab writes;
- serialized top-level runtime router;
- read-only full trade-specification inspector;
- default-on router with negative emergency pause only;
- router health/telemetry;
- reload/HMR/remount/takeover recovery;
- no broker-write authority.

---

## Accepted Slice 7 live-management capabilities

- immutable first-entry authorization deadline;
- no deadline extension due to delay/restart/recovery;
- late opening fill preserved as broker truth + authorization exception, never retroactive authorization;
- immutable ARM quantity ceiling;
- finite position-build window;
- explicit Complete Position Build;
- downward-only live ceiling after unused capacity is relinquished/expired;
- re-add gating within authorized identity and live ceiling;
- exposure-increase risk checks;
- finite lifecycle loss budget;
- realized losses consume capacity; profits do not replenish it;
- explicit live effective-stop authority and audit trail;
- tighter stop can free risk only within existing ceilings;
- wider stop cannot manufacture capacity;
- structured target observations;
- discretionary notes with no machine authority;
- durable CRITICAL Authorization Exceptions;
- explicit Authorization Exception reconciliation;
- retired-authorization late-fill recovery/attribution;
- managed router recovery;
- narrow legacy V2.4 management compatibility.

---

## Current intentionally incomplete / deferred areas

### SOD orchestration

- production analysis-provider hardening/run-integrity implementation;
- credentialed live provider acceptance;
- final end-to-end operator-ready automated SOD workflow;
- automated REVISED-candidate PRETRADE supersession preflight;
- merge/release to `main`.

### Manual SOD / trade-card ingestion

- merge/release of the accepted feature-branch checkpoint to `main`;
- any later operator-facing Submit action/workflow/UI not contained in the accepted implementation.

### Broader ExecutionOS

- broker order placement/replacement/cancellation/modification/flattening;
- a general broker-write Governor;
- buying-power/margin eligibility and aggregate portfolio-heat gates;
- live NinjaTrader execution binding;
- cloud/multi-device authority;
- a general reconciliation-resolution workflow for every possible broker coverage/provenance failure beyond the implemented Authorization Exception reconciliation path;
- V3 Management Governor.

V3 has not started.

---

## Runtime router model

The runtime router is default-on in the accepted V2.4 implementation on `main`.

Emergency negative switch:

```text
VITE_EXECUTIONOS_V24_ROUTER_DISABLED=true
```

Interpretation:

```text
unset / false -> enabled
true          -> PAUSED
other nonempty value -> BLOCKED / fail closed
```

The retired positive enable flag must not be used.

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

Reconciliation remains durable trade/ownership state, not router health.

---

## Broker safety boundary

```text
readOnly === true
brokerWriteAuthority === false
```

ExecutionOS does not place, replace, cancel, modify, reduce, or flatten broker orders.

Actual equity order entry remains in thinkorswim/Schwab.

SOD orchestration, deterministic rendering, chart ingestion, Candidate Feeder work, and the accepted manual-ingestion implementation introduce **no broker-write authority**.

---

## Final acceptance evidence

### Stable `main` release

September 6 closeout evidence remains preserved in the historical integration closeout. Final September 8 acceptance added the TODO #18/#19 fixes and reran the comprehensive pre-merge regression/build sequence successfully.

```text
Focused Slice 7:                  26 / 26 PASS
Downstream lifecycle E2E:          1 / 1 PASS
Canonical PRETRADE→Execution E2E:  1 / 1 PASS
September 8 comprehensive regression: GREEN
Production Vite build:            PASS
Final merged implementation SHA:  26ad8f86d2f0b4af96c186b26f250f4bb10a9dec
Broker writes introduced:         NONE
```

### SOD rendering checkpoint

September 9 acceptance evidence:

```text
Focused SOD / rendering / orchestrator:  58 / 58 PASS
SOD + renderer + feeder + PRETRADE:     111 / 111 PASS
Canonical PRETRADE→Execution E2E:         1 / 1 PASS
Production Vite build:                    PASS
Worktree:                                 CLEAN
Accepted checkpoint:                      4144c5c59494ae318bb736d64fba751a22046512
Broker writes introduced:                 NONE
```

The SOD acceptance verifies that trusted chart ingestion, structured provider boundaries, deterministic artifacts, candidate lineage/publication, Candidate Feeder behavior, canonical PRETRADE ingress, and the existing execution-authority lifecycle remain compatible.

The canonical PRETRADE→Execution E2E verifies real ingress, lifecycle, permission, review, ARM, immutable handoff, read-only transport/router ownership, partial/flat lifecycle, History, and symbol-ownership release in one synthetic path.

### Manual-ingestion implementation acceptance

September 11 accepted implementation evidence:

```text
Architecture Decisions 1–31:       APPROVED / FROZEN
Contract Reconciliations A–B:      APPROVED / FROZEN
Implementation Contracts 1–4:      APPROVED / FROZEN
Acceptance Test Matrix A–T:        APPROVED / FROZEN
Targeted validation:               ALL PASS
Full V2.4 regression:              ALL PASS
Production Vite build:             PASS — 1,624 modules transformed
Implementation acceptance:         USER ACCEPTED
Accepted implementation SHA:       b2a1a20f60b12f011fe2f5ff87d325752131ac06
Merge / main release:              PENDING
Broker writes introduced:          NONE
```

The complete targeted and full-regression counts are recorded in `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md`.

---

## EOD reporting status

EOD enrichment remains origin-aware:

```text
V24_HANDOFF        -> v24.effectiveStop
LEGACY_MANUAL_V23  -> originalPlan.structuralStop
```

V2.4 structural invalidation remains separate provenance and is not substituted for `v24.effectiveStop` in planned-risk calculations. Slice 7 live managed-stop changes do not rewrite the EOD planned-risk stop basis.

---

## Other current references

- `README.md` — current repository overview for the stable operating release.
- `USER-GUIDE.md` — current operator procedure for accepted `main` behavior.
- `docs/ExecutionOS_Documentation_Index.md` — authority/status map across `main` and active feature work.
- `docs/sod/ExecutionOS_V2.4_SOD_Artifact_Rendering_Baseline_v1.0.md` — accepted/frozen SOD rendering authority.
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md` — approved/frozen manual-ingestion architecture and implementation contract.
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Implementation_Handoff_v1.0.md` — Codex implementation handoff for the manual-ingestion slice.
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md` — accepted manual-ingestion implementation and validation record.
- `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Design_Baseline_v1.0_APPROVED.md` — approved/frozen production SOD provider hardening and run-integrity design authority.
- `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Implementation_Handoff_v1.0.md` — approved implementation handoff constrained by that baseline.
- `docs/ExecutionOS_EOD_Report.md` — EOD technical/operational reference.
- `docs/ExecutionOS_V2.4_PRETRADE_Quantity_Safety_Addendum_v0.1_APPROVED.md` — approved quantity-safety policy authority.
- `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Final_Merge_Closeout_2026-09-08.md` — final merge and repository closeout record.
- `docs/ExecutionOS_Project_Specification_v1.2_2026-08-26.md` — dated V2.3-era architecture record.
- `research/30-day-management-study/methodology.md` — historical analytics provenance.

`README.md` and `USER-GUIDE.md` should not describe automated SOD as operator-ready until its production workflow is implemented and accepted. They should not describe manual ingestion as a `main` operator capability until the accepted feature-branch checkpoint is merged/released and any required operator-facing workflow is actually available.

---

## Pull requests / repository records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS implementation; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 Effective-Stop Risk Sizing; merged.
- Execution Board handoff integration — accepted/closed and fast-forwarded directly to `main` at implementation commit `26ad8f86d2f0b4af96c186b26f250f4bb10a9dec` on 2026-09-08; the former feature branch was then retired/deleted.
- GitHub issue #18 — structural evidence required for operator `VALID`; **COMPLETED / CLOSED**.
- GitHub issue #19 — PRETRADE near-stop quantity-safety policy; **COMPLETED / CLOSED**.
- SOD artifact rendering — **ACCEPTED / FROZEN** on `v24-sod-orchestration-lineage` at `4144c5c59494ae318bb736d64fba751a22046512`.
- Manual SOD & Trade-Card Ingestion — **DESIGN APPROVED / FROZEN; IMPLEMENTATION USER ACCEPTED** on `v24-manual-sod-trade-card-ingestion` at `b2a1a20f60b12f011fe2f5ff87d325752131ac06` on 2026-09-11; merge/main release pending.
- Production SOD Analysis Provider Hardening & Run Integrity — **DESIGN APPROVED / FROZEN; IMPLEMENTATION PENDING; LIVE PROVIDER ACCEPTANCE PENDING** on `v24-sod-production-analysis-provider` from base `e2357933147600e702c5e252020b257debbe3392`; merge/main release pending.

---

## Documentation rule

Current validated code/runtime defines what the system actually does. `USER-GUIDE.md` translates released `main` behavior into operator procedure. The v0.5 baseline and traceability audit preserve frozen architecture. The approved quantity-safety addendum preserves the September 8 PRETRADE safety policy. The SOD artifact-rendering baseline preserves the accepted September 9 feature-branch rendering boundary. The manual SOD/trade-card ingestion baseline preserves the approved September 10 manual-ingestion architecture and implementation contract. The production SOD provider baseline preserves the approved September 12 hardening, run-integrity, PRETRADE-freshness, readiness, and acceptance requirements.

Do not rewrite frozen approved design records merely because implementation advanced. Keep released operator documentation distinct from accepted feature-branch implementation records until the feature is merged and released.
