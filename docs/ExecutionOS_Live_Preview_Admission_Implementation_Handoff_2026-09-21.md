# Live preview, discard and admission — implementation handoff

**Date:** 2026-09-21

**Review base:** `283ad90`, on `codex/live-fast-path-p0-contract`

**Status:** Engineering handoff for disabled, offline-tested implementation. Not implementation acceptance, trading-policy approval or permission to place orders.

**Companion:** [Draft fast-path contract](ExecutionOS_Live_Fast_Path_Contract_v0.1_DRAFT.md) · [Repository audit](ExecutionOS_Live_Fast_Path_Repository_Audit_2026-09-21.md)

## 1. Scope and non-decisions

Build one PRETRADE-owned preview/admission authority, reusing canonical ingress. Accept creates or identifies a candidate; it never satisfies trigger evidence, grants risk permission, selects final quantity, arms, or sends an order. Full SOD and legacy manual import retain their separate meanings.

The operator has **not approved a chart/trade-card stale-age threshold**. Do not activate the draft 60-second pane limit, three-second quote limit or 15-second preview lifetime. Existing contract `validUntil`, quote and account safeguards remain intact. Tests inject a named policy; production fast-path eligibility/admission stays disabled until its policy and qualification gates are resolved. An unconfigured policy is a feature-readiness problem, not a new rejection rule for existing manually imported cards.

Development may proceed without another general approval request. Compact-profile research scope, setup-specific displacement/coverage, chart provenance and release qualification remain gates for enabling the live feature, not reasons to delay offline transaction work.

## 2. Repository findings driving the design

| Observed implementation | Required consequence |
|---|---|
| `PreTradeCandidateIngress.importBundle()` mutates candidates/journal/import log and calls `store.save()` before returning | Do not call it and then save a preview receipt separately. Candidate and receipt need one transaction. |
| `PreTradeStore.save()` writes a fixed `.tmp` file and renames it; no durable-commit classification or process writer lock | Add single-writer enforcement and durable commit/recovery before claiming crash-safe acceptance. |
| Ingress restores its old in-memory snapshot on every save exception | A failure after rename must fence writes, not blindly roll back and overwrite a possibly committed result. |
| `normalizeState()` explicitly reconstructs known root fields | New preview/receipt roots need schema validation, preservation and migration; otherwise restart silently drops them. |
| Candidate API reconciles lifecycle validity before dispatch, even for reads | Preview routes must run outside that preamble; read-only preflight cannot borrow mutating convenience methods. |
| Candidate import checks local origins but has no per-session token; absent Origin is accepted | Add explicit preview-route session/origin/host protection. SOD's separate session is not PRETRADE authorization. |
| Exact canonical duplicates are returned before later-version/lifecycle checks | An existing candidate is not proof this preview admitted it, nor proof it is currently actionable. |
| Current local preview is browser parsing, without a server receipt | Keep it visibly separate. Do not retrofit an authoritative success/discard claim onto local state alone. |

## 3. Persistence decision: one atomic PRETRADE snapshot

Use the existing PRETRADE store as the only canonical candidate store. Add validated preview metadata, acceptance operations and compact terminal receipts as store-level roots, outside candidate content and immutable source-contract roots. Do not change the frozen legacy candidate hash root list.

Every persisted transaction carries a store epoch, monotonically increasing revision and unique transaction ID. A preview binds its own revision plus the relevant candidate/lineage, authorization and ownership fingerprints. Unrelated store writes need not invalidate it, but final planning always runs against the latest authoritative state.

Refactor ingress into a shared deterministic planner/draft application and a committing wrapper. The planner accepts a detached state draft, normalized inputs, explicit time and a restricted internal authority context; it performs the existing integrity, duplicate, conflict, version and supersession rules. It must not save, fetch, allocate hidden authority, or mutate the live store. Ordinary ingress and preview acceptance use the same engine. Do not implement dry-run by monkey-patching `save()`. Retire or fence the separate legacy `PreTradeStore.importBundle()` path so it cannot evade registered-preview checks.

Final acceptance applies candidate creation, any authorized supersession effects, lifecycle event/operation, import log, preview completion and acceptance receipt to **one** detached draft, validates it, then commits it once. A receipt links the server acceptance ID to the exact preview revision, candidate ID/version/hash, ingress outcome and candidate acceptance operation/event. A canonical event ID or matching candidate alone is insufficient evidence.

Durable writer requirements:

1. Acquire an exclusive process writer lock before loading/recovery, including command-line writers. Hold it for the lifetime of the store owner. In-process mutations use a shared synchronous transaction boundary; no network/await inside it. Do not reclaim a lock merely because it is old.
2. Write a unique temporary file in the same directory, flush its contents, rename over the authoritative file, then flush the directory where supported. Publish the in-memory committed draft only when commit is confirmed. Bound store size and validate writable local filesystem support in readiness.
3. Classify failure before replacement separately from ambiguous replacement/durability failure. Ambiguity fences **all** store writers and invalidates in-flight continuations until recovery. Existing catch/rollback paths must respect that fence. A failed durability acknowledgment is not evidence of non-admission.
4. On recovery, load and validate the authoritative file under the writer lock; compare transaction IDs, receipts and candidate linkage. Never automatically promote a leftover temporary file. If committed state cannot be proved, remain recovery-blocked; do not issue a replacement acceptance.
5. Missing/corrupt state after initialization is not an empty account. Use an initialization/generation record so unexpected file loss fails closed. Backup/restore must preserve the store and generation metadata together; restore invalidates uncommitted previews and keeps terminal receipts.

Document the actual filesystem durability guarantee and fault-test it. Rename atomicity alone is not a power-loss guarantee. A schema bump cannot make an already-deployed older binary honor new fields or locks: require coordinated service shutdown/migration and a versioned runtime/store-path cutover, retain a rollback backup, and refuse unsupported schemas in new readers. Do not let an old service keep serving a writable stale store as the active UI backend. Rollback requires an explicit coordinated restore, not pointing an old binary at the upgraded file.

## 4. Records and identity

Server-owned records must include:

- Draft/run identity: store epoch, draft ID, input revision, run ID, profile/schema/policy versions and account scope. A server-confirmed edit/cancel advances the draft revision before replacement work begins.
- Immutable preview revision: opaque preview ID, revision, canonical proposal/bundle hash, candidate identity/version, chart-byte hashes, provenance and source times, evidence IDs/times, fixed proposal references, policy, relevant state fingerprints and absolute expiry under the eventual approved policy.
- Acceptance operation: server-issued ID allocated **with the preview revision**, binding hash, state, requested/finished times, final evidence and receipt. This lets another tab or a reloaded page discover the original operation after a lost POST response. Allocating an unstarted ID does not start acceptance.
- Receipt: `ADMITTED`, `ALREADY_PRESENT` or `NOT_ADMITTED`, reason, commit transaction/revision, exact candidate and canonical operation linkage if any. Terminal receipts are immutable; current lifecycle is returned separately with its observation time.

Evidence refresh creates a new immutable revision and acceptance ID, retiring the previous unstarted revision atomically. It cannot renew the original chart times, fixed hard expiry or displacement references. A new review after expiry is a distinct explicit review. Refresh/edit is blocked while acceptance is unresolved. Terminal receipt lookup is permitted after preview expiry and after a session restart.

Bound record counts and bytes. Never prune unresolved operations. Retain compact terminal bindings/tombstones throughout the documented replay horizon; unknown, purged or old-epoch IDs return an explicit unavailable result and cannot be accepted. Cap exhaustion blocks new work rather than silently dropping recovery evidence.

## 5. Routes and trust boundaries

Add a dedicated `/api/pretrade-previews` namespace, dispatched before handlers with reconciliation side effects. Expose session bootstrap, preview create/status, revision refresh/discard and accept/check-outcome. Route inputs contain identifiers/intents, not browser-authoritative PASS flags, lifecycle commands or mutable acceptance evidence.

Require validated loopback binding/remote address/Host, one explicitly configured UI origin, bounded JSON bodies and a cryptographically random per-boot PRETRADE session token on protected requests. Session bootstrap is read-only and restricted to that origin; never put the token in URLs, logs or persisted preview records. Reject missing/wrong origins for these browser routes. Reuse SOD's authorization primitives where suitable, not its cross-service token. Session renewal after restart must not allocate a new acceptance operation.

Manual input can receive canonical validation but cannot assert trusted capture, a research pass or live-profile qualification. Keep the trusted proposal registration method internal during the first slices. Before the separate SOD process is wired to it, implement an authenticated, replay-bound service handoff that verifies the exact run/output/chart bindings. Browser-supplied profile tags are never that handoff. No provider integration ships with this boundary left as a stub.

Registered fast-path candidate identity/version/content bindings must be consulted in the shared ingress authority, including canonical JSON, manual envelope, automated and legacy entry points. Omitting the profile/proof must not admit a registered proposal or bypass an unresolved acceptance. Altering payload under a registered identity is a conflict. Unregistered manual submissions retain legacy semantics and cannot acquire a live-validation badge. Do not claim that locally entered trading ideas can be semantically deduplicated across invented identities.

Return a deliberately projected response. Existing broad store snapshots must not expose raw chart material, session/internal channel secrets or private evidence through unrelated candidate APIs.

## 6. Acceptance protocol

