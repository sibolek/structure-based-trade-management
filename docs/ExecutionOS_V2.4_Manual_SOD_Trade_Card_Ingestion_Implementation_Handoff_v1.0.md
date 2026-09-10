# ExecutionOS V2.4 — Manual SOD & Trade-Card Ingestion Implementation Handoff v1.0

**Status:** APPROVED IMPLEMENTATION HANDOFF  
**Date:** 2026-09-10  
**Repository:** `sibolek/structure-based-trade-management`  
**Implementation branch:** `v24-manual-sod-trade-card-ingestion`  
**Accepted predecessor branch:** `v24-sod-orchestration-lineage`  
**Accepted predecessor commit:** `ecd007e7ab34e81b5d1500b0c72f3556a62ea626`  
**Governing design baseline:** `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md`  

---

## 1. Task

Implement the approved ExecutionOS V2.4 slice **Manual SOD & Trade-Card Ingestion**.

This is an implementation task, not an architecture-design task. The architecture, authority boundaries, implementation contracts, and acceptance surface are frozen in the governing design baseline.

Do not introduce alternative candidate stores, lineage authorities, lifecycle authorities, PRETRADE paths, ARM paths, execution paths, or broker-control paths.

---

## 2. Repository and starting point

Repository:

```text
sibolek/structure-based-trade-management
```

Accepted predecessor:

```text
branch: v24-sod-orchestration-lineage
commit: ecd007e7ab34e81b5d1500b0c72f3556a62ea626
```

Implementation branch:

```text
v24-manual-sod-trade-card-ingestion
```

Intended local worktree:

```text
~/Documents/GitHub/structure-based-trade-management-v24-manual-sod-trade-card-ingestion
```

Before changing implementation code:

1. verify the accepted predecessor commit exists;
2. verify the implementation branch descends from that exact commit;
3. create or attach the local implementation worktree to `v24-manual-sod-trade-card-ingestion`;
4. record starting HEAD;
5. inspect the actual predecessor implementation before editing.

Do not implement in the predecessor worktree.

---

## 3. Governing authority invariant

> **V2.4 authorizes. The handoff transfers authority. V2.3-compatible execution infrastructure owns execution.**

This slice introduces **no broker writes**.

PRETRADE remains authoritative for:

- candidate lifecycle;
- state revision;
- trigger evaluation;
- DSS/permission;
- risk evaluation/sizing permission;
- review;
- selected quantity;
- supersession eligibility/authorization;
- ARM;
- execution handoff.

Candidate Feeder remains transport only.

---

## 4. Required implementation seams

Implement the manual path as:

```text
Generator
  ↓
manual-ingestion v1 envelope
  ↓
Dropbox Manual Proposal Inbox
  ↓
Manual Ingestion Adapter
  ↓
strict envelope/candidate validation
  ↓
durable claim + journal
  ↓
PRETRADE snapshot
  ↓
canonical normalization + lineage
  ↓
full preflight
  ↓
NEW / UNCHANGED / REVISED handling
  ↓
canonical immutable publication
  ↓
Candidate Feeder
  ↓
PRETRADE canonical ingress
```

The Manual Ingestion Adapter owns orchestration only. It must not become a second candidate/lifecycle authority.

---

## 5. v1 envelope

Implement the frozen outer contract:

```json
{
  "ingestionSchemaVersion": 1,
  "submission": {
    "submissionId": "...",
    "submissionType": "MANUAL_SOD",
    "preparedAt": "2026-09-10T07:20:00-06:00"
  },
  "source": "SOD_A_PLUS_TRADES",
  "sourceDate": "2026-09-10",
  "bundleId": "sod-2026-09-10-a-plus-trades-v1",
  "validity": {},
  "candidates": []
}
```

Supported `submissionType` values:

- `MANUAL_SOD`
- `MANUAL_STANDALONE_TRADE_CARD`

Outer envelope and `submission` are closed schemas. Candidate payload is open/extensible.

