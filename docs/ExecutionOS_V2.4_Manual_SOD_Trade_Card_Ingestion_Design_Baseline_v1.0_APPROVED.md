# ExecutionOS V2.4 — Manual SOD & Trade-Card Ingestion Design Baseline v1.0

**Status:** APPROVED / FROZEN  
**Date:** 2026-09-10  
**Repository:** `sibolek/structure-based-trade-management`  
**Feature branch:** `v24-manual-sod-trade-card-ingestion`  
**Accepted predecessor branch:** `v24-sod-orchestration-lineage`  
**Accepted predecessor commit:** `ecd007e7ab34e81b5d1500b0c72f3556a62ea626`  
**Implementation status:** NOT YET IMPLEMENTED  

---

## 1. Purpose

This document is the frozen architectural and implementation-contract authority for the ExecutionOS V2.4 slice **Manual SOD & Trade-Card Ingestion**.

It defines how manually generated Start-of-Day candidate packages and standalone trade-card candidate JSON enter the existing ExecutionOS candidate pipeline without creating a second candidate store, lineage system, lifecycle authority, PRETRADE path, ARM path, execution path, or broker-control path.

This slice preserves the accepted ExecutionOS authority invariant:

> **V2.4 authorizes. The handoff transfers authority. V2.3-compatible execution infrastructure owns execution.**

The slice creates no broker-write authority. It must never place, modify, cancel, replace, reduce, flatten, or otherwise control broker orders.

---

## 2. Scope and workflow

The intended operator workflow is:

```text
CREATE
  ↓
REVIEW
  ↓
SUBMIT
  ↓
Manual Proposal Inbox
  ↓
Manual Ingestion Adapter
  ↓
canonical candidate publication
  ↓
Candidate Feeder
  ↓
PRETRADE
  ↓
trigger / DSS / risk / review / ARM
  ↓
immutable handoff
  ↓
V2.3-compatible execution ownership
```

Creation or download alone has no PRETRADE effect. The user explicitly submits an already-generated ingestion-ready artifact. The generator, not the user, constructs the complete manual-ingestion envelope.

Full SOD submissions use one envelope containing one or more candidates. Standalone trade-card submissions use the same contract with exactly one candidate.

---

## 3. Global invariants

The following invariants are frozen:

- Manual input must not bypass canonical candidate validation.
- Candidate identity remains explicit, stable, and source/date scoped.
- NEW / UNCHANGED / REVISED lineage semantics remain authoritative.
- Exact retries are idempotent.
- Conflicts, malformed input, ambiguous identity, invalid revisions, unsupported state, unsupported schema, and authority ambiguity fail closed.
- Structured candidate data is the machine source. HTML, Markdown, prose, screenshots, and rendered trade cards are never reverse-parsed to derive execution candidates where structured data exists.
- Manual candidates request MANUAL ARM review; ingestion never authorizes ARM.
- Candidate creation and ingestion create no execution authority.
- PRETRADE remains authoritative for lifecycle, state revision, trigger evaluation, DSS/permission, risk, review, quantity, ARM authorization, supersession eligibility, and handoff.
- Candidate Feeder remains transport only.
- No second candidate store, lineage authority, lifecycle authority, or PRETRADE path may be created.
- Manual-vs-automated origin is provenance, not rank or authority.

---

# Part I — Approved architectural decisions

## Decision 1 — Manual SOD canonical-entry seam

**APPROVED / FROZEN.**

Manual SOD is an upstream candidate producer, not an authority. Manual structured candidates enter before authoritative version/lineage assignment and converge with the automated path before canonical candidate/PRETRADE processing.

Production manual ingestion requires explicit stable `candidateId`. Manual input may not establish `contractVersion`, lifecycle state, state revision, permission/risk state, selected quantity, ARM authorization, handoff, execution state, or broker authority. Presence of forbidden authority fields fails closed rather than being silently ignored.

## Decision 2 — Manual SOD input contract + contract-aware generation

**APPROVED / FROZEN.**

Manual ingestion uses a versioned envelope containing candidate proposals based on the existing SOD proposal vocabulary. The SOD/trade-card generation workflow is contract-aware: the same structured proposal data drives human-readable artifacts and machine-ingestion JSON. Human-readable artifacts are never reverse-parsed.

## Decision 3 — Manual SOD ingestion processing boundary

