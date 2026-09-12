# ExecutionOS V2.4 — Production SOD Analysis Provider Hardening & Run Integrity Implementation Handoff v1.0

**Status:** APPROVED IMPLEMENTATION HANDOFF<br>
**Date:** 2026-09-12<br>
**Repository:** `sibolek/structure-based-trade-management`<br>
**Branch:** `v24-sod-production-analysis-provider`<br>
**Implementation base:** `e2357933147600e702c5e252020b257debbe3392`<br>
**Design authority:** `docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Design_Baseline_v1.0_APPROVED.md`<br>
**Implementation status:** PENDING<br>
**Live OpenAI acceptance:** PENDING

---

## 1. Task

Implement **ExecutionOS V2.4 — Production SOD Analysis Provider Hardening & Run Integrity** exactly within the frozen design baseline.

This is an implementation task, not another architecture exercise. Preserve the existing OpenAI Responses provider architecture and make the narrow changes needed to satisfy Decisions 1–27 and Acceptance Matrix A–V.

Do not invent a second provider, orchestration route, candidate-ingress path, workflow engine, or authority model.

---

## 2. Repository and immutable starting point

Repository:

```text
sibolek/structure-based-trade-management
```

Implementation branch and worktree:

```text
branch: v24-sod-production-analysis-provider
worktree: ~/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider
```

Exact implementation base:

```text
e2357933147600e702c5e252020b257debbe3392
```

Accepted prior SOD architecture checkpoint:

```text
4144c5c59494ae318bb736d64fba751a22046512
```

Before editing implementation:

1. verify the branch and worktree;
2. verify HEAD descends from the exact implementation base;
3. inspect current code and tests before changing them;
4. preserve unrelated user work;
5. record the starting repository state.

Never amend, rebase, reset, or otherwise rewrite accepted predecessor history. Use fix-forward commits only.

---

## 3. Governing authority boundary

The external model proposes trade substance only. The trusted local adapter may retain its accepted deterministic candidate-identity assignment. Candidate identity is not version, lineage, lifecycle, ARM, handoff, execution, or broker authority.

PRETRADE remains authoritative for:

- candidate admission and immutable version state;
- lifecycle and `stateRevision`;
- supersession eligibility;
- trigger, DSS, permission, risk, review, and quantity;
- ARM and handoff eligibility.

Candidate Feeder remains transport only. The renderer remains deterministic rendering authority. Browser state remains presentation and operator intent only.

Broker-write authority remains false. This slice must not place, replace, modify, cancel, reduce, or flatten broker orders.

---

## 4. Non-negotiable implementation constraints

- Implement only the frozen baseline.
- Preserve the existing Responses API architecture.
- Prefer narrow changes that follow repository patterns.
- Do not change deterministic candidate identity.
- Do not add silent or automatic provider retries.
- Do not broaden provider, browser, Candidate Feeder, PRETRADE, ARM, execution, filesystem, or broker authority.
- Do not modify an accepted component merely because it appears in the likely-file list.
- Do not weaken manual-ingestion parsing, canonical hashing, or recovery behavior.
- Do not treat test success, a commit, or a pushed review checkpoint as user acceptance.
- Do not merge.

---

## 5. Required hardened flow

Implement the production flow as:

```text
browser creates runId
→ server validates and normalizes request
→ server derives stable requestHash
→ durable per-sourceDate run claim
→ pre-resolution chart count check
→ incremental authorized chart resolution and byte accounting
→ bounded serialized Responses request
→ PROVIDER_REQUEST_STARTED
→ bounded raw Responses body
→ bounded duplicate-aware structural JSON validation
→ exact local SOD_OPENAI_TRANSPORT_SCHEMA validation
→ semantic/source/provenance validation
→ normalized provider result
→ immutable durable provider-result artifact
→ PROVIDER_RESULT_DURABLE
→ fresh PRETRADE snapshot
→ canonical export and lineage
→ deterministic artifact rendering
→ publication intent
→ immediate PRETRADE authority fence
→ same-identity atomic publication
→ PUBLICATION_COMMITTED
→ terminal durable result
```

No provider call occurs before durable run claim. No authority-sensitive lineage occurs from a pre-provider snapshot. No publication occurs from stale PRETRADE evidence.

---

## 6. Artifact URL implementation contract

At the generic artifact-content boundary:

- accept only absolute `http:` and `https:` source URLs;
- reject malformed, relative, `javascript:`, `data:`, `file:`, `ftp:`, and custom-scheme values;
- fail closed instead of removing or coercing invalid values.

At the OpenAI response boundary:

- canonicalize artifact URLs with the existing source-normalization rules;
- require each non-null URL to match an actual `web_search` source from that exact response;
- preserve existing research-evidence and candidate-provenance checks.