1. Authenticate and resolve the exact preview/account/revision/binding. Return an existing terminal receipt first, irrespective of later expiry, with current read-only lifecycle projection. Same operation ID with different intent is a conflict.
2. In one transaction, verify the preview is still eligible/unretired and reserve its preallocated operation as `ACCEPTING`. Persist that intent before asynchronous work. Only one operation may be unresolved for the bound proposal identity. Duplicate requests return its status; they do not launch another worker.
3. Obtain current market/account/ownership evidence outside the transaction. This is read-only work, not permission/ARM execution. Keep a process-generation continuation token so recovery/cancelled workers cannot later commit.
4. Reenter the shared transaction boundary. Recheck the operation, revision, policy, selected account, relevant state/ownership fingerprints, source and receipt clocks, elapsed time, absolute expiry and fixed setup predicates. Apply read-only effective validity. Changed substantive inputs require new review; never rebase the proposal or consume a different supersession authorization silently.
5. Run the canonical planner against current state, then atomically persist its result with the terminal receipt. A pre-existing exact candidate yields `ALREADY_PRESENT`, not a new acceptance event; display its actual lifecycle, including terminal/superseded/ARMED state. Required revision/supersession review yields `NOT_ADMITTED` with the existing informed-review path.
6. Only after durable commit, return the receipt plus a separately timestamped lifecycle projection. Subsequent ordinary lifecycle reconciliation may advance that projection; it does not rewrite historical admission truth. A response failure never turns a known durable success into a new import request.

Account/ownership stores and remote quotes are not part of the same file transaction. Validate their versions/health/age at the final boundary; serialize participating same-process authority mutations or revalidate exact revisions. Unknown/external concurrent changes fail the bounded check. Do not claim atomicity with the external market or remote account. Candidate admission grants no downstream authority; normal permission/review/ARM checks remain mandatory.

## 7. Discard, cancellation and recovery

| Situation | Authoritative result and UI behavior |
|---|---|
| Discard commits before acceptance reservation | Persist `DISCARDED`; later accept cannot reserve. Show “Preview discarded — this preview imported nothing.” |
| Acceptance reservation wins | Discard does not cancel or erase the operation. Show “Acceptance in progress — check outcome.” |
| Candidate/receipt committed | Preserve receipt. Offer “Close preview”; removing a candidate is a separate lifecycle action. |
| Request times out / transport fails | Show `OUTCOME_UNKNOWN` as a client observation; query the original operation. Do not infer failure, allocate a fresh ID or offer a success-like discard. |
| Analysis cancelled/edited | Persist retirement of the run/input revision; late provider output cannot register a preview. Transport abort alone is not authoritative cancellation. |
| Reload / another tab / sleeping browser | Fetch current server draft/preview/operation. Old tabs cannot revive retired revisions; freshness recheck precedes enabled acceptance. |
| Restart with valid `ACCEPTING` intent but no final transaction | Under exclusive writer recovery, prove no linked candidate/receipt committed, invalidate old workers, and persist `NOT_ADMITTED / INTERRUPTED`. Require explicit new review; never auto-resume market-sensitive admission. |
| Restart with linked committed receipt | Return original receipt and current state; no repeat admission even if preview is expired. |
| Corrupt linkage, missing initialized store or uncertain durability | Fence writes and show recovery required. Never infer “nothing imported” from absence in one partial projection. |

Other nonterminal previews become revalidation-required after restart; do not reuse process-monotonic timing across boots. Browser state is a convenience cache, not authority. A receipt from some other prior import remains visible separately even when this preview was discarded.

Preflight must leave candidates, DSS evaluations, lifecycle events/operations, import log, manual supersession authority and downstream files unchanged. Persisting preview metadata is permitted. Test those subtrees/files directly; do not rely on a UI snapshot that hides side effects. In particular, avoid lifecycle helpers that migrate or reconcile live candidates during reads.

## 8. Implement in bounded slices

| Slice | Deliverable and exit check | Development model |
|---|---|---|
| B2 | Close verified quote-review findings below; focused regressions, full tests/build before safety handoff | Sol / high |
| C1 | Pure/shared admission planner; transactional store, schema migration, lock and failpoints; existing ingress behavior unchanged | Sol / high |
| C2 | Persisted preview/acceptance/receipt authority with injected evidence/policy; deterministic race/restart tests, disabled feature | Sol / high |
| C3 | Session-protected routes and readable card/discard/check-outcome UI; multi-tab and response-loss browser tests | Sol / high; mechanical copy/docs may use Luna / medium |
| C4 | Independent implementation review of atomicity, recovery and authority bypass; then integrate approved provider/evidence policy | Sol / high first; bounded Astra / high only for unresolved critical questions |

This handoff completes the bounded Astra design pass. Do not repeat the whole repository audit in the next slice. Use its exact file map and failing tests as the entry point; report new evidence, not restated plans.

Minimum adversarial test matrix:

- Pure preflight, including expired candidates and supersession cases, produces no authoritative trading-state writes.
- All existing normalizers, immutable hashes, duplicate/version/lineage rules and reviewed supersession behaviors are preserved.
- Every new root survives save/load; malformed roots fail closed; unsupported schema, initialized-store loss and unsafe downgrade are blocked.
- Two processes cannot write concurrently; nested/reentrant writes cannot bypass transaction/fence behavior.
- Fail before temp write, after file flush, before/after rename, during directory flush and after commit before response; restart proves the correct operation outcome without second admission.
- Discard/accept in both orders, simultaneous accepts, refresh/edit during generation, stale-tab replay, and process restart during market evidence fetch.
- Retry the same acceptance after expiry or later lifecycle transition; same ID/different account/hash/revision conflicts; no candidacy or journal duplication.
- Legacy import paths cannot bypass registered-proposal or unresolved-operation constraints, including by stripping profile metadata.
- Quote expires during async work; policy/account/ownership/lineage changes; price returns after a path-dependent breach; missing coverage blocks qualification.
- Missing/fake session, wrong origin/Host, non-loopback access, oversized input and attempted evidence assertion are rejected before mutation.
- UI timeout preserves the original operation, failed refresh cannot hide a committed receipt, and local parser preview never claims live verification.

Use temporary test stores and deterministic clocks only. Do not restart the operator's running services, read credentials, make paid provider calls, import a live candidate or place broker orders to verify these slices. Full qualification and the one-card lifecycle exercise remain later supervised gates.

## 9. B2 findings: fix before preview implementation advances

A bounded independent Sol/high review of `82febc3` and `283ad90` returned three findings. The main review verified them with code inspection and network-free probes, and found the related timestamp-alias regression below. These are **open defects at the review base**, not completed fixes. Prior passing suites do not cover them.

| Priority | Reproduction / evidence | Required change and regression |
|---|---|---|
| P1 | `freshness('2026-09-01T00:00:00.500Z', { nowMs: new Date('2026-09-01T00:00:05.999Z'), maxAgeMs: 5000 })` returns age 4500 and non-stale; actual age is 5499 ms. `clock-freshness.mjs` parses `String(Date)`, losing milliseconds. | Preserve `Date.getTime()` precision. Centralize supported timestamp normalization, reject invalid/out-of-Date-range values without throwing, and test both source and local-clock fractional boundaries. |
| P2 | A resolver quote with `asOf: '1788220804000'` is `QUOTE_STALE` at `2026-09-01T00:00:05Z`; its equivalent ISO timestamp is VALID. A quote using the previously supported `quoteObservedAt` alias also becomes `QUOTE_STALE`. The resolver parses these forms, but `assessQuoteEvidence()` reparses raw input differently. | Use one normalized source timestamp through freshness and returned provenance. Preserve documented legacy input forms; do not allow an alias or trade timestamp to override an explicitly invalid authoritative bid/ask timestamp. Test ISO, epoch number/string, Date and legacy alias consistently. |
| P1 | Strict resolver evaluation succeeds with receipt/realtime evidence, but returns neither field. `risk-evaluation.mjs:entrySnapshot()` drops them, and both `pretrade-arm-service.mjs:#assertFreshRisk()` and `arm-authorization-service.mjs:assertRiskEvaluationFreshAtAuthorization()` check only quote-source/account age. | Persist immutable source/receipt/realtime evidence and its server-selected policy in the risk evaluation. Validate its schema/integrity and recheck it at both ARM boundaries. Add a case where source is still within five seconds but receipt has expired by ARM time. |

Risk-evaluation migration must preserve historical hashes/receipts without silently granting new live authorization to old evaluations missing required evidence. Live ARM requires a newly evaluated complete record; compatibility/offline tests may retain explicitly separate legacy behavior. The browser cannot opt into that compatibility mode or override the server-selected policy. Evaluate existing review-package fingerprints and downstream consumers before extending persisted schema.

The final ARM check revalidates recorded entitlement evidence; it does not prove that the broker has not revoked entitlement since the quote was received. Keep that claim bounded to the evidence age policy. All fixes retain the current five-second quote and 15-second account thresholds; none introduce chart/card age rejection.

## 10. Review evidence and handoff boundary

This pass produced the protocol, repository-specific file map, failure/recovery rules, test matrix and B2 fix queue. It changed documentation only. No runtime service was restarted, no candidate was imported, and no provider or broker operation was performed. Remote issue/PR status remains the dated audit snapshot, not a fresh query in this pass.

Documentation verification: six changed documents, 26 local links resolved, code fences/final newlines checked, and whitespace validation passed. Deterministic timestamp/resolver probes reproduced the B2 findings; runtime suites/build were not rerun for this documentation-only pass.

Resume with B2 on Sol/high, then C1. Escalate back to Astra only for a specific unresolved critical authority/recovery question. Existing issues #16/#17 and deferred provider integration remain separate work; neither is silently closed by this design handoff.