**APPROVED / FROZEN.**

A thin Manual SOD Ingestion Adapter sits upstream of canonical publication. It validates the manual envelope, obtains authoritative PRETRADE state, invokes canonical normalization/validation and lineage, then emits the same canonical bundle family used by the existing architecture. It owns no persistent candidate authority.

## Decision 4 — Manual revision and supersession

**APPROVED / FROZEN.**

NEW, UNCHANGED, and REVISED remain the lineage classes. NEW proceeds normally. UNCHANGED is idempotent and creates no new version. Every materially REVISED manual candidate requires explicit supersession preflight and deliberate user confirmation.

Manual supersession may apply to eligible PRETRADE-owned active states before ARM, including WAITING, PRETRADE_TRIGGER_EVALUATING, PERMISSION_EVALUATING, READY, and CAUTION, subject to authoritative PRETRADE eligibility.

Successful supersession preserves prior immutable history, moves the prior eligible version to SUPERSEDED, creates the new version at WAITING/stateRevision 0, and inherits no trigger, DSS, risk, review, quantity, ARM, handoff, or execution authority.

ARMED, handed-off, execution-owned, and terminal candidates are not superseded/reactivated through ordinary manual ingestion.

## Decision 5 — Manual supersession ingress authorization + backward compatibility

**APPROVED / FROZEN.**

The existing automated restrictive policy remains unchanged. Manual supersession uses distinct ingress-operation metadata, but no JSON field such as `manualApproved: true` may self-authorize a revision.

PRETRADE issues/attests state-bound supersession authorization after preflight and explicit confirmation. Authorization is bound to exact prior and proposed candidate identity/version/state/hash data and grants no DSS/risk/quantity/ARM/handoff/execution/broker authority.

The existing user-facing SOD/trade-card generation workflow and candidate-definition vocabulary remain substantively compatible.

## Decision 6 — Batch atomicity and reconciliation

**APPROVED / FROZEN.**

Envelope-level structural/trust failures reject the whole submission. Once the envelope is valid, candidates process independently. One candidate conflict, stale result, validation failure, or pending supersession does not roll back unrelated successes.

Each individual candidate state transition is atomic. A supersession may never leave the old version superseded if the new version failed to admit.

Batch outcomes distinguish `SUCCESS`, `PARTIAL_SUCCESS`, `ACTION_REQUIRED`, and `FAILED`.

## Decision 7 — Submission identity and idempotency

**APPROVED / FROZEN.**

Three identities remain independent:

- `submissionId` — ingestion artifact/event identity;
- `candidateId` — logical trade idea identity;
- `contractVersion` — immutable canonical candidate revision.

Exact same submission ID + exact normalized content is an idempotent replay. Same submission ID + different content is a fail-closed submission conflict. A new submission ID does not reset candidate lineage.

## Decision 8 — Audit persistence and authority boundary

**APPROVED / FROZEN.**

The adapter maintains durable append-oriented submission audit state in a submission journal, distinct from the PRETRADE candidate store. The journal records what happened but does not own current lifecycle, stateRevision, permission/risk, quantity, ARM, handoff, execution, or broker state. PRETRADE wins whenever journal observations differ from current candidate authority.

## Decision 9 — Manual proposal transport boundary

**APPROVED / FROZEN.**

Use a dedicated Dropbox Manual Proposal Inbox distinct from the canonical Candidate Feeder inbox. The generated candidate JSON is directly consumable by this boundary; the user does not edit or convert it. The adapter creates a separate canonical publication artifact and never rewrites the submitted proposal artifact with canonical/runtime authority.

## Decision 10 — Explicit submission boundary

**APPROVED / FROZEN.**

Generation alone does not submit or change PRETRADE. Explicit user submission places the immutable ingestion-ready proposal artifact into the configured Manual Proposal Inbox. Full SOD uses one multi-candidate envelope; standalone cards use the same contract with one candidate.

## Decision 11 — Manual submission wire-contract ownership

**APPROVED / FROZEN.**

The generator constructs the complete thin manual-ingestion envelope around the existing proposal payload. The adapter consumes/validates that envelope; it does not synthesize missing submission identity or transform a bare candidate into an authorized submission.

## Decision 12 — Submission identity and event-time ownership

**APPROVED / FROZEN.**