Standalone submissions contain exactly one candidate.

---

## 6. Proposal authority restrictions

Manual proposal JSON must not establish authoritative:

- `contractVersion`;
- candidate semantic-schema authority;
- canonical `generatedAt`;
- lifecycle/status;
- `stateRevision`;
- `contentHash`;
- `contractAuthority`;
- ARM state/authorization;
- permission/risk results;
- authorized DSS/risk evaluation IDs;
- selected quantity;
- handoff;
- execution state.

Presence of these fields in canonical authority locations fails closed. Do not silently ignore them.

The adapter/system materializes source, sourceDate, proposal generation time, supported candidate semantic schema, and final version authority in the approved places. Final `contractVersion` remains lineage-owned.

---

## 7. Required Contract Reconciliation A changes

The predecessor currently has fixed-field canonical candidate behavior and legacy `managementPlan` alias behavior. Change this deliberately.

Required:

- `managementContract` remains required and machine-defined;
- `managementPlan` becomes independent optional structured content;
- it may coexist with and differ from `managementContract`;
- changing only `managementPlan` is substantive lineage change;
- unknown valid JSON candidate fields survive normalization/canonicalization/publication/PRETRADE persistence;
- no per-field registration is required merely to preserve optional content;
- arbitrary candidate fields are substantive by default;
- preservation/substantiveness does not grant operational meaning.

Canonical hashing must cover the full substantive candidate payload rather than a fixed enumerated list.

---

## 8. Deterministic bounded canonicalization

Canonicalization must be deterministic, strict-JSON, stack-safe, bounded, and complete.

Required behavior:

- object key order irrelevant;
- serialization whitespace irrelevant;
- array order significant unless a recognized field contract explicitly states otherwise;
- missing and explicit `null` distinct by default;
- JSON types distinct;
- no AI/string semantic normalization;
- duplicate JSON keys rejected at all nesting levels;
- no truncation or partial hashing;
- non-JSON/cyclic internal representations fail closed;
- finite generous limits for serialized size, nesting depth, node count, object breadth, array length, and value size.

Choose/document/test concrete ceilings with substantial headroom for real SOD/trade-card artifacts.

---

## 9. Lineage

Reuse and preserve existing authoritative NEW / UNCHANGED / REVISED semantics.

Required:

- NEW => v1;
- UNCHANGED => exact prior immutable canonical contract reused;
- REVISED => newest prior + 1;
- generatedAt/submission timing alone does not revise;
- substantive optional-field changes do revise;
- newest canonical prior is comparison authority;
- candidateId crossing sourceDate/session identity fails closed;
- tampered canonical prior fails integrity verification;
- runtime PRETRADE state never leaks into candidate content.

Do not create a second lineage resolver.

---

## 10. Preflight and candidate atomicity

After envelope validation and durable claim:

1. validate/materialize proposals;
2. obtain one coherent authoritative PRETRADE snapshot;
3. classify the complete submission non-mutatingly;
4. only then begin candidate-level authoritative processing.

Ordinary eligible candidates proceed automatically after explicit Submit. REVISED manual candidates remain ACTION_REQUIRED until supersession workflow completes.

Before every mutation, revalidate current PRETRADE state. The preflight snapshot is never stale-write authority.

After envelope validation, candidates are independent. One candidate failure/action-required condition must not roll back unrelated successful candidates.

A single supersession must be atomic: never leave prior SUPERSEDED without the new version successfully admitted.

---

## 11. Submission journal and replay

Keep `submissionId`, `candidateId`, and `contractVersion` independent.

Before any downstream authoritative side effect, durably bind:

```text
submissionId → exact submission content hash
```

Exact ID + same content => idempotent replay/reconciliation.  
Same ID + different content => hard conflict before mutation.

Journal records are audit/recovery evidence only. PRETRADE remains current candidate authority.

Use immutable append-oriented claim/event/receipt records with atomic complete-write publication semantics. Event order must use deterministic per-submission sequence identity.

