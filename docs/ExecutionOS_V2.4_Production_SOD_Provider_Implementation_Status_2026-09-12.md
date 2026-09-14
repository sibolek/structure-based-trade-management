# Production SOD provider hardening and run integrity — implementation status

> Current-status update after Decision 28: **A–U PASS; V BLOCKED; no commit.** See the [Decision 28 implementation report](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/docs/ExecutionOS_V2.4_Decision_28_Implementation_Report_2026-09-12.md) for the final 1,063/1,063 regression result and complete current evidence. The provider-only results below are retained as the earlier validation record.

Date: 2026-09-12. **Uncommitted implementation checkpoint, pending independent review and user acceptance.** The slice is **not complete or accepted**: Acceptance T is FAIL and V is BLOCKED. No checkpoint commit was created. No release, merge, or production-readiness claim is made.

This report covers the 41 requested reporting items. PASS below means the stated local implementation/test gate passed; it does not mean independent acceptance. Live compatibility remains unverified.

## Repository state (items 1–5)

- Starting HEAD: `e0543be3cf0cffa246f03ca427aca17523790291`.
- Ending HEAD: `e0543be3cf0cffa246f03ca427aca17523790291`; no implementation commit.
- Branch: `v24-sod-production-analysis-provider`.
- Worktree: `/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider`.
- Initial working tree was clean. Required branch, HEAD, last three commits, and merge-base were checked before editing.
- Merge-base against the frozen design: `b45a67051c39d7f985cc190e7648dbac180bda1d`.
- The diff from frozen design to starting HEAD contained only the three approved roadmap documentation changes. The later roadmap did not supersede the frozen provider design.
- The frozen baseline, implementation handoff, documentation status/index, and current roadmap were read. No applicable AGENTS.md was found.

Exact changed files follow. M denotes modified tracked files; A denotes new untracked implementation/report files. All are in this worktree.

| State | File |
|---|---|
| M | [package.json](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/package.json) |
| M | [schwab-bridge/sod-analysis-provider.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-analysis-provider.mjs) |
| M | [schwab-bridge/sod-artifact-content.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-artifact-content.mjs) |
| M | [schwab-bridge/sod-artifact-renderer.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-artifact-renderer.mjs) |
| M | [schwab-bridge/sod-candidate-publisher.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-candidate-publisher.mjs) |
| M | [schwab-bridge/sod-chart-store.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-chart-store.mjs) |
| M | [schwab-bridge/sod-openai-analysis-provider.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-openai-analysis-provider.mjs) |
| M | [schwab-bridge/sod-openai-production-provider.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-openai-production-provider.mjs) |
| M | [schwab-bridge/sod-orchestration-api.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-orchestration-api.mjs) |
| M | [schwab-bridge/sod-orchestration-core.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-orchestration-core.mjs) |
| M | [src/components/SodWorkspace.jsx](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/components/SodWorkspace.jsx) |
| M | [src/hooks/useSodOrchestration.js](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/hooks/useSodOrchestration.js) |
| M | [src/sod/sod-orchestration-api-client.js](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/sod/sod-orchestration-api-client.js) |
| M | [tests/execution-v24-pretrade-full-e2e.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/execution-v24-pretrade-full-e2e.test.mjs) |
| M | [tests/pretrade-arm-lifecycle-authority.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-arm-lifecycle-authority.test.mjs) |
| M | [tests/pretrade-arm-service.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-arm-service.test.mjs) |
| M | [tests/pretrade-blocked-handoff-retirement.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-blocked-handoff-retirement.test.mjs) |
| M | [tests/pretrade-candidate-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-candidate-api.test.mjs) |
| M | [tests/pretrade-lifecycle-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-lifecycle-api.test.mjs) |
| M | [tests/pretrade-permission-pipeline.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-permission-pipeline.test.mjs) |
| M | [tests/pretrade-trigger-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-api.test.mjs) |
| M | [tests/pretrade-trigger-engine.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs) |
| M | [tests/pretrade-trigger-persistence.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-persistence.test.mjs) |
| M | [tests/pretrade-validity-lifecycle.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-validity-lifecycle.test.mjs) |
| M | [tests/sod-openai-analysis-provider.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-openai-analysis-provider.test.mjs) |
| M | [tests/sod-openai-production-provider.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-openai-production-provider.test.mjs) |
| M | [tests/sod-orchestration-api-safety.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-orchestration-api-safety.test.mjs) |
| M | [tests/sod-orchestration-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-orchestration-api.test.mjs) |
| M | [tests/sod-orchestration-client.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-orchestration-client.test.mjs) |
| A | [schwab-bridge/sod-live-acceptance.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-live-acceptance.mjs) |
| A | [schwab-bridge/sod-production-run.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-production-run.mjs) |
| A | [schwab-bridge/sod-provider-validation.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-provider-validation.mjs) |
| A | [schwab-bridge/sod-run-store.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-run-store.mjs) |
| A | [tests/helpers/sod-openai-fixture.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/helpers/sod-openai-fixture.mjs) |
| A | [tests/sod-live-acceptance.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-live-acceptance.test.mjs) |
| A | [tests/sod-provider-hardening.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-provider-hardening.test.mjs) |
| A | [tests/sod-run-integrity.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-run-integrity.test.mjs) |
| A | [docs/ExecutionOS_V2.4_Production_SOD_Provider_Implementation_Status_2026-09-12.md](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/docs/ExecutionOS_V2.4_Production_SOD_Provider_Implementation_Status_2026-09-12.md) |