The generator creates immutable `submissionId` and `preparedAt`. The adapter records authoritative `receivedAt` and later processing timestamps. The submitted envelope remains unchanged after creation.

## Decision 13 — Candidate-scoped canonical publication

**APPROVED / FROZEN.**

Publication eligibility is independent per candidate. NEW candidates can proceed while unrelated candidates are invalid or pending supersession. REVISED candidates are not authoritatively published until required supersession authorization succeeds. UNCHANGED reuses existing immutable candidate semantics.

## Decision 14 — Full preflight then commit

**APPROVED / FROZEN.**

After envelope validation, the adapter performs a complete non-mutating preflight against one coherent authoritative PRETRADE snapshot. Ordinary eligible candidates then proceed without a second blanket confirmation because explicit Submit already occurred. Supersession-required candidates remain ACTION_REQUIRED. Every actual state mutation independently revalidates current PRETRADE immediately before commit.

## Decision 15 — Candidate validity and submission freshness

**APPROVED / FROZEN.**

Validity is substantive candidate content and does not slide automatically on submission/retry/supersession. Future-valid candidates retain NOT_YET_VALID semantics. Expired or unverifiable candidates fail closed operationally. Extending validity requires a deliberate new/revised candidate.

## Decision 16 — Candidate provenance vs admission provenance

**APPROVED / FROZEN.**

Substantive candidate provenance is distinct from admission provenance. Manual SOD, standalone trade-card, and automated SOD origins do not create separate candidate source universes. The canonical source remains `SOD_A_PLUS_TRADES`. Admission events are audit/provenance records, not candidate authority.

## Decision 17 — Manual Proposal Inbox as explicit submission command boundary

**APPROVED / FROZEN.**

Only placement into the configured Manual Proposal Inbox expresses processing intent. General Dropbox folders are not watched. Inbox presence conveys processing intent only, never candidate validity, canonicality, supersession eligibility, lifecycle, ARM, execution, or broker authority.

## Decision 18 — Safe Dropbox intake / claim / archive / quarantine

**APPROVED / FROZEN.**

Do not process until the file is stable/read-complete. Once stable, derive submission identity/content identity and durably bind `submissionId` to exact content before downstream authoritative effects. Claimed source artifacts remain immutable. Valid submissions can leave the hot inbox after claim; envelope-level structural/trust failures are quarantined, while candidate-level partial/action-required results remain valid submission outcomes.

## Decision 19 — Durable submission receipt / reconciliation

**APPROVED / FROZEN.**

Every submission produces durable reconciliation linked to `submissionId`. Candidate outcomes distinguish admission, unchanged/idempotent, rejection, conflict, stale state, and action-required conditions. Any PRETRADE state in a receipt is a timestamped historical observation, not current authority.

## Decision 20 — Manual supersession review and informed confirmation

**APPROVED / FROZEN.**

Before approval, show a canonical substantive diff between the authoritative existing version and the exact proposed canonical revision. Exclude submission/admission/transport metadata. Explicitly disclose that the new version restarts WAITING/stateRevision 0 and inherits no trigger/DSS/risk/review/quantity/ARM/handoff/execution authority.

Approval binds exact prior identity/state/hash and proposed version/hash. Any subsequent material change invalidates approval.

## Decision 21 — Manual-ingestion schema versioning / backward compatibility

**APPROVED / FROZEN.**

The manual envelope carries an ingestion-schema version distinct from candidate `contractVersion`. The adapter accepts only explicitly supported versions. Missing/unknown/ambiguous/unsupported versions fail closed. Deterministic compatibility transforms may be used only for explicitly supported older versions and may not invent authority.

## Decision 22 — Manual-ingestion v1 envelope structure

**APPROVED / FROZEN.**

The v1 envelope is a thin control layer around the existing candidate-proposal vocabulary. It carries explicit ingestion schema, immutable submission identity/type/preparation time, fixed source `SOD_A_PLUS_TRADES`, sourceDate, optional compatibility bundleId, optional bundle validity default, and candidates.

## Decision 23 — Required core + broad extensible optional fields

**APPROVED / FROZEN.**

Manual SOD/standalone candidates must satisfy the same decision-critical required core while permitting broad optional structured analytical, contextual, management, and presentation data. `managementPlan` is explicitly accepted in addition to required `managementContract`.

## Decision 24 — Open optional candidate fields, substantive by default

**APPROVED / FROZEN.**

