# ExecutionOS Documentation Index

**Status:** Current documentation inventory  
**Date:** 2026-09-12<br>
**Repository:** `sibolek/structure-based-trade-management`  
**Stable operating branch:** `main`  
**Active SOD feature branch:** `v24-sod-orchestration-lineage`  
**Active manual-ingestion feature branch:** `v24-manual-sod-trade-card-ingestion`  
**Active production-provider feature branch:** `v24-sod-production-analysis-provider`<br>
**Final merged main implementation checkpoint:** `26ad8f86d2f0b4af96c186b26f250f4bb10a9dec`  
**Accepted SOD rendering checkpoint:** `4144c5c59494ae318bb736d64fba751a22046512`<br>
**Accepted manual-ingestion checkpoint:** `b2a1a20f60b12f011fe2f5ff87d325752131ac06`<br>
**Production-provider design base:** `e2357933147600e702c5e252020b257debbe3392`

---

## 1. Authority and precedence

1. **Current code and validated runtime behavior** define what the system actually does.
2. `USER-GUIDE.md` is the living operator guide for the accepted system on `main`.
3. `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_APPROVED.md` is the consolidated frozen V2.4 architectural authority for Decisions 22–97.
4. `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_Traceability_Audit_APPROVED.md` is the approved decision-coverage companion to v0.5.
5. `docs/ExecutionOS_V2.4_PRETRADE_Quantity_Safety_Addendum_v0.1_APPROVED.md` is the approved September 8 PRETRADE quantity-safety authority layered on top of Phase 4.
6. `docs/sod/ExecutionOS_V2.4_SOD_Artifact_Rendering_Baseline_v1.0.md` is the accepted/frozen authority for deterministic SOD artifact rendering on the SOD feature branch.
7. `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md` is the approved/frozen design and implementation-contract authority for the manual SOD / standalone trade-card ingestion slice.
8. `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Implementation_Handoff_v1.0.md` is the approved Codex implementation handoff constrained by that baseline.
9. `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md` is the accepted implementation and validation record for that feature-branch slice.
10. `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Design_Baseline_v1.0_APPROVED.md` is the approved/frozen authority for production SOD/OpenAI provider hardening, response trust, resource limits, durable run integrity, PRETRADE freshness, and acceptance gates.
11. `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Implementation_Handoff_v1.0.md` is the approved Codex handoff constrained by that production-provider baseline; it is not implementation evidence.
12. Closeout/status records define implemented/accepted state.
13. Earlier approved baselines/addenda remain historical approval-time evidence and do not override later frozen authority or accepted runtime behavior.

Frozen approved design records should not be rewritten merely because implementation status later advanced.

---

## 2. Current authoritative documentation

| Document | Role | Authority |
|---|---|---|
| `USER-GUIDE.md` | Current operator workflow and first-time Quick Start | **Authoritative living operator guide for `main`** |
| `docs/ExecutionOS_User_Guide.pdf` | Rendered operator guide | **Generated PDF companion to `USER-GUIDE.md`** |
| `README.md` | Current repository overview | **Current overview of merged operating system** |
| `DOCUMENTATION-STATUS.md` | Current vs historical map | **Documentation governance** |
| `docs/ExecutionOS_Documentation_Index.md` | Cross-document authority/status | **Current index** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_APPROVED.md` | Consolidated PRETRADE→ARM→Execution architecture | **Current frozen V2.4 design authority** |
| `docs/ExecutionOS_V2.4_Design_Baseline_v0.5_Traceability_Audit_APPROVED.md` | Decision 22–97 traceability | **Approved implementation companion** |
| `docs/ExecutionOS_V2.4_PRETRADE_Quantity_Safety_Addendum_v0.1_APPROVED.md` | Separate 2-ATR PRETRADE quantity-safety ceiling | **Approved current quantity-safety policy authority** |
| `docs/sod/ExecutionOS_V2.4_SOD_Artifact_Rendering_Baseline_v1.0.md` | Structured SOD content + deterministic MD/HTML/dashboard rendering | **Accepted / frozen SOD rendering authority at `4144c5c`** |
| `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md` | Manual SOD/trade-card ingestion architecture, wire contract, authority boundaries, recovery, and test matrix | **APPROVED / FROZEN design authority — implementation accepted separately at `b2a1a20f60b12f011fe2f5ff87d325752131ac06`** |
| `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Implementation_Handoff_v1.0.md` | Codex implementation instructions for the manual-ingestion slice | **Approved handoff — not implementation evidence** |
| `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md` | Manual SOD/trade-card ingestion implementation acceptance and validation record | **Accepted implementation closeout at `b2a1a20f60b12f011fe2f5ff87d325752131ac06`** |
| `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Design_Baseline_v1.0_APPROVED.md` | Production SOD/OpenAI provider hardening, response trust, resource limits, durable run identity/recovery, PRETRADE freshness, and acceptance gates | **APPROVED / FROZEN design authority — implementation pending** |
| `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Implementation_Handoff_v1.0.md` | Codex implementation handoff constrained by the frozen production-provider baseline | **Approved handoff — not implementation evidence** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Integration_Closeout_2026-09-06.md` | Slices 1–7 implementation/acceptance record | **Accepted implementation closeout** |
| `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Final_Merge_Closeout_2026-09-08.md` | Merge/TODO/regression/repository closeout | **Final handoff merge closeout** |
| `docs/ExecutionOS_V2.4_Phase3_DSS_Closeout_2026-08-31.md` | Phase 3 accepted implementation | **Accepted implementation** |
| `docs/ExecutionOS_V2.4_Phase4_Risk_Sizing_Closeout_2026-09-01.md` | Phase 4 accepted implementation | **Accepted implementation** |
| `docs/ExecutionOS_EOD_Report.md` | EOD semantics | **Current reporting reference** |