At most one active processor/writer per submission.

---

## 12. Crash recovery

Recovery must reconcile from:

- durable journal evidence;
- immutable canonical publication artifacts;
- authoritative PRETRADE state.

Do not blindly repeat the apparent next operation.

Detect already-completed publication/import and reconcile rather than duplicating them. A claimed submission lacking terminal/current reconciliation requires recovery even if no INTERRUPTED event was written before the crash.

Stale supersession authorization must never be revived after restart.

Journal corruption or claim/hash ambiguity fails closed for further downstream mutation; existing PRETRADE state remains untouched and authoritative.

---

## 13. Required Contract Reconciliation B changes

Close the permissive no-policy production PRETRADE import path.

Every production canonical candidate import must use an explicitly supported ingress mode.

Preserve:

```text
AUTOMATED_UNTOUCHED_ONLY
```

with its existing untouched WAITING/rev0 consecutive-version restrictions.

Add a distinct explicit manual ingress mode (name may be chosen during implementation, e.g. `MANUAL_AUTHORIZED`).

No policy => fail closed.  
Unsupported/conflicting policy => fail closed.

The manual ingress mode itself is not supersession authorization. Candidate/bundle JSON cannot forge authorization.

Any legacy permissive behavior needed solely for controlled migration/test purposes must be isolated from the production API.

---

## 14. Manual supersession protocol

Every materially REVISED manual candidate requires:

```text
REVISED
  ↓
ACTION_REQUIRED
  ↓
canonical substantive diff
  ↓
explicit operator confirmation
  ↓
PRETRADE state-bound supersession authorization
  ↓
atomic revalidation
  ↓
supersede old + admit new
```

This remains required even when the prior candidate is untouched WAITING/rev0.

Bind authorization to exact:

- candidateId;
- prior contractVersion;
- prior lifecycle state;
- prior stateRevision;
- prior contentHash;
- proposed contractVersion;
- proposed contentHash.

Any mismatch invalidates approval.

Eligible pre-ARM PRETRADE-owned states may include WAITING, PRETRADE_TRIGGER_EVALUATING, PERMISSION_EVALUATING, READY, CAUTION, subject to exact PRETRADE eligibility.

Do not supersede ARMED, handed-off, execution-owned, or otherwise ineligible/terminal candidates through this path.

Successful supersession:

- preserves prior immutable history;
- prior becomes SUPERSEDED;
- new candidate starts WAITING/stateRevision 0;
- new candidate inherits no trigger, DSS, risk, review, quantity, ARM, handoff, or execution authority.

Supersession authorization is not ARM authorization.

---

## 15. Manual Proposal Inbox

Only the configured Manual Proposal Inbox expresses manual submission intent.

Generation/download/storage elsewhere has no ingestion meaning.

Do not process until stable/read-complete. After stable acquisition and durable claim, journal state owns recovery/progress; the source artifact need not remain in the hot inbox.

Never rewrite the submitted source artifact with canonical version/lifecycle/ARM/result data.

Envelope-level malformed/schema/trust failures go to quarantine/error disposition. Candidate-level partial/action-required outcomes remain valid submissions and do not automatically quarantine the source.

---

## 16. Outcomes and receipts

Keep lineage class separate from ingestion outcome.

Lineage:

- NEW
- UNCHANGED
- REVISED

Candidate outcomes include as appropriate:

- ACCEPTED
- UNCHANGED
- REJECTED
- CONFLICT
- STALE
- ACTION_REQUIRED
- SUPERSESSION_DECLINED
- SUPERSESSION_INVALIDATED
- replay context

Overall submission result is exactly one of:

- SUCCESS
- PARTIAL_SUCCESS
- ACTION_REQUIRED
- FAILED

Unresolved user action takes precedence.

Receipts are immutable historical reconciliations. Later resolution creates a new receipt. PRETRADE state included in receipts is timestamped observation only.

---