## Architecture and frozen decisions (items 6–22)

The existing fixed OpenAI Responses endpoint, image inputs, mandatory web_search, strict structured-output request, server-only key, explicit configured model, and store:false remain. A local SOD parser and exact transport-schema validator establish authority before mapping. The existing deterministic renderer, candidate export, lineage, feeder format, and PRETRADE reader remain the downstream boundaries.

The run path is: validate normalized request → durable claim → authorize chart metadata and resolve bounded chart bytes incrementally → durably record provider start immediately before transport → bounded HTTP/structured parsing and local validation → normalize and durably hash provider result → fresh authoritative PRETRADE → existing canonical export/lineage/render preparation → durable publication intent → fresh PRETRADE fence immediately before file visibility → atomic publication → durable commit → terminal result. A pure existing canonical validator checks proposal compatibility before durability; its temporary version/source placeholders never become exported version or admission authority.

| Decision | Implemented behavior and evidence |
|---|---|
| 1 | Responses architecture retained; fixed URL, POST, server authorization, store:false, mandatory search. Production transport and original provider tests pass. |
| 2 | Existing trusted deterministic candidate identity algorithm unchanged. Model identity/key fields are locally rejected; collision and stable identity regressions pass. |
| 3 | Artifact URLs are null or absolute HTTP(S), reject unsafe schemes, relative/malformed URLs, credentials, whitespace/backslashes; OpenAI URLs must match actual run search evidence under the existing URL normalizer. Renderer still escapes attributes. |
| 4 | More than 16 charts rejected before resolver invocation; raw bytes counted on each lazy resolve and stop at first overflow. No eager resolver materialization or defensive whole-buffer copy. |
| 5 | All ten frozen ceilings enforced; exact values/boundaries below. |
| 6 | Stream reader counts actual chunks, bounds at 4 MiB, aborts/cancels overflow, then uses fatal UTF-8 decoding and envelope JSON parsing. response.json() is not used. |
| 7 | Duplicate decoded keys, JSON grammar and structural ceilings checked before decoding full output; exact recursive local schema, semantic validity, research and chart provenance checked before mapped result is accepted. |
| 8 | One provider attempt per started run; no automatic provider retry, including timeout/network failures. Browser session-refresh retries preserve run identity. |
| 9 | Browser crypto.randomUUID; stable sorted JSON SHA-256 over normalized substantive inputs excludes runId/session material. |
| 10 | Same ID/hash returns/resumes the durable run; changed substance conflicts; terminal success/no-candidates/preflight/failed/abandoned replay without provider or publication. |
| 11 | Durable sourceDate claims reject a second active owner. Store-wide in-process execution sharing covers multiple runner instances. Startup rejects conflicting durable date ownership. |
| 12 | Explicit absolute EXECUTIONOS_SOD_RUN_STORE root; no memory fallback. Local writer ownership, immutable sequenced SHA-chained journal, bounded verified artifact reads, file/directory fsync, fail-closed corruption/ownership handling. |
| 13 | Required CLAIMED, PROVIDER_REQUEST_STARTED, PROVIDER_RESULT_DURABLE, PRETRADE_SNAPSHOT_ACQUIRED, PREPARED, PUBLICATION_INTENT_RECORDED, PUBLICATION_COMMITTED, SUCCESS, NO_CANDIDATES, PRETRADE_PREFLIGHT_REQUIRED, FAILED, RECOVERY_REQUIRED, ABANDONED stages. Ambiguous reason is PROVIDER_OUTCOME_AMBIGUOUS. Transition whitelist rejects impossible transitions. |
| 14 | Exact normalized provider content with allowlisted metadata stored as immutable SHA-256-addressed artifact before PRETRADE/export. Hash checked on load and recovery. No raw Responses envelope is persisted. |
| 15 | Restart at provider-start or an uncertain transport failure produces RECOVERY_REQUIRED / PROVIDER_OUTCOME_AMBIGUOUS. It retains the date claim until explicit eligible abandonment; a later attempt requires a new runId. |
| 16 | PRETRADE is acquired after provider-result durability, never before latency as downstream authority. |
| 17 | Fingerprint includes all available fields on all versions of the relevant candidate IDs, including version/hash/lifecycle/revision/current/superseded relationships. Final reread occurs after temp-file fsync and intent, immediately before atomic publication; mutations trigger downstream recomputation from durable result, bounded to three preparations. |
| 18 | Recovery reacquires PRETRADE before authority-sensitive work; stored fingerprints are provenance only. A previously durable publication commit can finish terminal response recording without fresh admission work. |
| 19 | Run-derived publicationId/bundleId/finalName, bytes/hash/length and hashed target identity are journaled before visibility; exact existing file reconciles, absent file reuses intent, conflicting bytes or incompatible recomputed intent fail closed. Same-directory hard-link creation supplies atomic no-clobber visibility for intent mode; existing default rename mode remains. Commit records exact identity/hash/length. |
| 20 | Existing exact loopback-origin/session boundary protects generate/resume, GET /api/sod/runs/:runId, and POST /api/sod/runs/:runId/abandon. No broad filesystem or lifecycle endpoint. |
| 21 | Allowlisted IDs/timestamps/model/provider/version/chart descriptors and hashes, result hash, preparation fingerprint, publication identity, terminal state and sanitized code only. No server key, session token, authorization header or raw upstream error body in durable records. |
| 22 | providerLoaded, providerConfigured, modelConfigured, liveAcceptanceValidated are distinct. Health makes no provider or PRETRADE request; no fallback model. Acceptance evidence is bound to provider/version/model/validation version. |
| 23 | Explicit opt-in production-path live acceptance harness implemented; requires authorized raster, actual Responses image/search/schema/local parse, durable result and fresh PRETRADE. Unexpected candidates are rejected before any publication. Real gate BLOCKED; no credentialed call made. |
| 24 | Deterministic safe SOD codes distinguish configuration, upstream auth/access/rate/errors, network/timeout, resource/schema/research/URL failure, claims, ambiguity, stale PRETRADE and publication conflicts. Browser messages do not include raw errors/paths. |
| 25 | UI shows readiness and run ID/stage/reason, restores saved pending intent, and exposes check/resume/eligible abandon. Request/UUID saved before delivery; older asynchronous status responses cannot overwrite a newer completed operation. Server claims remain sole concurrency authority. |
| 26 | Narrow single-host local journal only; no scheduler, distributed lock service, generalized workflow/retry engine, second provider or cloud authority. |
| 27 | Candidate identity/hash authority, manual ingestion runtime, PRETRADE/ARM/Execution runtime, broker adapters and analytics remain closed. Only legacy regression fixtures were corrected to accepted input policy/contracts/test clock. The inherited canonical runtime defect was not changed. |