Earlier approved handoff baselines/addenda and `ExecutionOS_V2.4_Design_Baseline_v0.4_APPROVED.md` remain preserved historical evidence. Do not rewrite them merely because implementation status advanced.

The PDF user guide is generated from `USER-GUIDE.md`; if the two ever differ, the current Markdown source plus validated application behavior governs.

The automated SOD workflow remains incomplete feature-branch work. Substantial OpenAI production-provider code exists, but it is not yet hardened or accepted under the frozen production baseline. The manual-ingestion implementation is accepted on its feature branch but is not merged or released to `main`. Neither workflow is documented as an operator-ready capability in `USER-GUIDE.md` or `README.md`; those documents should change only when the corresponding operator workflow is actually released.

---

## 3. Release / branch map

### Stable operating branch: `main`

The complete accepted V2.4 PRETRADE → ARM → Execution Board integration is merged to `main`.

Final merged **implementation** checkpoint:

```text
26ad8f86d2f0b4af96c186b26f250f4bb10a9dec
```

Later documentation-only commits may advance the tip of `main` without changing that accepted implementation checkpoint.

### Active SOD feature branch

```text
v24-sod-orchestration-lineage
```

This branch layers Start of Day orchestration upstream of canonical candidate ingress while preserving PRETRADE and downstream execution authorities.

Current accepted SOD rendering checkpoint:

```text
4144c5c59494ae318bb736d64fba751a22046512
```

Accepted through this checkpoint:

- strict automated candidate ingress policy;
- local Candidate Feeder core;
- lineage resolution for NEW / UNCHANGED / REVISED;
- publication-intent separation from PRETRADE supersession authority;
- atomic candidate publication;
- vendor-neutral analysis-provider contract;
- SOD orchestration core and loopback HTTP service;
- SOD React workspace/client boundary;
- immutable trusted chart ingestion using opaque refs;
- deterministic canonical Markdown, dark HTML report, and light SOD dashboard rendering;
- candidate-derived A+ Trades and Morning Priority sections;
- preserved read-only broker boundary.

Substantial OpenAI production-provider adapter and transport code exists in this feature-line history, but it is not accepted as a production capability pending the approved hardening, run-integrity, live-validation, and release gates. Therefore this branch does not represent a complete operator-ready automated SOD workflow.

### Active production SOD analysis-provider hardening branch

```text
v24-sod-production-analysis-provider
```

Exact design and implementation base:

```text
e2357933147600e702c5e252020b257debbe3392
```

This branch preserves the existing OpenAI Responses provider, production HTTP transport, module wiring, browser initiation, SOD rendering, candidate export, lineage, publication, Candidate Feeder, PRETRADE, and downstream authority architecture. It is scoped to the production hardening requirements frozen on 2026-09-12:

- HTTP(S)-only, search-evidence-bound artifact source URLs;
- early and incremental chart/resource ceilings;
- bounded provider request, response, and structured output;
- duplicate-aware structural JSON parsing and exact local transport-schema enforcement;
- durable `runId` / `requestHash`, per-`sourceDate` single-flight, replay, and crash recovery;
- durable normalized provider results and ambiguous-outcome handling without automatic retries;
- fresh post-provider PRETRADE authority and a pre-publication freshness fence;
- recoverable deterministic publication intent/commit;
- truthful provider/model readiness;
- explicit opt-in credentialed OpenAI acceptance evidence.

Governing documents:

- `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Design_Baseline_v1.0_APPROVED.md`
- `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Implementation_Handoff_v1.0.md`

Status:

```text
DESIGN: APPROVED / FROZEN
IMPLEMENTATION: PENDING
LIVE OPENAI ACCEPTANCE: PENDING
MERGE / MAIN RELEASE: PENDING
BROKER AUTHORITY: READ ONLY / NO BROKER WRITES
```

The substantial existing implementation is starting code, not accepted implementation evidence under this baseline.

### Active manual SOD / trade-card ingestion feature branch

```text
v24-manual-sod-trade-card-ingestion
```

This branch was created from accepted predecessor commit:

```text
ecd007e7ab34e81b5d1500b0c72f3556a62ea626
```

Current accepted implementation checkpoint:

```text
b2a1a20f60b12f011fe2f5ff87d325752131ac06
```

Accepted design and implementation scope:

- explicit submission semantics at the dedicated Manual Proposal Inbox boundary;
- dedicated Manual Proposal Inbox upstream of canonical publication;
- closed/versioned manual-ingestion control envelope with open/extensible candidate content;
- explicit stable `submissionId` separate from candidateId and contractVersion;
- durable submission journal, receipt, idempotency, and crash-recovery semantics;
- deterministic bounded canonicalization of arbitrary optional candidate JSON;
- independent optional `managementPlan` plus required machine `managementContract`;
- preservation of NEW / UNCHANGED / REVISED lineage;
- manual REVISED candidates require informed canonical diff + PRETRADE-attested state-bound supersession authorization;
- permissive no-policy production candidate ingress is prohibited;
- Candidate Feeder remains transport only;
- acceptance matrix A–T and mandatory regression gates;
- no broker-write authority.

Governing documents:

- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md`
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Implementation_Handoff_v1.0.md`
- `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md`

Status:

```text
DESIGN: APPROVED / FROZEN
IMPLEMENTATION: USER ACCEPTED
ACCEPTED SHA: b2a1a20f60b12f011fe2f5ff87d325752131ac06
MERGE / MAIN RELEASE: PENDING
BROKER AUTHORITY: READ ONLY / NO BROKER WRITES
```

### Retired feature branch

```text
v24-execution-board-handoff
```

The feature branch was fast-forward merged, then deleted locally and remotely. Its worktree was removed. It is historical only and must not be recreated for normal operation.

### Frozen downstream reference

```text
v2.3.0
baabb75f36050599f20e6c89e8db2f1f7d7769a1
```

### Historical Phase 4 merge record

```text
PR #14
0a976fb8bc68f64fd479d48322a011c9d419b2c2
```

---

## 4. Accepted SOD orchestration model on the feature branch

Accepted upstream flow through checkpoint `4144c5c`:

```text
TRUSTED CHART INGESTION
→ OPAQUE CHART REFS
→ STRUCTURED ANALYSIS PROVIDER CONTRACT
→ CANONICAL CANDIDATE EXPORT
→ LINEAGE RESOLUTION
→ DETERMINISTIC SOD RENDERER
   ├── 19-section Markdown
   ├── canonical dark 19-section HTML
   └── light SOD dashboard
→ ATOMIC CANDIDATE PUBLICATION
→ CANDIDATE FEEDER
→ CANONICAL PRETRADE INGRESS
```

Authority invariants:

- the provider may propose trade substance but cannot establish version, lineage, lifecycle, ARM, execution, output-path, or broker authority;
- Sections 15 and 16 are rendered from canonical candidate contracts, not free-form provider prose;
- provider-supplied HTML/Markdown/CSS rendering authority is rejected;
- chart paths never cross the provider boundary; only trusted bytes are resolved from orchestrator-issued refs;
- PRETRADE remains final authority for automated supersession eligibility;
- imported candidates remain proposals only;
- broker-write authority remains false.