The renderer may add `noopener` alongside `noreferrer`, but generic validation remains the primary security boundary.

---

## 7. Provider resource implementation contract

Enforce these fixed v1 ceilings:

| Resource | Maximum |
|---|---:|
| Charts | 16 |
| Aggregate raw chart bytes | 32 MiB |
| Serialized OpenAI request | 48 MiB |
| Raw OpenAI response | 4 MiB |
| Structured output text | 768 KiB |
| JSON nesting depth | 48 |
| JSON structural nodes | 25,000 |
| Keys in one object | 500 |
| Items in one array | 5,000 |
| One decoded string | 64 KiB UTF-8 |

Requirements:

- reject count overflow before resolving all charts;
- resolve only refs present in the normalized authorized request;
- account raw bytes incrementally and stop at the first overflow;
- avoid unnecessary retained full-byte copies;
- calculate the serialized request size before network submission;
- account for base64 and JSON expansion;
- reject oversized request/response/output atomically without truncation or partial parsing.

Do not weaken the chart store's existing per-file boundary.

---

## 8. Production HTTP and strict-JSON contract

Replace unbounded production `response.json()` with a byte-bounded response reader. Content-Length may be used for early rejection but must not be trusted as the sole bound. Stop reading and fail closed when the actual byte count exceeds the ceiling.

The raw body and structured output must never be returned in sanitized browser errors.

Before mapping structured provider output:

1. enforce output bytes;
2. detect duplicate object keys at every nesting level;
3. enforce depth, node, key, array, and string limits;
4. decode JSON;
5. validate the complete local transport schema exactly;
6. perform semantic and provenance checks;
7. map to the generic provider result.

The local validator must enforce required properties, closed objects, types, enums, item bounds, numeric constraints, and nested structure. Do not default schema-invalid transport into apparently valid local values.

Use a small existing dependency or narrow utility. A general validation platform is not required.

---

## 9. Durable run-store contract

Implement a narrowly scoped local run store with:

- an explicit configured root;
- fail-closed startup validation;
- append-oriented immutable journal evidence;
- atomic durable writes;
- one writer per run;
- one active run per `sourceDate`;
- deterministic reconstruction after restart;
- immutable content-addressed provider-result artifacts;
- exact publication-intent and commitment evidence.

The store must not be browser local state, the Candidate Feeder inbox, or another PRETRADE candidate store.

The store records the semantic stages from Decision 13. Transition validation must reject impossible regression, conflicting duplicate events, hash mismatch, ambiguous ordering, or split-brain active claims.

An active `sourceDate` claim is released only by a terminal state. `RECOVERY_REQUIRED / PROVIDER_OUTCOME_AMBIGUOUS` retains the claim until eligible explicit abandonment records `ABANDONED`.

---

## 10. Run identity and replay contract

The browser creates a UUID-quality `runId` before Generate or Refresh. The normalized analysis request excludes `runId`, then uses stable canonical JSON and SHA-256 to derive `requestHash`.

Implement exactly:

| Input | Required result |
|---|---|
| New `runId`, no active same-date run | Claim and start the durable run. |
| Same `runId`, same `requestHash` | Resume or replay exact durable work. |
| Same `runId`, different `requestHash` | Hard conflict; no mutation or provider call. |
| Different `runId`, same active `sourceDate` | Return active run identity/state; no provider call. |
| New `runId` after prior terminal same-date run | Permit explicit new run. |

Terminal replay returns the recorded result without another provider call, publication, or Candidate Feeder artifact.

---

## 11. Provider result and ambiguous-outcome recovery

After complete validation, durably write the exact normalized bounded provider result before PRETRADE-sensitive work. Hash it and append `PROVIDER_RESULT_DURABLE` only after the artifact is recoverable.

Recovery from that point reuses the exact artifact and never invokes OpenAI again.

If recovery sees `PROVIDER_REQUEST_STARTED` without `PROVIDER_RESULT_DURABLE`, record `RECOVERY_REQUIRED` with reason `PROVIDER_OUTCOME_AMBIGUOUS`. Do not infer success/failure and do not retry.

Expose an authorized explicit abandon operation only for eligible recovery states. It appends `ABANDONED`, preserves history, and releases the date claim. A subsequent provider attempt uses a new `runId`.

---

## 12. PRETRADE freshness and authority fences

Do not use a pre-provider PRETRADE snapshot for final lineage.

After `PROVIDER_RESULT_DURABLE`:

1. fetch fresh authoritative PRETRADE state;
2. export candidates and resolve lineage from that state;
3. record the relevant state fingerprint and prepare artifacts/publication intent;
4. fetch PRETRADE again immediately before publication;
5. compare authority-relevant candidate identity/version/hash/lifecycle/revision information.

