# Approved scope: operator-reviewed card import

Date: 2026-09-22. The operator explicitly approved the narrower import scope and timing definition following the focused review. **Scope approved; production deployment/admission not enabled.** This amendment takes precedence over draft requirements for automated setup-displacement qualification in the initial operator-reviewed import profile only.

## Approved behavior

Generate a readable card for operator review, accept/discard it through the PRETRADE preview transaction, and create or identify the canonical candidate. Do not add an automatic numeric price-displacement cutoff solely for this import. Do not claim that importing certifies setup quality, remaining reward or absence of a historical invalidation. Existing trigger, structural assessment, DSS, risk, review, quantity and ARM controls remain authoritative downstream; recorded operator assessments may be reused according to the existing workflow.

No chart/card stale-age limit or additional preview lifetime is approved. Preserve canonical `validUntil`, five-second quote source and receipt checks, realtime evidence, 15-second account evidence, existing clock-skew handling, account/ownership binding, immutable candidate identity, supersession rules, discard, replay protection and crash recovery. Original references and disqualifiers cannot be silently changed or waived. Acceptance grants no trigger satisfaction, permission, ARM, order or broker authority.

The server-owned profile/policy is `OPERATOR_REVIEWED_CARD_IMPORT_V1`. Setup assessment is explicitly `NOT_EVALUATED`; trading review remains required. Ordinary uploads do not gain a trusted-capture badge. Unknown capture time or chart age alone does not reject this profile; the actual provenance must remain honest. This is not a permissive fallback when a qualified-live proposal fails. Known preview identity bindings remain guarded through ordinary and legacy ingress.

The stronger qualified-live profile remains deferred. Its setup-specific displacement and historical-coverage requirements are not declared satisfied by this approval. A future qualified profile needs its own approved policy and tests.

## Approved timing definition

- Combined automated creation plus import: p95 <=30,000 ms, excluding human review time.
- Acceptance click through reconciled visible PRETRADE result: p95 <=5,000 ms.
- Preview visibility: p95 <=30,000 ms as an additional stage check.
- Report total wall time and human review time separately. Include active system work/waits during review, evidence refresh, acceptance, reconciliation and lost-response recovery. Count overlapping intervals once.
- These are measured cohort targets, not card expiry thresholds or a guarantee for every attempt. They remain unmeasured with real provider runs.

## Implemented offline slice

`pretrade-preview-policy.mjs` defines the exact immutable import policy and review scope. Readiness rejects unknown, malformed and deferred qualified profiles. Unprofiled `TEST_ONLY` policy is retained only through an explicit constructor option used by offline regression fixtures; production construction supplies neither that option nor an active policy/provider.

`pretrade-preview-authority.mjs` selects behavior from the bound server policy, never browser fields. Operator-reviewed evidence cannot assert `fixedPredicates` or a setup PASS. Final evidence still passes the existing quote/account/ownership checks and independent synchronous validator. Canonical validity is checked at the final boundary for new admissions. An exact existing candidate may return ALREADY_PRESENT without changing validity or lifecycle; original terminal receipts remain replayable.

The bound policy determines the projected review scope; new receipts persist it under their existing integrity hash. Store loading checks that an operator-reviewed receipt has precisely the expected NOT_EVALUATED scope, even if an inconsistent receipt's hash was recomputed. Existing legacy receipt hashes are preserved. Browser copy distinguishes an imported card requiring trading review from an existing candidate and its actual current state.

Qualification records are schema 2. Combined/acceptance timing uses the applicable attempted-acceptance population. No-setup/discard runs with no acceptance are N/A for that stage, not fabricated imports; missing/unknown attempted outcomes remain in the denominator. Active work during review is a bounded interval union, clipped at the click because subsequent work is already counted in acceptance. An explicit empty interval list means no such work was observed; omitted or unfinished timing cannot pass combined qualification. A nonnegative measured clock-uncertainty bound is required for passing timing checks. Tests use zero only for deterministic common-clock fixtures. At least 95% of applicable attempts must meet each target using conservative upper bounds; unknown/error/timeout responses cannot count as successful timing outcomes. Raw distributions remain available for diagnosis. `productionQualified` always remains false.

## Remaining dependencies and approval limits

This approval does not select production model/prompt/schema, approve all choices in the earlier decision packet, approve a challenge duration/key provisioning scheme, select a live account or authorize release. The authenticated provider/run/chart/output handoff and replay/cancellation ledger are still uninstalled. Read-only production evidence adapters, actual source/capture presentation, production commit/clock/paint telemetry, measured cohorts, deployed storage/restore qualification and the supervised complete one-card exercise remain follow-up work.

This slice does not start services, access credentials, make paid provider calls, import a live candidate, change an account, trade, commit, push or merge. Production `pretrade-api.mjs` remains explicitly disabled with null policy/provider and no final validator. Do not enable it solely by supplying the exported policy constant: real handoff/evidence/qualification gates still apply.