Manual ChatGPT SOD generation remains the current manual-generation workflow. The accepted manual-ingestion feature-branch implementation now provides the explicit Manual Proposal Inbox-to-PRETRADE path for structured candidate artifacts. It has not been merged or released to `main`, and no operator-facing Submit UI beyond the accepted slice is claimed here.

---

## 5. Accepted end-to-end model

Governing invariant:

> **V2.4 authorizes; the handoff transfers; V2.3-compatible execution infrastructure owns execution.**

Accepted lifecycle:

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
→ PARTIAL / SCALE / MANAGEMENT
→ FLAT
→ EXIT
→ OPERATOR EXIT CLASSIFICATION
→ HISTORY
→ OWNERSHIP RELEASE
```

Browser code is presentation/intent only. Server-side PRETRADE authorities own candidate lifecycle, trigger, permission, review, OCO, quantity-safety evaluation, and ARM. The canonical Execution Board store owns downstream installation/lifecycle/management state.

---

## 6. Accepted PRETRADE / ARM capabilities

Implemented/accepted on `main`:

- canonical candidate ingress, validity, immutable hashing, versioning and supersession;
- automatic relevance plus versioned trigger-satisfaction evidence;
- durable trigger progress/recovery;
- immutable permission attempts;
- structural-validity authority;
- **required structural evidence/reference when the operator selects `STRUCTURE = VALID`**;
- authoritative backend provenance enforcement via `MISSING_STRUCTURE_PROVENANCE`;
- Phase 3 DSS + Phase 4 effective-stop risk integration;
- separate PRETRADE **2-ATR volatility-stress quantity-safety ceiling**;
- `READY / CAUTION / PASS` outcomes;
- exact-package operator review;
- Phase 4 Stop-Risk Max, 2-ATR Volatility Max, Reviewed Ceiling, and Final Allowed quantity auditability;
- explicit quantity selection no greater than `Final Allowed`;
- first explicit review freezes a non-expanding reviewed quantity ceiling;
- fresh ARM-time evidence may reduce that ceiling but may not increase it without a new explicit review;
- exact-package CAUTION acknowledgement;
- OCO group authority and same-symbol ARM gate;
- ARM as the final explicit symbol/direction/quantity confirmation, with the exact account exposed in the review package and frozen by ARM;
- fresh ARM-time permission, risk, and quantity-safety revalidation;
- durable ARM operation journal and recovery;
- immutable ARMED provenance;
- exactly one immutable handoff and one PENDING delivery per successful authorization;
- PRETRADE browser Active, Authorized/Execution, and History projections;
- no browser generic lifecycle or ARM authority.

An imported WAITING candidate is still a proposal only. Progression requires the explicit operator/server workflow; it is never automatically ARMED merely because the router is running.

### September 8 TODO closeout

- **Issue #18 — completed/closed:** structural evidence is explicitly required for operator `VALID` permission evaluation, with browser enforcement plus authoritative backend provenance validation.
- **Issue #19 — completed/closed:** near-stop sizing expansion is constrained by the separate PRETRADE 2-ATR quantity-safety ceiling while preserving Phase 4 effective-stop sizing semantics.

The quantity-safety layer does **not** move structural invalidation, synthesize a new effective stop, rewrite Phase 4 `riskDistance`, or rewrite Phase 4 `plannedDollarRisk`.

---

## 7. Accepted downstream/runtime capabilities

Implemented/accepted:

- persistent handoff + delivery state machine;
- stable browser receiver identity;
- exact-account admission and symbol-global broker cleanliness;
- authoritative Schwab `executionTime`;
- lossless execution-activity and ownership-journal proof;
- PREPARED/LISTENING local installation;
- immutable `executionListeningAt`;
- durable DISCARD retirement cutoff and prior-fill precedence;
- exact-account first-fill ownership;
- atomic V2.4 LIVE lifecycle + visible Execution Board projection;
- entry-fragment / ADD / PARTIAL / FLAT / REVERSAL lifecycle handling;
- canonical browser store authority;
- browser-wide writer lock across V2.3 + V2.4;
- browser-wide single router leader;
- default-on runtime router with negative emergency pause only;
- router health and structured telemetry;
- reload/HMR/remount/takeover recovery;
- read-only full trade-specification inspector;
- no broker writes.

---

## 8. Slice 7 live-management authority

Accepted Slice 7 behavior includes:

- finite immutable first-entry authorization deadline;
- no deadline extension by delay/restart/recovery;
- late-fill broker truth retained as authorization exception, never retroactive authorization;
- immutable ARM quantity ceiling;
- finite position-build window;
- explicit **Complete Position Build**;
- downward-only live ceiling after build capacity is relinquished/expired;
- re-add gating within the same authorization/account/symbol/direction and established ceiling;
- exposure-increase risk checks;
- finite lifecycle loss budget;
- realized losses consume capacity, profits do not replenish it;
- explicit live effective-stop authority and audit trail;
- tighter stops may free risk only within existing ceilings;
- wider stops cannot manufacture capacity;
- structured target observations;
- discretionary notes without machine authority;
- CRITICAL Authorization Exceptions;
- explicit exception reconciliation;
- retired-authorization late-fill detection and exact later-handoff reassignment when admissible;
- managed runtime recovery;
- legacy V2.4 compatibility isolated from native Phase 4 economics.

---

## 9. Read-only broker boundary

Accepted invariant:

```text
readOnly === true
brokerWriteAuthority === false
```

ExecutionOS does not place, replace, cancel, modify, reduce, or flatten broker orders.

Actual equity order entry remains manual in thinkorswim/Schwab. Schwab observation is exact-account and authoritative `executionTime` based.

**Broker write authority introduced by the V2.4 handoff integration, SOD orchestration, or accepted manual-ingestion implementation: NONE.**

---

## 10. Current intentionally incomplete/deferred areas

### SOD feature branch

- substantial production analysis-provider code remains unaccepted pending the frozen hardening and validation slice;
- operator-ready automated SOD workflow not yet released to `main`;
- authoritative PRETRADE supersession preflight for REVISED automated candidates remains a later explicit design/implementation decision.

### Production SOD provider hardening branch

- Decisions 1–27 and Acceptance Matrix A–V are approved/frozen;
- hardening/run-integrity implementation remains pending;
- credentialed live OpenAI acceptance remains pending;
- merge/release to `main` remains pending.

### Manual SOD / trade-card ingestion feature branch

- merge/release of the accepted feature-branch checkpoint to `main` remains pending;
- any later operator-facing Submit workflow/UI not contained in the accepted implementation remains deferred.

### Broader ExecutionOS

- no broker order placement/modification/cancellation/flattening;
- no general broker-write Governor;
- no buying-power/margin or aggregate portfolio-heat gate;
- no live NinjaTrader execution binding;
- no cloud/multi-device authority;
- generic coverage/provenance reconciliation beyond the implemented Authorization Exception workflow remains fail-closed/operator-supervised;
- V3 Management Governor not started.

---

## 11. Router model

Runtime router is default-on.

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

Health states:

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

Reconciliation remains ownership/trade state rather than router health.

---

## 12. EOD semantics

Current origin-aware planned-risk stop rule:

```text
V24_HANDOFF        -> v24.effectiveStop
LEGACY_MANUAL_V23  -> originalPlan.structuralStop
```

Structural invalidation remains separate from the V2.4 effective stop. Slice 7 live managed-stop changes do not rewrite the EOD planned-risk stop basis.

The separate PRETRADE 2-ATR quantity-safety policy also does not replace or rewrite the EOD planned-risk stop basis.

---

## 13. Acceptance evidence

### Stable `main` handoff closeout

```text
Focused Slice 7:                        26 / 26 PASS
Downstream lifecycle E2E:                1 / 1 PASS
Canonical PRETRADE→Execution E2E:        1 / 1 PASS
September 8 comprehensive regression:   GREEN
Production build:                        PASS
Final merged implementation checkpoint: 26ad8f86d2f0b4af96c186b26f250f4bb10a9dec
Broker-write authority introduced:       NONE
```

### SOD orchestration / deterministic rendering checkpoint

```text
Focused SOD / rendering / orchestrator:  58 / 58 PASS
SOD + renderer + feeder + PRETRADE:     111 / 111 PASS
Canonical PRETRADE→Execution E2E:         1 / 1 PASS
Production Vite build:                    PASS
Worktree:                                 CLEAN
Accepted SOD rendering checkpoint:        4144c5c59494ae318bb736d64fba751a22046512
Broker-write authority introduced:        NONE
```

The accepted SOD checkpoint proves that upstream chart ingestion, structured analysis boundaries, deterministic human artifacts, candidate lineage/publication, Candidate Feeder behavior, canonical PRETRADE ingress, and the downstream execution-authority lifecycle remain compatible.

### Manual-ingestion implementation acceptance

```text
Architecture decisions:                  1–31 APPROVED / FROZEN
Contract reconciliations:                A–B APPROVED / FROZEN
Implementation contracts:                1–4 APPROVED / FROZEN
Acceptance matrix:                       A–T APPROVED / FROZEN
Targeted validation:                     ALL PASS
Full V2.4 regression:                    ALL PASS
Production Vite build:                   PASS — 1,624 modules transformed
Implementation acceptance:              USER ACCEPTED
Accepted implementation checkpoint:     b2a1a20f60b12f011fe2f5ff87d325752131ac06
Merge / main release:                    PENDING
Broker-write authority introduced:        NONE
```

Complete command-by-command validation counts and the cumulative fix-forward history are recorded in `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md`.

Dedicated validation for the stable main release includes:

```text
node --test tests/execution-v24-live-management.test.mjs \
  tests/execution-v24-slice7.test.mjs \
  tests/execution-v24-slice7-final.test.mjs \
  tests/execution-v24-retired-assignment.test.mjs \
  tests/execution-v24-legacy-management-compat.test.mjs