### Five blocker dispositions (item 8)

| Frozen blocker | Disposition |
|---|---|
| Unsafe artifact URLs | Implemented and offline adversarial coverage passes; unsafe and unobserved links fail closed. |
| Late/incomplete chart/request limits | Implemented and offline coverage passes; count before resolution, incremental aggregate limit, serialized request bound before network. |
| Incomplete/unbounded local validation | Implemented and offline coverage passes; bounded stream, output limit, duplicate/structure/schema/semantic/evidence boundaries. |
| Missing durable run/recovery identity | Implemented and offline crash/replay/concurrency coverage passes, including actual dead-process writer reclamation and production-fetch simulation through publication/replay. |
| Stale PRETRADE across provider/publication | Implemented and offline freshness/fence/recovery/churn coverage passes. The separate inherited PRETRADE regression failure prevents overall closeout. |

These are implementation dispositions, not accepted blocker closure. Full slice acceptance still requires T and V.

### Enforced ceilings (item 9)

| Boundary | Ceiling | Enforcement |
|---|---:|---|
| Chart count | 16 | Request normalization and direct OpenAI adapter before resolver calls |
| Aggregate raw charts | 32 MiB | Each authorized lazy resolve; fail at first excess chart |
| Serialized request | 48 MiB | Full JSON/image expansion counted before fetch |
| Raw HTTP response | 4 MiB | Actual chunks; Content-Length is only an optional early rejection |
| Structured output_text | 768 KiB | Before trim/parse, cumulative across text segments |
| JSON nesting depth | 48 | Raw parser, root depth zero |
| JSON structural nodes | 25,000 | Raw parser value nodes |
| Object keys | 500 | Per object, decoded duplicate key check |
| Array items | 5,000 | Per array |
| One decoded string | 64 KiB UTF-8 | Keys and values after escape decoding |

The raw parser also rejects non-finite numeric decoding and bounds numeric token size to 64 KiB. Existing chart per-file limits remain. The local store additionally caps each artifact/read at 8 MiB; that storage guard does not replace provider ceilings.

### Trust, recovery and operational details (items 10–22)

The strict pipeline is bounded HTTP bytes → envelope parsing → bounded output_text → duplicate-aware grammar and structural validation → full JSON decode → exact SOD_OPENAI_TRANSPORT_SCHEMA → semantic, source and chart-provenance validation → canonical mapping/normalization. The local validator implements every keyword used by the current schema and rejects unknown schema keywords; the upstream schema request is defense in depth. Source matching retains the existing canonicalization of case/fragment/tracking parameters/trailing slash and does not introduce a domain-only trust shortcut.

Run storage must be explicitly configured to a writable durable local directory. The store pins resolved ancestors (including macOS /var and /tmp aliases), rejects a symlink root/unsafe owned directories, uses a single local process writer, and fails closed if the writer is live or cannot be established as dead. PID reuse is conservative: it can block reclamation, never authorize a second writer. A process crash while holding the small reclamation guard can require operator filesystem inspection; no automatic lock stealing is implemented. One real subprocess test exits with a provider-start journal and verifies reclamation plus ambiguous-outcome state at restart.