ExecutionOS defines required canonical fields and reserved/prohibited authority fields. Every other valid JSON-valued field inside the candidate payload is accepted and preserved automatically without per-field registration. Optional candidate fields are substantive by default and participate in canonical hashing/lineage. Acceptance does not grant operational semantics.

## Decision 25 — Deterministic canonicalization of extensible candidate content

**APPROVED / FROZEN.**

Canonicalization covers all nested substantive JSON. It must be deterministic, bounded, stack-safe, strict-JSON-only, cycle-safe internally, and must fail closed for duplicate keys, unsupported representations, or structural/resource excess. Object-key ordering and serialization whitespace do not change the hash; array ordering remains significant unless an explicit field contract says otherwise. Missing and null remain distinct by default. No truncation or partial hashing is permitted.

## Decision 26 — Bounded extensible candidate structure

**APPROVED / FROZEN.**

Generous finite limits must exist for serialized size, nesting depth, node/structural complexity, object breadth, array length, and individual value size. Exact numerical ceilings are implementation-level and must have substantial headroom for representative real SOD/trade-card payloads. Limit violations fail closed and never truncate data.

## Decision 27 — Closed ingestion control plane and open candidate content

**APPROVED / FROZEN.**

Outer envelope and `submission` control structures are closed/versioned. Unknown protocol fields fail closed. Candidate content is open/extensible. Arbitrary candidate fields may contain authority-like words, but they remain inert unless explicitly promoted through an approved operational contract.

## Decision 28 — Non-retroactive promotion of optional candidate fields

**APPROVED / FROZEN.**

Later software releases may not retroactively grant operational meaning to optional data contained in immutable older candidate contracts. Promotion to operational semantics requires an explicit contract change. Existing candidate versions retain the semantics in force when accepted.

## Decision 29 — Canonical candidate semantic-schema binding

**APPROVED / FROZEN.**

Every accepted canonical candidate version is immutably bound to the ExecutionOS-owned candidate semantic schema applicable at acceptance. Manual ingestion schema, candidate semantic schema, and `contractVersion` remain distinct concepts. The manual producer does not select authoritative candidate semantic schema.

## Decision 30 — Legacy manual-candidate artifact compatibility

**APPROVED / FROZEN.**

The normal Manual Proposal Inbox accepts only explicitly supported manual-ingestion envelopes and never heuristically interprets older bare candidate JSON. Historical formats may be supported through a separately invoked deterministic converter for explicitly supported legacy forms. Conversion creates a new submission identity while preserving a valid historical candidateId where appropriate. Current lineage still determines authoritative contractVersion.

## Decision 31 — Design phase closure

**APPROVED / FROZEN.**

Architectural design is complete through Decisions 1–30. No additional architectural mechanisms are to be introduced unless implementation-contract work reveals a genuine contradiction or missing authority boundary. Implementation details may be chosen only within the frozen authority, semantics, and workflow constraints.

---

# Part II — Approved contract reconciliations

## Contract Reconciliation A — Existing candidate contract vs open extensibility

**APPROVED / FROZEN.**

The predecessor implementation currently treats `managementPlan` as a legacy alias of `managementContract` and canonicalizes only a fixed list of candidate fields. This behavior is superseded for this slice.

Frozen requirements:

1. `managementContract` remains required and machine-defined.
2. `managementPlan` becomes an independent optional structured candidate field.
3. `managementPlan` may coexist with and differ from `managementContract`.
4. `managementPlan` is substantive for lineage but non-operational unless explicitly promoted.
5. Arbitrary additional top-level/nested valid JSON candidate fields are preserved automatically.
6. Optional candidate fields participate in deterministic substantive hashing by default.
7. Manual proposals do not supply authoritative `contractVersion`; lineage establishes it before final canonical acceptance.
8. Final accepted candidates still require valid authoritative contractVersion and canonical integrity.
9. Existing automated SOD behavior remains unchanged except where shared canonical-contract changes necessarily apply and are covered by regression tests.

## Contract Reconciliation B — Explicit ingress policy required at PRETRADE

**APPROVED / FROZEN.**

The predecessor's permissive unspecified/null ingress path is not allowed at the production PRETRADE import boundary.

Frozen requirements:

- Every production canonical candidate import identifies an explicitly supported ingress mode.
- `AUTOMATED_UNTOUCHED_ONLY` remains unchanged.
- Manual ingestion uses a distinct recognized manual ingress mode.
- Manual NEW may admit normally; UNCHANGED remains idempotent.
- Every materially REVISED manual candidate requires PRETRADE-attested state-bound supersession authorization, even if the prior version is still untouched WAITING/rev0.
- Ingress mode does not itself constitute supersession authorization.
- Candidate/bundle JSON cannot self-authorize.
- Missing/unsupported/conflicting ingress mode fails closed before mutation.
- Any legacy permissive behavior required for controlled migration/test purposes must be isolated from the production API.

---

# Part III — Implementation contracts

## Implementation Contract 1 — Exact v1 Manual Submission Envelope

**APPROVED / FROZEN.**

### Canonical v1 shape

```json
{
  "ingestionSchemaVersion": 1,
  "submission": {
    "submissionId": "manual-sod-2026-09-10-<unique-id>",
    "submissionType": "MANUAL_SOD",
    "preparedAt": "2026-09-10T07:20:00-06:00"
  },
  "source": "SOD_A_PLUS_TRADES",
  "sourceDate": "2026-09-10",
  "bundleId": "sod-2026-09-10-a-plus-trades-v1",
  "validity": {
    "validFrom": "2026-09-10T07:30:00-06:00",
    "validUntil": "2026-09-10T11:00:00-06:00",
    "timezone": "America/Denver",
    "session": "RTH",
    "sourceLabel": "START_OF_DAY_REPORT"
  },
  "candidates": []
}
```

Envelope rules:

- `ingestionSchemaVersion` required; exactly `1` for v1.
- `submission` required and closed-schema.
- `submission.submissionId` required, immutable, generator-created.
- `submission.submissionType` required; `MANUAL_SOD` or `MANUAL_STANDALONE_TRADE_CARD`.
- `submission.preparedAt` required exact absolute timestamp with `Z` or UTC offset.
- `source` required fixed literal `SOD_A_PLUS_TRADES`.
- `sourceDate` required exact `YYYY-MM-DD`.
- `bundleId` optional compatibility/package identifier only.
- `validity` optional bundle-level default; materialized into candidates before lineage if candidate-specific validity is absent.
- `candidates` required nonempty array; standalone requires exactly one.
- Unknown outer-envelope or `submission` fields fail closed.

Manual candidate proposals must not supply authoritative candidate `contractVersion`, canonical candidate semantic schema authority, canonical generatedAt, lifecycle/stateRevision, contentHash/contractAuthority, ARM, permission/risk, quantity, handoff, or execution authority.

All legitimate optional candidate fields are substantive by default in v1. Submission/admission/transport/rendering metadata belongs outside candidate content.

## Implementation Contract 2 — Manual ingestion processing pipeline

**APPROVED / FROZEN.**

Deterministic processing order:

```text
1. discover stable file
2. strict raw JSON/resource validation
3. validate closed envelope
4. compute submission content hash
5. durably claim submissionId + hash
6. handle exact replay / identity conflict
7. validate candidate proposals
8. materialize trusted/system fields
9. obtain one authoritative PRETRADE snapshot
10. resolve NEW / UNCHANGED / REVISED for all candidates
11. build complete non-mutating preflight
12. process candidates independently
13. PRETRADE atomic commit/revalidation
14. record candidate results
15. derive batch result
16. write durable receipt
17. archive/quarantine source artifact
```

No downstream authoritative effect occurs before durable claim. Initial preflight uses one coherent snapshot, but every mutation revalidates current PRETRADE immediately before commit.

## Implementation Contract 3 — Journal, outcome, error, and receipt semantics

**APPROVED / FROZEN.**

Submission-processing states are distinct from candidate lifecycle and may include RECEIVED, VALIDATING, PREFLIGHTED, PROCESSING, ACTION_REQUIRED, COMPLETED, REJECTED, and INTERRUPTED/recovery-required.

Candidate lineage classification and ingestion outcome remain separate.

Candidate outcomes distinguish as appropriate: ACCEPTED, UNCHANGED, REJECTED, CONFLICT, STALE, ACTION_REQUIRED, SUPERSESSION_DECLINED, SUPERSESSION_INVALIDATED, and replay context.

Overall submission reconciliation is exactly one of:

- `SUCCESS`
- `PARTIAL_SUCCESS`
- `ACTION_REQUIRED`
- `FAILED`