If the fingerprint changed, do not publish and do not call the provider again. Recompute from the durable provider result and fresh authority, or return a resumable/action-required state when deterministic completion cannot occur in the same request. Bound any automatic in-request recomputation so continuous churn fails closed.

Every restart recovery must refresh PRETRADE before lineage or publication. Stored snapshots are provenance only.

---

## 13. Publication recovery contract

For READY_TO_PUBLISH runs:

1. deterministically allocate one publication identity for the run;
2. compute the exact bundle bytes and hash;
3. append and durably commit `PUBLICATION_INTENT_RECORDED` before filesystem publication;
4. invoke the existing atomic same-directory publication with that same identity;
5. append `PUBLICATION_COMMITTED` with exact identity, filename, SHA-256, and byte length;
6. record `SUCCESS` only after commitment evidence is durable.

Recovery from intent without commit inspects the exact intended destination:

- expected file and hash present: reconcile as committed;
- file absent: retry publication with the same identity and bytes;
- conflicting bytes present: fail closed with a publication-recovery conflict.

Never generate a fresh publication ID merely because commitment recording was interrupted.

---

## 14. API and browser contract

Preserve loopback-only origin and SOD session authorization.

Add only the narrow capabilities needed to:

- generate/resume with `runId`;
- read durable run status and terminal result;
- report active same-date conflicts;
- abandon an eligible ambiguous recovery run.

The UI may display `runId`, durable stage, readiness, terminal status, preflight requirement, recovery ambiguity, conflict, and abandonment availability. It has no direct run-store/filesystem access and no PRETRADE, ARM, handoff, execution, or broker authority.

Browser busy state remains UX only. It is not server-side single-flight.

---

## 15. Readiness and acceptance evidence

Replace the unconditional health claim with explicit read-only readiness fields:

- `providerLoaded`;
- `providerConfigured`;
- `modelConfigured`;
- `liveAcceptanceValidated`.

Health reads do not call OpenAI. There is no silent model fallback.

`liveAcceptanceValidated` is true only when durable sanitized evidence matches the configured production provider/model combination. A configuration/model change must not inherit unrelated prior acceptance evidence.

After all offline validation passes, run one explicit opt-in credentialed production-path validation covering Responses connectivity, image input, required web search, strict structured-output compatibility, local validation, source extraction, and parser/mapping compatibility.

Never persist secrets, private chart bytes in documentation, raw secret-bearing requests, or unnecessary full provider responses.

---

## 16. Failure and sanitization contract

Use stable error codes for the failure classes in Decision 24. Preserve safe upstream request IDs where useful.

Do not expose:

- API keys or Authorization headers;
- browser session tokens;
- configured local filesystem paths;
- raw upstream error bodies;
- raw secret-bearing environment;
- private provider request content in browser errors.

Improve HTTP status mapping where appropriate, but keep exact status numbers subordinate to stable failure semantics.

There are no silent provider retries.

---

## 17. Likely implementation areas

Inspect these likely areas, but modify only files actually required:

- `schwab-bridge/sod-analysis-provider.mjs`
- `schwab-bridge/sod-openai-analysis-provider.mjs`
- `schwab-bridge/sod-openai-production-provider.mjs`
- `schwab-bridge/sod-orchestration-api.mjs`
- `schwab-bridge/sod-orchestration-core.mjs`
- `schwab-bridge/sod-artifact-content.mjs`
- `schwab-bridge/sod-artifact-renderer.mjs`
- `schwab-bridge/sod-candidate-publisher.mjs`
- new narrowly scoped run-store or strict-JSON utilities if needed
- `src/components/SodWorkspace.jsx`
- `src/hooks/useSodOrchestration.js`
- `src/sod/sod-orchestration-api-client.js`
- focused tests for every new trust, safety, freshness, and recovery behavior

Appearance on this list is not a requirement to modify the file.

Do not require redesign of chart-store identity, renderer layout, candidate export, lineage, Candidate Feeder, PRETRADE, manual ingestion, ARM, handoff, execution lifecycle, or broker observation.

---

## 18. Suggested implementation order

1. Add focused failing tests for URL trust, resource ceilings, strict parsing, and schema enforcement.
2. Harden artifact URLs and OpenAI source membership.
3. Move chart-count enforcement before eager resolution and add incremental byte accounting.
4. Add serialized request and bounded response/output handling.
5. Add duplicate-aware structural parsing and exact local transport-schema enforcement.
6. Add isolated run-store tests and implement claim/replay/state reconstruction.
7. Add durable provider-result and ambiguous-outcome recovery.
8. Move authority-sensitive lineage after fresh post-provider PRETRADE state.
9. Add the pre-publication authority fence and durable-result recomputation path.
10. Add deterministic publication intent/commit recovery.
11. Add run-status/abandon API and browser recovery/readiness presentation.
12. Run focused tests, package regressions, full V2.4 regression, and build.
13. Run credentialed acceptance only after every offline gate passes.