Provider artifacts contain normalized analysis content with sanitized generation metadata. They suffice to rerun downstream preparation without OpenAI. Publication is pinned to the original immutable intent; if fresh authority would change already-intended bytes, the run fails closed instead of silently changing the filename/hash. Three consecutive preparation-fence mismatches fail with SOD_PRETRADE_CHANGED_DURING_PREPARATION; the provider result remains durable. No-candidate and preflight results also reread PRETRADE before becoming terminal. A PRETRADE read failure after provider durability is a sanitized terminal failure unless a publication intent/commit must remain recoverable; it never causes an automatic provider recall.

Publication intent uses a hash of the configured absolute inbox path as target identity, avoiding raw filesystem paths in the journal. The durable final file is checked as a regular no-follow file with exact byte length and hash. Same-directory atomic link visibility avoids an overwrite race; legacy callers still use the original rename boundary. Terminal responses include safe final filename/hash evidence, not the configured inbox path.

Provider/model configuration is inspectable even when missing, but side-effecting operation cannot start without required durable storage. Ordinary successful generation cannot set liveAcceptanceValidated: only the explicit acceptance operation writes matching durable acceptance evidence. The tests use temporary mocked evidence solely to validate this mechanism and delete it afterward. The actual session has no live evidence.

Browser controls save the operator's normalized request intent and UUID locally for recovery convenience. They neither grant lifecycle authority nor replace durable server claims. The hook ignores obsolete completion/status responses, restores status on mounting, and does not clear a run error merely because health polling succeeds. Dedicated client/session and existing UI-boundary tests pass; no new real-browser interaction test for the SOD controls was added. Existing V2.4 Chromium lifecycle/router regressions passed.

## Validation and failures (items 23–32)

New tests: provider hardening (41), durable run integrity (31), opt-in/configuration/controlled live-harness guards (2), plus additional API/readiness/replay/abandonment and client run-identity assertions. Shared OpenAI fixture extraction preserves the original test assertions. Production fetch fixtures now use a real Response stream. Existing renderer/export/lineage/candidate identity tests were retained.

Eleven legacy downstream test fixtures were corrected: ten missing the already-required ingress policy were supplied with AUTOMATED_UNTOUCHED_ONLY for automated SOD or MANUAL_AUTHORIZED for AD_HOC ingress; the lifecycle API fixture was supplied with required managementContract and stripped of prohibited input runtime-authority fields; the candidate API lifecycle clock was pinned to its existing fixture date. No existing behavioral assertion was deleted or weakened. These corrections expose the actual runtime regression rather than stopping at obsolete fixture rejection.

Dependencies were installed with `npm ci --no-audit --no-fund` (136 pinned packages); package-lock.json did not change. Counts below include overlap among suites and must not be summed as distinct tests. Every final required focused/package command and its result is listed.