Unresolved required user action takes precedence over ordinary partial-success reporting.

Errors use stable machine-readable categories and structured diagnostic detail. Receipts are immutable historical reconciliations. Later resolution creates a new receipt rather than overwriting prior evidence. Any PRETRADE state in a receipt is a timestamped observation only.

## Implementation Contract 4 — Durable journal persistence and crash recovery

**APPROVED / FROZEN.**

The manual-ingestion journal is append-oriented and scoped to immutable submissionId. It does not become a second candidate-state authority.

The first durable ingestion-layer record is an immutable claim binding submissionId to exact submission-content identity. Claims, events, and receipts are immutable. Durable records use complete atomic-write semantics (write temp, sync, close, same-directory rename) sufficient to prevent partial committed JSON.

Event ordering uses deterministic per-submission sequence identity rather than filesystem timestamps. At most one active processor/writer may mutate one submission at a time.

Crash recovery reconciles from journal evidence, immutable publication artifacts, and current PRETRADE state. It never blindly repeats the apparent next action. Already-completed publication/admission must be detected and reconciled rather than duplicated. Stale supersession authorization is never revived after restart. Journal corruption fails closed for further downstream mutation while existing PRETRADE state remains untouched and authoritative.

---

# Part IV — Acceptance Test Matrix v1

**APPROVED / FROZEN.**

The implementation must provide a dedicated `npm run v24:manual-ingestion-test` command and cover at minimum the following areas.

### A. Envelope contract

Valid SOD and standalone envelopes; standalone cardinality; schema/version/source/date/timestamp requirements; closed envelope/submission schemas; required fields.

### B. Strict JSON and structural safety

Malformed JSON, duplicate keys at any nesting level, structural resource ceilings, no truncation/partial hash, candidate-scoped failures where safely isolated, envelope-scoped failures where parsing/decomposition is unsafe.

### C. Candidate authority boundary

Reject manual authoritative contractVersion, candidate semantic schema authority, canonical generatedAt, lifecycle/stateRevision, ARM, permission/risk, quantity, handoff, execution, contentHash, contractAuthority, and equivalent canonical authority assertions. Nested descriptive authority-like words remain inert.

### D. Open optional candidate content

Unknown JSON fields survive normalization, lineage, publication, PRETRADE persistence/retrieval; nested fields survive intact; key order/serialization whitespace do not change hash; array order is significant; missing vs null and JSON type differences remain significant; optional changes create REVISED.

### E. Independent managementPlan behavior

managementContract remains required; managementPlan optional; may differ from managementContract; survives canonicalization; changing only managementPlan is substantive; no automatic operational authority.

### F. Trusted field materialization

Source/sourceDate from envelope; preparation time materialization as specified; bundle validity materialization; candidate validity override; producer cannot choose final contractVersion or canonical candidate semantic schema.

### G. Lineage

NEW v1, UNCHANGED exact immutable reuse, REVISED newest+1, generatedAt-only invariance, substantive core/optional changes, newest prior authority, sourceDate collision failure, prior integrity verification, no runtime-authority leakage.

### H. Submission identity/idempotency

Immutable claim; exact replay; same ID/different content conflict; new submission ID does not reset candidate lineage; partial/completed replay does not duplicate effects.

### I. Full-batch preflight / candidate atomicity

Complete non-mutating preflight; mixed classifications; unrelated candidates proceed despite invalid/action-required peers; no rollback of unrelated commits; per-candidate supersession atomicity.

### J. Automated ingress regression

Existing `AUTOMATED_UNTOUCHED_ONLY` behavior remains green, including new-v1 acceptance, exact duplicate handling, untouched WAITING/rev0-only automated supersession, and version-gap/state restrictions.

### K. Explicit ingress authority

No-policy production import rejected; unknown/conflicting mode rejected; manual mode itself does not authorize revision; bundle cannot forge supersession authority; no public API bypass.

### L. Manual supersession

REVISED without authorization => ACTION_REQUIRED, even from untouched WAITING/rev0; canonical diff; approved eligible pre-ARM supersession; prior SUPERSEDED/new WAITING rev0; no inherited authority.

### M. Supersession race safety

Bind approval to prior identity/version/lifecycle/stateRevision/hash and proposed version/hash. Any material change invalidates authorization. Decline leaves prior untouched. Stale authorization cannot replay.