This order is guidance. The frozen behavior and acceptance matrix govern.

---

## 19. Focused test commands

Run focused implementation tests first, one at a time where failure isolation matters:

```bash
node --test tests/sod-analysis-provider.test.mjs
node --test tests/sod-openai-analysis-provider.test.mjs
node --test tests/sod-openai-production-provider.test.mjs
node --test tests/sod-artifact-renderer.test.mjs
node --test tests/sod-orchestration-api.test.mjs
node --test tests/sod-orchestration-api-safety.test.mjs
node --test tests/sod-orchestration-core.test.mjs
node --test tests/sod-chart-store.test.mjs
node --test tests/sod-candidate-export.test.mjs
node --test tests/sod-candidate-lineage.test.mjs
node --test tests/sod-candidate-publisher.test.mjs
```

Also run every new run-store, strict-JSON, authority-freshness, publication-recovery, and live-acceptance harness test introduced by the implementation.

Do not modify tests merely to preserve old permissive behavior that conflicts with the frozen baseline.

---

## 20. Package and full regression gates

After focused tests pass, run:

```bash
npm run v24:sod-orchestrator-test
npm run v24:sod-export-test
npm run v24:candidate-feed-test
npm run v24:manual-ingestion-test
```

Then run the complete existing V2.4 regression suite required by current package scripts and accepted downstream checklists, followed by:

```bash
npm run build
```

Use required loopback permission for tests that bind `127.0.0.1`; do not alter code or tests to work around sandbox restrictions.

The credentialed OpenAI acceptance validation occurs only after all offline tests and build pass. It must be explicit and opt-in and must not become part of ordinary offline regression.

---

## 21. Mandatory acceptance scope

The implementation is incomplete until every applicable case in Acceptance Matrix A–V of the design baseline has direct evidence.

At minimum, evidence must cover:

- unchanged candidate identity and authority boundaries;
- artifact URL scheme and actual-source membership;
- all request, response, output, and structural ceilings;
- duplicate keys at top level and every nested level;
- exact local transport schema;
- run claim, hash conflict, single-flight, replay, and lost-response recovery;
- provider-result durability and hash integrity;
- ambiguous provider outcome and abandonment;
- post-provider PRETRADE freshness and pre-publication authority fencing;
- publication crash windows and same-identity reconciliation;
- readiness truthfulness and complete error sanitization;
- existing SOD, Candidate Feeder, manual-ingestion, PRETRADE, ARM, handoff, execution, and build regressions;
- explicit credentialed OpenAI acceptance.

Passing tests is necessary evidence, not user acceptance.

---

## 22. Commit and history discipline

- Use fix-forward commits.
- Never amend accepted commits.
- Never rebase or reset accepted predecessor history.
- Do not force-push.
- Keep changes scoped to this slice.
- Inspect uncommitted and staged diffs before each checkpoint commit.
- Do not include credentials, local run data, private chart bytes, or live raw provider responses in Git.
- Do not merge.
- Do not declare the slice accepted.

Codex may create a reviewed local implementation checkpoint only when explicitly requested. The user controls pushing the review checkpoint.

---

## 23. Independent review workflow

The required workflow is:

```text
DESIGN IN CHAT
→ USER APPROVES / FREEZES DESIGN
→ CODEX IMPLEMENTS
→ CODEX RUNS TARGETED TESTS
→ CODEX RUNS FULL REGRESSION + BUILD
→ CODEX COMMITS LOCALLY
→ USER PUSHES REVIEW CHECKPOINT
→ CHATGPT REVIEWS ACTUAL GITHUB DIFF
→ ADVERSARIAL REVIEW IF NEEDED
→ USER ACCEPTS OR REJECTS
```

Codex must not merge, claim acceptance, rewrite history, force-push, or treat passing tests as acceptance.

---

## 24. Required implementation closeout report

Before requesting review, report:

1. starting base and final implementation SHA;
2. every changed file;
3. implementation mapping to Decisions 1–27;
4. Acceptance Matrix A–V evidence;
5. exact focused and package-level test results;
6. full V2.4 regression and build results;
7. credentialed validation status and sanitized evidence path, without secrets;
8. final repository status;
9. confirmation that no merge or acceptance claim occurred.

---

## Frozen handoff close

This handoff is approved implementation instruction subordinate to the design baseline. It is not implementation evidence, live-provider evidence, merge approval, release approval, or user acceptance.

Implement the frozen decisions only. Stop for design approval if implementation would require changing candidate identity, adding automatic retries, weakening a prior accepted authority boundary, or expanding beyond the explicit scope.