| Exact command | Result | Local log |
|---|---|---|
| `node --test tests/sod-analysis-provider.test.mjs` | PASS — 5/5, 0 failed | [01.log](/tmp/sod-validation/final/01.log) |
| `node --test tests/sod-openai-analysis-provider.test.mjs` | PASS — 12/12, 0 failed | [02.log](/tmp/sod-validation/final/02.log) |
| `node --test tests/sod-openai-production-provider.test.mjs` | PASS — 5/5, 0 failed | [03.log](/tmp/sod-validation/final/03.log) |
| `node --test tests/sod-artifact-renderer.test.mjs` | PASS — 8/8, 0 failed | [04.log](/tmp/sod-validation/final/04.log) |
| `node --test tests/sod-orchestration-api.test.mjs` | PASS — 7/7, 0 failed | [05.log](/tmp/sod-validation/final/05.log) |
| `node --test tests/sod-orchestration-api-safety.test.mjs` | PASS — 2/2, 0 failed | [06.log](/tmp/sod-validation/final/06.log) |
| `node --test tests/sod-orchestration-core.test.mjs` | PASS — 3/3, 0 failed | [07.log](/tmp/sod-validation/final/07.log) |
| `node --test tests/sod-chart-store.test.mjs` | PASS — 5/5, 0 failed | [08.log](/tmp/sod-validation/final/08.log) |
| `node --test tests/sod-candidate-export.test.mjs` | PASS — 13/13, 0 failed | [09.log](/tmp/sod-validation/final/09.log) |
| `node --test tests/sod-candidate-lineage.test.mjs` | PASS — 11/11, 0 failed | [10.log](/tmp/sod-validation/final/10.log) |
| `node --test tests/sod-candidate-publisher.test.mjs` | PASS — 3/3, 0 failed | [11.log](/tmp/sod-validation/final/11.log) |
| `node --test tests/sod-provider-hardening.test.mjs` | PASS — 41/41, 0 failed | [12.log](/tmp/sod-validation/final/12.log) |
| `node --test tests/sod-run-integrity.test.mjs` | PASS — 31/31, 0 failed | [13.log](/tmp/sod-validation/final/13.log) |
| `node --test tests/sod-live-acceptance.test.mjs` | PASS — 2/2, 0 failed | [14.log](/tmp/sod-validation/final/14.log) |
| `npm run v24:sod-orchestrator-test` | PASS — 153/153, 0 failed | [15.log](/tmp/sod-validation/final/15.log) |
| `npm run v24:sod-export-test` | PASS — 13/13, 0 failed | [16.log](/tmp/sod-validation/final/16.log) |
| `npm run v24:candidate-feed-test` | PASS — 49/49, 0 failed | [candidate-feed-final.log](/tmp/sod-validation/candidate-feed-final.log) |
| `npm run v24:manual-ingestion-test` | PASS — 69/69, 0 failed | [manual-final.log](/tmp/sod-validation/manual-final.log) |
| `npm run v24:execution-ownership-test` | PASS — 25/25, 0 failed | [19.log](/tmp/sod-validation/final/19.log) |
| `npm run v24:market-data-test` | PASS — 11/11, 0 failed | [20.log](/tmp/sod-validation/final/20.log) |
| `npm run v24:dss-test` | PASS — 91/91, 0 failed | [21.log](/tmp/sod-validation/final/21.log) |
| `npm run v24:risk-sizing-test` | PASS — 170/170, 0 failed | [22.log](/tmp/sod-validation/final/22.log) |
| `npm run v24:handoff-test` | PASS — 34/34, 0 failed | [23.log](/tmp/sod-validation/final/23.log) |
| `npm run v24:handoff-api-test` | PASS — 7/7, 0 failed | [24.log](/tmp/sod-validation/final/24.log) |
| `npm run v24:broker-provenance-test` | PASS — 24/24, 0 failed | [25.log](/tmp/sod-validation/final/25.log) |
| `npm run v24:handoff-admission-test` | PASS — 16/16, 0 failed | [26.log](/tmp/sod-validation/final/26.log) |
| `npm run v24:v23-compat-test` | PASS — 13/13, 0 failed | [27.log](/tmp/sod-validation/final/27.log) |
| `npm run v24:v23-install-test` | PASS — 16/16, 0 failed | [28.log](/tmp/sod-validation/final/28.log) |
| `npm run v24:fill-ownership-test` | PASS — 24/24, 0 failed | [29.log](/tmp/sod-validation/final/29.log) |
| `npm run v24:retirement-test` | PASS — 17/17, 0 failed | [30.log](/tmp/sod-validation/final/30.log) |
| `npm run v24:activation-test` | PASS — 21/21, 0 failed | [31.log](/tmp/sod-validation/final/31.log) |
| `npm run v24:live-lifecycle-test` | PASS — 15/15, 0 failed | [32.log](/tmp/sod-validation/final/32.log) |
| `npm run v24:store-authority-test` | PASS — 23/23, 0 failed | [33.log](/tmp/sod-validation/final/33.log) |
| `npm run v24:runtime-router-test` | PASS — 46/46, 0 failed | [34.log](/tmp/sod-validation/final/34.log) |
| `npm run v24:router-hardening-test` | PASS — 1/1, 0 failed | [35.log](/tmp/sod-validation/final/35.log) |
| `npm run v24:full-lifecycle-e2e-test` | PASS — 1/1, 0 failed | [36.log](/tmp/sod-validation/final/36.log) |
| `node --test tests/execution-v24-live-management.test.mjs tests/execution-v24-slice7.test.mjs tests/execution-v24-slice7-final.test.mjs tests/execution-v24-retired-assignment.test.mjs tests/execution-v24-legacy-management-compat.test.mjs` | PASS — 26/26, 0 failed | [37.log](/tmp/sod-validation/final/37.log) |
| `node --test tests/execution-v24-pretrade-full-e2e.test.mjs` | PASS — 1/1, 0 failed | [38.log](/tmp/sod-validation/final/38.log) |
| `npm run analytics:test` | FAIL — 1001/1018, 17 failed | [full-final.log](/tmp/sod-validation/full-final.log) |
| `npm run build` | PASS — Vite production build, 1,624 modules transformed | [40.log](/tmp/sod-validation/final/40.log) |
| `npm run v24:router-browser-test` | PASS — 15/15, 0 failed | [browser-escalated.log](/tmp/sod-validation/browser-escalated.log) |