## 17. Legacy artifacts

Normal Manual Proposal Inbox must reject bare legacy candidate JSON without a supported manual-ingestion envelope.

If legacy support is implemented, expose it only through a separately invoked deterministic converter for explicitly supported historical formats.

Conversion creates a new submission identity/current ingestion envelope while preserving a valid candidateId where appropriate. Legacy contractVersion does not become present authority; current lineage determines final version.

Unsupported/ambiguous formats fail conversion.

---

## 18. Required implementation inspection

Before editing, inspect at minimum:

- `schwab-bridge/pretrade-candidate-contract.mjs`
- `schwab-bridge/sod-candidate-export.mjs`
- `schwab-bridge/sod-candidate-lineage.mjs`
- `schwab-bridge/pretrade-candidate-ingress.mjs`
- `schwab-bridge/pretrade-api.mjs`
- `schwab-bridge/candidate-feeder.mjs`
- `schwab-bridge/sod-candidate-publisher.mjs`
- relevant SOD orchestration/provider/rendering modules
- candidate-ingress tests
- lineage tests
- `package.json`

Reuse existing authorities/utilities where appropriate. Prefer the smallest coherent implementation satisfying the frozen contracts.

---

## 19. Required acceptance command

Add:

```bash
npm run v24:manual-ingestion-test
```

It must cover all Acceptance Test Matrix v1 areas A–T defined in the governing design baseline.

At minimum run/report:

```bash
npm run v24:manual-ingestion-test
npm run v24:sod-export-test
npm run v24:sod-orchestrator-test
npm run v24:candidate-feed-test
npm run build
```

Before final user acceptance, run the applicable full V2.4 `v24:*test` regression surface.

Existing predecessor tests remain intact except where approved Contract Reconciliation A or B explicitly changes prior behavior. Any other old-test failure is a regression.

---

## 20. Required Codex implementation report

Return a structured report containing:

1. starting branch and starting commit;
2. final branch and final HEAD;
3. files added;
4. files modified;
5. ownership mapping for proposal intake, journal, canonicalization, lineage, manual supersession preflight, PRETRADE authorization, publication, feeder transport, receipts/recovery;
6. exact v1 envelope implemented;
7. concrete structural safety limits;
8. optional-field preservation/hashing approach;
9. managementPlan/managementContract separation;
10. candidate semantic-schema binding approach;
11. removal of permissive no-policy production ingress;
12. supersession authorization/atomicity mechanism;
13. journal durability/recovery implementation;
14. tests added/updated;
15. every test/build command run with pass/fail counts;
16. old tests intentionally changed due to Reconciliation A/B;
17. unresolved issues/deviations/concerns.

Do not declare the slice accepted. Final acceptance authority remains with the user.

---

## 21. Stop conditions

Stop and report rather than improvising if:

- frozen requirements contradict one another;
- implementation would weaken PRETRADE/ARM/execution authority;
- repository state materially differs from the accepted predecessor assumption;
- a required shared-contract change would unexpectedly alter downstream execution semantics;
- implementation would require a second candidate/lifecycle/lineage authority;
- the required Dropbox/manual-submission boundary is impossible with available integration capabilities.

Implementation details that do not alter authority, semantics, workflow, or acceptance requirements may be chosen without new architecture approval.

---

## 22. Governing documents

1. `docs/ExecutionOS_V2.4_Manual_SOD_Trade_Card_Ingestion_Design_Baseline_v1.0_APPROVED.md` — frozen design/implementation-contract authority.
2. This document — implementation handoff/operational instructions for Codex.
3. Existing accepted V2.4 design baselines/addenda — continue to govern downstream PRETRADE/ARM/execution behavior where not specifically supplemented by this slice.
4. Current validated code/runtime behavior — determines actual implemented state until this slice is accepted.

**Handoff status: READY FOR CODEX IMPLEMENTATION / NOT YET IMPLEMENTED / NOT YET ACCEPTED.**