### N. Terminal/execution boundary

ARMED, handed-off, execution-owned candidates cannot be manually superseded; terminal candidates are not reactivated; no broker writes or implicit ARM.

### O. Journal durability

Claim before side effects; immutable events/receipts; deterministic sequencing; atomic record publication; single active processor; integrity ambiguity fails closed.

### P. Crash recovery

Crash after claim/preflight/publication/PRETRADE admission reconciles safely; no duplicate publication/import/version; supersession remains atomic; stale approval not revived; corrupt journal blocks new mutation without modifying PRETRADE.

### Q. Receipt/reconciliation

Deterministic SUCCESS/PARTIAL_SUCCESS/ACTION_REQUIRED/FAILED; separate lineage/outcome; immutable receipt history; PRETRADE state observations timestamped and non-authoritative.

### R. Dropbox/manual transport

Only configured inbox submits; stable-file requirement; copied/renamed exact submission follows ID/hash rules; source artifact never rewritten; envelope failures quarantine; candidate-level partial/action-required outcomes remain valid submissions.

### S. Legacy conversion

Bare legacy input rejected by normal inbox; explicit supported converter creates new submission envelope/ID; valid candidateId preserved; legacy version not authoritative; ambiguous/unsupported format fails.

### T. Semantic-version non-retroactivity

Existing candidate semantic meaning remains fixed across software upgrades; previously inert optional fields do not gain retroactive operational meaning; semantics-changing promotion requires deliberate new/revised candidate unless an explicitly semantics-preserving migration applies.

### Mandatory acceptance commands

At minimum:

```bash
npm run v24:manual-ingestion-test
npm run v24:sod-export-test
npm run v24:sod-orchestrator-test
npm run v24:candidate-feed-test
npm run build
```

Before final user acceptance, run the applicable full V2.4 regression surface represented by the existing `v24:*test` scripts. Existing predecessor tests remain intact except where Contract Reconciliation A or B explicitly supersedes prior behavior.

---

# Part V — Implementation authority map

```text
Generator
  = creates human artifacts + complete manual submission envelope

Dropbox Manual Proposal Inbox
  = explicit transport-level submission command boundary

Manual Ingestion Adapter
  = validates envelope, journals claim/events, materializes trusted fields,
    obtains PRETRADE snapshot, runs canonical validation/lineage,
    builds preflight and requests supersession workflow

Canonical Candidate Contract / Lineage
  = owns canonical substantive representation and NEW/UNCHANGED/REVISED

PRETRADE
  = owns candidate lifecycle, stateRevision, supersession authorization,
    DSS/risk/review/quantity/ARM and authoritative candidate admission

Canonical Publisher
  = immutable candidate publication to Candidate Inbox

Candidate Feeder
  = transport only

Execution Board Handoff
  = immutable authority transfer after ARM

V2.3-compatible downstream execution
  = execution ownership
```

---

# Part VI — Explicit non-goals

This slice does not:

- redesign SOD report/trade-card presentation;
- change the established user-facing package format except for the ingestion-ready JSON envelope needed by this design;
- create a second candidate store;
- create a second lineage resolver;
- create a second lifecycle authority;
- create a second risk/DSS/ARM path;
- infer candidates from rendered HTML/Markdown/screenshots;
- create broker-write authority;
- add order placement/cancel/replace/flatten capability;
- reactivate terminal candidates;
- retroactively reinterpret historical optional fields under newer semantics.

---

# Part VII — Implementation governance

Codex may choose internal class/function/module names, storage directory names, lock/lease implementation, exact generous structural safety ceilings, exact error-code suffixes, and other implementation details only where those choices do not alter the frozen authority, semantics, workflow, or acceptance requirements.

If implementation reveals a contradiction between frozen requirements or a necessary change to PRETRADE/ARM/execution authority, implementation must stop and return to design review rather than silently changing the architecture.

The implementation is not accepted merely because it compiles or passes happy-path tests. Final acceptance remains an explicit user decision after required regression and review.

---

## Approval record

Architecture decisions 1–31, Contract Reconciliations A–B, Implementation Contracts 1–4, and Acceptance Test Matrix A–T were explicitly approved in the design session on 2026-09-10.

**Baseline status: APPROVED / FROZEN / IMPLEMENTATION PENDING.**