The existing broad command is named analytics:test but runs all tests/*.test.mjs, including V2.4. It was used only as regression validation; no analytics implementation or research report was run.

Final focused follow-ups: `node --test tests/sod-run-integrity.test.mjs tests/sod-live-acceptance.test.mjs tests/sod-orchestration-client.test.mjs` passed 39/39; `node --test tests/pretrade-candidate-api.test.mjs` passed 3/3 after the fixed-clock correction. `node --test tests/sod-run-integrity.test.mjs tests/sod-orchestration-api.test.mjs` passed 36/36 at the earlier 29-run-test checkpoint. `node --test tests/sod-openai-analysis-provider.test.mjs tests/sod-provider-hardening.test.mjs tests/sod-run-integrity.test.mjs` passed 81/81 at the earlier 28-run-test checkpoint. The final package run includes all later added cases.

### Failure history and disposition

- Initial focused SOD passes included 25/25. During construction, run-store validation initially rejected macOS /var temporary-root aliases; ancestor canonicalization fixed this while retaining symlink-root rejection.
- API tests initially expected the old PRETRADE read count/status; they were updated to assert the now-required post-provider and immediate prepublication reads. One intermediate combined run was 44/45 before that correction; the final API suites pass.
- Early run-integrity testing was 23/25: test cleanup closed a store after deleting its root, and the concurrency test checked a counter before the queued writer began. Cleanup ordering and an explicit event-loop boundary corrected those fixture issues. Subsequent combined run tests passed 31/31, then later 30/30, 41/41, 67/67 and the final counts above as coverage expanded.
- Initial broad Node regression: 1,014 tests, 957 passed, 57 failed because older ingress fixtures lacked accepted mandatory policy/contract fields. After policy fixes a targeted 57-test set was 32 passed/25 failed; after correcting lifecycle inputs it was 40 passed/17 failed. No runtime authority restriction was relaxed.
- Initial build and browser commands exited 127 because Vite/Playwright dependencies were absent. npm ci fixed dependency availability. The normal sandbox browser retry failed all 15 browser launches with the macOS Chromium MachPort permission error. Running the same browser command with approved elevated sandbox permission passed 15/15. This was an environment launch failure, not a passing test substituted for a failing assertion. No automatic approval rejection occurred.
- During the final run, real time passed the fixed candidate API fixture's validity window, yielding three additional HTTP 500 assertions in feeder/manual/full suites (46/49, 66/69, and 998/1,018). Pinning that fixture's lifecycle clock fixed the nondeterminism. Final feeder is 49/49, manual is 69/69, full is 1,001/1,018 with the same 17 runtime failures below.
- One diagnostic archive script used a tarfile option unavailable in the local Python version; removing that option for the trusted local Git archive allowed the baseline control to run. It made no repository changes.
- Vite build passes. Chromium emits only the existing NO_COLOR/FORCE_COLOR environment warning in its successful run.

### Remaining PRETRADE failures: gate T is FAIL

The accepted canonical hash treats unknown optional candidate fields as contract substance. Existing server transitions add runtime fields such as triggerRuntime and terminalOutcome (with additional retirement/deactivation/trigger-expiration fields implicated), so subsequent integrity checks detect changed canonical content. Trigger activation/satisfaction/persistence, terminal decline/expiry, and blocked-handoff retirement fail. Some HTTP tests observe resulting 500 responses; direct tests report CANDIDATE_CONTRACT_INTEGRITY_ERROR.

To establish attribution, accepted HEAD was exported with git archive into a temporary directory; only the ten test-fixture corrections then present were copied into it. Its PRETRADE/runtime source was byte-for-byte the accepted HEAD, with no provider changes. The targeted set reproduced exactly 40 passing/17 failing tests. This was a disposable archive, not another worktree and not a Git history mutation. The diagnostic metadata and logs are `/tmp/sod-validation/accepted-runtime-control.json` and `/tmp/sod-validation/accepted-runtime-control.log`.

No candidate-contract hash boundary, PRETRADE transition, ARM or Execution runtime was changed to suppress these failures. The canonical PRETRADE-to-Execution end-to-end test does pass, but that does not satisfy the broader regression gate.

Exact remaining failures:

| Test location | Failing test |
|---|---|
| [tests/pretrade-blocked-handoff-retirement.test.mjs:162:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-blocked-handoff-retirement.test.mjs:162) | terminal BLOCKED handoff retires stale ARMED authority before same-symbol ARM gate |
| [tests/pretrade-lifecycle-api.test.mjs:240:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-lifecycle-api.test.mjs:240) | HTTP decline is terminal and same candidate version cannot be resurrected |
| [tests/pretrade-trigger-api.test.mjs:95:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-api.test.mjs:95) | HTTP trigger evidence separates relevance from satisfaction and reaches permission only on matching completed bar |
| [tests/pretrade-trigger-api.test.mjs:132:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-api.test.mjs:132) | HTTP manual trigger confirmation advances only after explicit operator activation |
| [tests/pretrade-trigger-api.test.mjs:169:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-api.test.mjs:169) | HTTP trigger route switches to persistence monitor after satisfaction |
| [tests/pretrade-trigger-engine.test.mjs:86:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs:86) | relevance is evaluated separately from satisfaction and auto-activates only when relevant |
| [tests/pretrade-trigger-engine.test.mjs:115:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs:115) | wrong observation type cannot satisfy and completed matching bar advances to permission |
| [tests/pretrade-trigger-engine.test.mjs:145:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs:145) | identical evidence retry after lifecycle transition is idempotent |
| [tests/pretrade-trigger-engine.test.mjs:162:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs:162) | stale or conflicting evidence fails closed without mutating durable progress |
| [tests/pretrade-trigger-engine.test.mjs:180:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs:180) | pure manual trigger requires operator activation and exact manual node confirmation |
| [tests/pretrade-trigger-engine.test.mjs:227:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs:227) | durable trigger progress survives restart and recovery forward-completes a missed activation |
| [tests/pretrade-trigger-persistence.test.mjs:73:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-persistence.test.mjs:73) | CONDITION_HELD quote satisfaction remains valid while condition holds and returns to trigger evaluation when it fails |
| [tests/pretrade-trigger-persistence.test.mjs:119:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-persistence.test.mjs:119) | BAR_BOUND satisfaction expires on the next completed bar of the same timeframe, not on stale or wrong-timeframe evidence |
| [tests/pretrade-trigger-persistence.test.mjs:193:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-persistence.test.mjs:193) | ONE_SHOT manual satisfaction is not invalidated by later market evidence |
| [tests/pretrade-trigger-persistence.test.mjs:214:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-persistence.test.mjs:214) | persistence expiration operation is idempotent after lifecycle has returned to trigger evaluation |
| [tests/pretrade-validity-lifecycle.test.mjs:104:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-validity-lifecycle.test.mjs:104) | validity reconciliation expires active unarmed candidate durably and idempotently at validUntil |
| [tests/pretrade-validity-lifecycle.test.mjs:126:1](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-validity-lifecycle.test.mjs:126) | reconcileAllValidity leaves future candidates WAITING and expires only due canonical candidates |

### Live OpenAI acceptance: gate V is BLOCKED

**No real credentialed OpenAI request was made.** Offline full regression is not green, so the required ordering prohibits that request. A configuration-only check additionally confirmed that all of the following are missing: OPENAI_API_KEY, EXECUTIONOS_SOD_OPENAI_MODEL, EXECUTIONOS_SOD_RUN_STORE, EXECUTIONOS_SOD_CHART_STORE, EXECUTIONOS_CANDIDATE_INBOX, EXECUTIONOS_SOD_ACCEPTANCE_CHART. Opt-in is false. EXECUTIONOS_PRETRADE_URL was also absent; the harness supports the existing loopback default but a reachable authoritative PRETRADE service is still required.

After all offline gates pass, configure those values through the documented local environment without putting credentials in source or chat. Use a non-sensitive authorized PNG/JPEG/WebP chart and the intended explicit model. The harness must own the configured run store exclusively; another running SOD service cannot simultaneously own it. Then the exact opt-in command is:

```sh
EXECUTIONOS_SOD_LIVE_ACCEPTANCE=1 npm run v24:sod-live-acceptance
```

This command has been added but was not run against a real provider in this session. It prechecks PRETRADE connectivity, ingests the authorized raster through the existing chart store, and executes the real production provider/runner path. The controlled prompt asks for zero candidates; a checkpoint rejects unexpected candidates before downstream publication. Successful NO_CANDIDATES completion proves production transport/image/search/local validation/durable result/fresh PRETRADE behavior and writes sanitized acceptance evidence. Publication crash/fence cases are covered offline. Evidence includes run ID, requested/resolved model, completion status, safe response/request IDs, search/source/chart counts, local-validation flag, provider-result hash and terminal stage; no key or bearer token.

The current implementation is compatible with the documented Responses structured-output and web-search interfaces as inspected during implementation, but only V can prove compatibility with the actual configured model. Official references: [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [Web search](https://developers.openai.com/api/docs/guides/tools-web-search).

### Acceptance matrix A–V (item 31)

| Gate | Status | Evidence |
|---|---|---|
| A — Identity unchanged | PASS | Original OpenAI 12/12, candidate export 13/13; model identity rejection and collision coverage |
| B — Artifact URL safety | PASS | Hardening unsafe schemes/relative/arbitrary web URLs; renderer 8/8 |
| C — Chart limits | PASS | Zero resolutions at 17; exactly 16/32 MiB accepted; incremental stop on overflow |
| D — Resource ceilings | PASS | Hardening 41/41, bounded production stream and all frozen ceilings |
| E — Duplicate-aware parsing | PASS | Decoded duplicate keys at root/nested/array objects rejected |
| F — Exact local schema | PASS | Required/additional/type/nested/enum/bounds checks plus semantic/provenance validation |
| G — Run identity/hash/replay | PASS | Durable run 31/31; same/different hash, concurrency and terminal replay |
| H — sourceDate single-flight | PASS | Durable claims, same-store runner sharing, startup split-brain rejection |
| I — Durable result/hash | PASS | Before PRETRADE, content-addressed replay and tamper rejection |
| J — Ambiguity/abandonment | PASS | Start crash/network uncertainty; subprocess restart; explicit eligible abandonment |
| K — Fresh post-provider PRETRADE | PASS | Sequencing/mutation tests and production transport-through-runner simulation |
| L — Prepublication fence | PASS | Mutations during preparation and filesystem preparation; bounded churn; no provider recall |
| M — Recovery freshness | PASS | Restart reads fresh authority and rejects obsolete prepared authority |
| N — Publication crash windows | PASS | Before/after intent, file-before-commit, commit-before-terminal, conflicts |
| O — Lost response/reconciliation | PASS | Exact terminal replay, one provider and one immutable publication after restart |
| P — Readiness | PASS | No-network missing key/model; ordinary generation cannot assert live evidence; matching evidence mechanism tested offline |
| Q — Sanitized errors | PASS | Provider/API/durable tests reject raw secret/path/header disclosure |
| R — Existing SOD regression | PASS | v24:sod-orchestrator-test 153/153; export 13/13 |
| S — Manual ingestion | PASS | v24:manual-ingestion-test 69/69; feeder 49/49 after deterministic fixture correction |
| T — PRETRADE/downstream | FAIL | Full Node 1,001/1,018; 17 runtime failures reproduced against accepted runtime |
| U — Build | PASS | npm run build; 1,624 modules |
| V — Credentialed OpenAI | BLOCKED | Offline T fails; key/model/durable root/chart/inbox/authorized raster config unavailable; no real call |

### Adversarial self-review (item 32)

The review exercised all 17 requested falsification areas. Unsafe links fail before rendering; chart/resource checks fail at the intended trust boundaries; duplicate/schema validation is local; one provider attempt is preserved across same-run concurrency, crash and replay. Result hashes, event hashes and stage transitions reject tampering. Fresh PRETRADE is reacquired after provider work and on recovery; the final fence was moved inside the publisher after durable temp-file preparation to catch changes during filesystem preparation. Stale publication never causes a provider recall. Intent reconciliation preserves exact identity and rejects conflicting bytes. Actual dead writer recovery and injected crash windows pass.

Substantive findings fixed during review: final-fence placement, shared execution ownership across multiple runner instances, canonical semantic compatibility before durability, safe HTTP-error body cancellation, browser stale-status ordering, and live-harness rejection of unexpected candidates before publication. No automatic retry, model identity authority, broker write, analytics feature, or downstream runtime mutation was introduced.

The review did not establish live model compatibility, independent acceptance, or a passing full PRETRADE regression. Those remain explicit blockers. Tests use controlled crash injection and one actual dead-process journal scenario; they do not claim exhaustive operating-system power-loss verification. Local PID ambiguity/reclamation uncertainty remains fail-closed operator action, as designed.

## Final repository review and remaining work (items 33–41)

- git diff --check: PASS, no whitespace errors.
- Full tracked diff and new modules/tests were inspected. Changed files were checked for accidental real secrets/generated credentials/private artifacts; test-only fake keys are intentional assertions. No credentials, raw real-provider output or private EOD data were added.
- Frozen design baseline and handoff untouched; documentation status/index, roadmap, README and USER-GUIDE untouched by this implementation.
- Candidate identity was not redesigned; canonical hash/runtime authority was not changed.
- No automatic provider retry was added.
- No Performance Intelligence/Analytics & Reporting implementation, schema, dashboard, EOD reporter change, future branch, or analytics research run was performed.
- No broker-write authority, Schwab/NinjaTrader execution expansion or deferred Governor/portfolio/cloud work was added.
- No commit, merge, push, PR, rebase, reset, amend or history rewrite occurred; no other worktree was modified.
- Build dependencies/output are ignored. Generated Playwright results were moved to /tmp/sod-validation/browser-generated-results so they are not in the implementation diff. Validation logs are local temporary diagnostics, not part of the proposed checkpoint.
- The handoff does not explicitly permit a final checkpoint before V passes. With T failing and V blocked, the implementation is left uncommitted.

Required next steps before acceptance/checkpoint: resolve the inherited canonical-runtime hash defect under explicit scope authority while preserving immutable candidate substance; rerun affected and full regressions/build; supply production configuration securely and complete the controlled live gate; then inspect the actual final diff and create the single authorized local checkpoint only once A–V pass. Independent review and user acceptance remain subsequent workflow steps.

Final git status is recorded below; all changes are unstaged and HEAD remains unchanged.

```text
 M package.json
 M schwab-bridge/sod-analysis-provider.mjs
 M schwab-bridge/sod-artifact-content.mjs
 M schwab-bridge/sod-artifact-renderer.mjs
 M schwab-bridge/sod-candidate-publisher.mjs
 M schwab-bridge/sod-chart-store.mjs
 M schwab-bridge/sod-openai-analysis-provider.mjs
 M schwab-bridge/sod-openai-production-provider.mjs
 M schwab-bridge/sod-orchestration-api.mjs
 M schwab-bridge/sod-orchestration-core.mjs
 M src/components/SodWorkspace.jsx
 M src/hooks/useSodOrchestration.js
 M src/sod/sod-orchestration-api-client.js
 M tests/execution-v24-pretrade-full-e2e.test.mjs
 M tests/pretrade-arm-lifecycle-authority.test.mjs
 M tests/pretrade-arm-service.test.mjs
 M tests/pretrade-blocked-handoff-retirement.test.mjs
 M tests/pretrade-candidate-api.test.mjs
 M tests/pretrade-lifecycle-api.test.mjs
 M tests/pretrade-permission-pipeline.test.mjs
 M tests/pretrade-trigger-api.test.mjs
 M tests/pretrade-trigger-engine.test.mjs
 M tests/pretrade-trigger-persistence.test.mjs
 M tests/pretrade-validity-lifecycle.test.mjs
 M tests/sod-openai-analysis-provider.test.mjs
 M tests/sod-openai-production-provider.test.mjs
 M tests/sod-orchestration-api-safety.test.mjs
 M tests/sod-orchestration-api.test.mjs
 M tests/sod-orchestration-client.test.mjs
?? docs/ExecutionOS_V2.4_Production_SOD_Provider_Implementation_Status_2026-09-12.md
?? schwab-bridge/sod-live-acceptance.mjs
?? schwab-bridge/sod-production-run.mjs
?? schwab-bridge/sod-provider-validation.mjs
?? schwab-bridge/sod-run-store.mjs
?? tests/helpers/sod-openai-fixture.mjs
?? tests/sod-live-acceptance.test.mjs
?? tests/sod-provider-hardening.test.mjs
?? tests/sod-run-integrity.test.mjs
```