npm run v24:full-lifecycle-e2e-test
node --test tests/execution-v24-pretrade-full-e2e.test.mjs
npm run analytics:test
npm run build
```

---

## 14. Pull requests, issues, and closeout records

- PR #1 — V2.3 execution system; merged.
- PR #7 — read-only EOD reporting; merged.
- PR #12 — V2.4 Phase 3 DSS; merged.
- PR #13 — Phase 3 documentation cleanup; merged.
- PR #14 — V2.4 Phase 4 risk sizing; merged.
- Execution Board handoff integration — fast-forward merged to `main` at implementation checkpoint `26ad8f86d2f0b4af96c186b26f250f4bb10a9dec`; former feature branch retired/deleted.
- Issue #18 — completed/closed.
- Issue #19 — completed/closed.
- September 8 final merge closeout — `docs/ExecutionOS_V2.4_Execution_Board_Handoff_Final_Merge_Closeout_2026-09-08.md`.
- SOD artifact rendering — accepted/frozen on `v24-sod-orchestration-lineage` at `4144c5c59494ae318bb736d64fba751a22046512`; baseline: `docs/sod/ExecutionOS_V2.4_SOD_Artifact_Rendering_Baseline_v1.0.md`.
- Manual SOD & Trade-Card Ingestion — implementation user-accepted on `v24-manual-sod-trade-card-ingestion` at `b2a1a20f60b12f011fe2f5ff87d325752131ac06` on 2026-09-11; merge/main release pending; closeout: `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Closeout_2026-09-11.md`.
- Production SOD Analysis Provider Hardening & Run Integrity — design approved/frozen on `v24-sod-production-analysis-provider` from base `e2357933147600e702c5e252020b257debbe3392`; implementation, live OpenAI acceptance, and merge/main release pending.

---

## 15. Operator-document generation

The living operator source is:

```text
USER-GUIDE.md
```

Rendered PDF companion:

```text
docs/ExecutionOS_User_Guide.pdf
```

A repository GitHub Actions workflow regenerates the PDF when the guide or renderer changes, verifies the PDF signature, uploads a workflow artifact, and commits the updated PDF to `main` when content changed.

The Markdown guide remains the editable source of truth for operator documentation.

Automated SOD orchestration remains absent from the operator guide because its substantial production-provider implementation is not yet hardened, live-validated, accepted, merged, or released. Manual SOD/trade-card ingestion remains absent because its accepted feature-branch implementation has not yet been merged/released to `main`, and later operator-facing Submit workflow/UI work is not claimed by its closeout.

---

**Maintenance principle:** current code/runtime and accepted closeout evidence govern current truth. Preserve frozen approved documents. Keep stable `main` operator documentation distinct from accepted feature-branch implementation records until a feature is merged and released.
