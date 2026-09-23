# Live PRETRADE preview persistence and recovery runbook

**Date:** 2026-09-21

**2026-09-22 approved amendment:** [Operator-reviewed import scope](ExecutionOS_Operator_Reviewed_Import_Approval_2026-09-22.md) supersedes the earlier unresolved combined timing decision below. The approved target is combined automated creation+import p95 <=30 seconds, excluding human review, and acceptance-to-visible p95 <=5 seconds. It introduces no chart/card age cutoff and does not enable production.

**Status:** Implemented behind a disabled readiness gate. This document does not enable live preview admission, authorize trading, or approve a freshness policy.

## Runtime boundary

The preview authority uses the PRETRADE snapshot as the only candidate and preview record store. Store schema 2 adds a store epoch, monotonic revision, transaction ID, preview revisions, acceptance operations, and terminal receipts. Schema 1 snapshots migrate on first schema-2 commit. Enabling this runtime requires a coordinated shutdown and a versioned store-path cutover; an older service must never write the upgraded active store. Rollback requires restoring the state file and its matching generation record together from the pre-cutover backup.

Production preview readiness remains disabled until an approved named policy and authenticated provider/evidence handoff are installed. Browser routes cannot register a trusted proposal or submit PASS/realtime evidence. They can read status, discard, request acceptance, refresh server evidence, and check the original operation outcome through an in-memory per-boot session token.

No chart or trade-card stale-age threshold is configured. Existing contract `validUntil`, five-second quote source/receipt checks, realtime evidence, and 15-second account checks remain in force.

## Commit guarantee

The PRETRADE process acquires an exclusive writer lock before loading state and holds it until shutdown. It never reclaims a lock based on age. Lock acquisition performs a same-directory capability probe that writes and flushes a unique file, renames it, flushes the directory, removes it, and flushes the directory again. Preview readiness remains false unless that probe succeeds. Each commit then uses the same required primitives for a uniquely named temporary file. This provides the guarantees of the local filesystem and operating system for flushed file data, atomic same-directory rename, and directory-entry persistence. A successful capability probe is not a power-loss certification. Network filesystems, cloud-synchronized folders, or filesystems that do not honor these operations are unsupported for preview readiness.

A failure before rename leaves the prior authoritative snapshot in place and removes the temporary file. A failure after rename fences every writer because replacement or durability acknowledgment is ambiguous. The service must be restarted under the writer lock and the authoritative state validated. Temporary files are never promoted automatically.

The generation record detects unexpected loss or mismatched restore of an initialized state file. Missing state with an existing generation record, corrupt preview-operation linkage, unsupported schema, or a generation mismatch requires operator recovery. Do not create a replacement acceptance operation in that condition.

## Recovery behavior

On restart, a committed terminal receipt remains authoritative and is returned for the original operation even after preview expiry or later candidate lifecycle changes. An `ACCEPTING` operation with no linked receipt becomes `NOT_ADMITTED / INTERRUPTED`; it is never resumed automatically. Other nonterminal previews require server evidence refresh or a new explicit review. The fixed chart/source times, proposal references, and configured absolute expiry are carried forward unchanged during evidence refresh.

Discard before reservation persists `DISCARDED` and proves that preview imported nothing. If reservation wins, discard reports acceptance in progress. Transport failure is represented to the browser as `OUTCOME_UNKNOWN`; the browser checks the original operation and never creates a replacement ID.

## Qualification and latency

The implementation measures card production and admission separately. The draft target remains chart receipt to visible usable preview at p95 no more than 30 seconds, followed by acceptance click to reconciled visible result at p95 no more than five seconds. If the product requirement is end-to-end card creation plus completed PRETRADE import within 30 seconds, qualification must explicitly define whether operator review time is excluded and measure that combined interval. No latency target weakens integrity, evidence, ownership, account, or admission checks.

`pretrade-preview-qualification.mjs` builds bounded offline qualification records. It records chart receipt, provider, preflight, preview visibility, operator review, durable receipt and reconciled-result timing separately. It refuses unknown/raw fields and refuses to aggregate different build, model, prompt, profile or policy configurations. Cohort summaries use nearest-rank p95, report timing coverage and failure categories, and always return `productionQualified: false`; the summary is evidence for review, not an enablement decision. Browser visibility timestamps remain telemetry and never extend eligibility.

Before enablement, fault-test the deployed local filesystem at failures before temporary write, after file flush, before and after rename, during directory flush, and after commit before response. Retain the raw stage timing and transaction IDs with the qualification evidence.

## 2026-09-22 qualification addendum

See [bounded readiness review](ExecutionOS_Live_Preview_Readiness_Review_2026-09-22.md) for the exact service trust contract, policy decisions, latency definitions, fault outcome table and supervised one-card exercise. Production admission remains disabled.

The service retains its lifetime writer lock. All other current-binary commit callers now take the same lock for the commit and compare the exact persisted image they loaded; a stale image fences the caller instead of overwriting newer state. Such compatibility callers must reload under recovery after a conflict. Schema-2 preview roots are required, failed loads fence writes, and retained registered identities remain guarded after terminal outcomes. No lock is reclaimed by age.

Run `node --test tests/pretrade-preview-filesystem-qualification.test.mjs` to exercise the isolated reservation/final-commit process-death matrix and directory-flush EIO injection. It uses fresh temporary stores and only its own child processes. The test explicitly verifies child exit before removing that temporary child lock; it is not a production stale-lock remover. Same-host SIGKILL results do not certify power-loss persistence. The DURING_DIRECTORY_FLUSH failpoint injects failure at the syscall boundary; it does not emulate storage firmware or interrupted device flush.

The qualification helper now retains partial attempts, rejects duplicate operation/attempt IDs, checks stage ordering and reports paired combined workflow distributions with an explicit operator-review convention. No production timing collector or measured provider/browser cohort exists yet. Pre-commit `finishedAt` is not the durable-commit timestamp. Combined target approval, commit/paint/clock instrumentation and active refresh-time attribution remain gates.
