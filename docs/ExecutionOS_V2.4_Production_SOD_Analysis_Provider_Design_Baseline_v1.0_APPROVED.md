# ExecutionOS V2.4 — Production SOD Analysis Provider Hardening & Run Integrity Design Baseline v1.0

**Status:** APPROVED / FROZEN FOR IMPLEMENTATION<br>
**Approval date:** 2026-09-12<br>
**Repository:** `sibolek/structure-based-trade-management`<br>
**Implementation branch:** `v24-sod-production-analysis-provider`<br>
**Accepted predecessor:** `e2357933147600e702c5e252020b257debbe3392`<br>
**Accepted prior SOD architectural checkpoint:** `4144c5c59494ae318bb736d64fba751a22046512`<br>
**Implementation status:** PENDING<br>
**Live OpenAI acceptance:** PENDING

---

## 1. Purpose

This document is the frozen design authority for **ExecutionOS V2.4 — Production SOD Analysis Provider Hardening & Run Integrity**.

This is **not** a greenfield provider design. The repository already contains a substantial OpenAI Responses analysis provider, production HTTP transport, provider-module wiring, browser initiation, structured SOD schema, deterministic rendering, candidate export, lineage, publication, Candidate Feeder integration, and tests.

This slice preserves that architecture. It hardens only the production trust, resource, run-integrity, authority-freshness, readiness, and acceptance boundaries defined here. Existing good implementation is to be extended narrowly rather than replaced.

The slice remains upstream of PRETRADE and introduces no broker-write authority.

---

## 2. Authority and precedence

This baseline is subordinate to the accepted ExecutionOS V2.4 PRETRADE → ARM → Execution architecture and builds on the accepted SOD provider/rendering checkpoint at `4144c5c59494ae318bb736d64fba751a22046512`.

It governs the production-provider hardening slice beginning at `e2357933147600e702c5e252020b257debbe3392`. It does not rewrite prior frozen records to simulate later project state.

Where this baseline adds stricter provider trust, resource, recovery, or freshness requirements, those requirements govern this implementation slice. It does not transfer candidate, lifecycle, ARM, execution, filesystem, or broker authority upstream.

---

## 3. Governing invariants

The following invariants are frozen:

1. The external model analyzes authorized evidence and proposes trade substance.
2. The external model does not author `candidateId` or `candidateKey`.
3. The trusted local provider adapter may deterministically establish stable candidate proposal identity under the already accepted SOD provider contract.
4. Candidate identity is not contract-version authority.
5. Candidate identity is not lineage authority.
6. Candidate identity is not PRETRADE lifecycle authority.
7. Candidate identity is not ARM authority.
8. Candidate identity is not execution authority.
9. Candidate identity assignment is not reopened by this slice.
10. `contractVersion` remains downstream canonical export/lineage authority.
11. PRETRADE remains authoritative for candidate admission, lifecycle, supersession eligibility, permission, review, ARM, and handoff eligibility.
12. Candidate Feeder remains transport only.
13. The provider cannot establish `contractVersion`, lineage, lifecycle state, `stateRevision`, permission, DSS authority, risk authority, selected quantity, ARM authorization, handoff, execution state, or broker authority.
14. Provider/model output cannot choose local filesystem destinations.
15. Local chart filesystem paths never cross the external provider boundary.
16. The renderer remains sole authority for deterministic Markdown, HTML, dashboard layout, CSS, and canonical A+ / Morning Priority rendering.
17. Broker-write authority remains false.
18. This slice adds no broker order placement, replacement, cancellation, modification, reduction, or flattening.

---

# Part I — Approved architectural decisions

## Decision 1 — Reuse the existing Responses architecture

**APPROVED / FROZEN.**

Retain the existing OpenAI Responses architecture. Harden the existing implementation rather than replacing it.

The following modules remain the starting architecture and may receive only changes narrowly required by this baseline:

- `schwab-bridge/sod-openai-analysis-provider.mjs`
- `schwab-bridge/sod-openai-production-provider.mjs`
- `schwab-bridge/sod-openai-provider-module.mjs`

Do not migrate to Chat Completions. Do not add a second provider architecture, orchestration path, or candidate-ingress path.

## Decision 2 — Candidate identity is not reopened

**APPROVED / FROZEN.**

`candidateId` assignment is not an architecture blocker. The accepted generic provider contract at `4144c5c59494ae318bb736d64fba751a22046512` already requires a stable `candidateId` in provider results.

The external OpenAI model has neither `candidateId` nor `candidateKey` in its transport schema and is explicitly instructed not to author them. The trusted local adapter derives candidate identity deterministically from controlled semantic inputs:

```text
sourceDate + symbol + direction + setupKey
```

Model-authored identity is rejected. Duplicate deterministic IDs fail closed.

No accepted production requirement currently demands two distinct SOD candidates with the exact same `sourceDate`, `symbol`, `direction`, and `setupKey`. If that requirement emerges, it requires a new design decision. Do not refactor candidate identity in this slice for layering aesthetics.

## Decision 3 — Artifact source URL trust

**PRODUCTION BLOCKER.**

Provider-controlled artifact source URLs must never become arbitrary active hyperlinks.

Generic artifact-content validation must require each non-null source URL to be an absolute URL with exactly the `http:` or `https:` scheme. It must reject `javascript:`, `data:`, `file:`, `ftp:`, custom schemes, relative URLs, and malformed URLs.

Invalid URLs fail closed. They are not silently removed, coerced, or rewritten into superficially safe values.

The renderer continues to HTML-escape values and must use safe link attributes such as `rel="noopener noreferrer"`, but escaping is defense in depth and is not the URL security boundary.

For OpenAI-generated `artifactContent.sources` entries, every non-null URL must also correspond, after canonical URL normalization, to an actual source returned by the Responses `web_search` tool for that exact provider run. An unmatched URL fails closed. Existing research-evidence and candidate-provenance checks must not be weakened.

## Decision 4 — Chart resource limits before resolution

**PRODUCTION BLOCKER.**

Preserve opaque trusted chart references. The OpenAI limits are:

- maximum charts: **16**;
- maximum aggregate raw chart bytes: **32 MiB**.

The existing chart-store per-chart limit remains authoritative.

The chart-count limit is checked before resolving all chart bytes. Chart bytes are resolved incrementally, and aggregate raw bytes are accumulated as each chart resolves. The operation fails immediately before accepting bytes that would exceed the aggregate ceiling.

The implementation must not eagerly resolve and copy every authorized chart before provider limits apply. It should avoid redundant full-byte copies where practical. No provider may resolve a chart outside the normalized authorized request.

## Decision 5 — Complete provider request resource boundary

**APPROVED / FROZEN.**

Resource safety covers chart count, raw aggregate chart bytes, serialized provider request bytes, raw HTTP response bytes, structured output bytes, nesting depth, total structural nodes, object-key counts, array lengths, and individual string bytes.

The following fixed ceilings govern v1:

| Resource | Maximum |
|---|---:|
| Charts | 16 |
| Aggregate raw chart bytes | 32 MiB |
| Serialized OpenAI request body | 48 MiB |
| Raw OpenAI HTTP response body | 4 MiB |
| Structured SOD output text | 768 KiB |

The serialized request check must account for base64 expansion and JSON serialization. The 32 MiB raw-image ceiling is not permission to allocate an unbounded request representation.

Structured JSON limits must be no looser than:

| Structure | Maximum |
|---|---:|
| Nesting depth | 48 |
| Total nodes | 25,000 |
| Keys in one object | 500 |
| Items in one array | 5,000 |
| One decoded string | 64 KiB UTF-8 |

The implementation may choose stricter limits without broadening scope. It may reuse the accepted manual-ingestion limits where compatible, but must not weaken or require refactoring of the manual-ingestion parser. A mechanical shared utility extraction is allowed only when behavior remains identical and all manual-ingestion regressions remain green.

A supported OpenAI max-output-token parameter may be added as defense in depth. It never replaces local byte or structural ceilings.

## Decision 6 — Bounded raw HTTP response reading

**PRODUCTION BLOCKER.**

Unbounded `response.json()` is prohibited as the production trust boundary. The Responses HTTP body must be read through a byte-bounded reader.

An oversized body fails closed with a stable sanitized error code. It is not truncated or partially parsed. Raw upstream bodies must not appear in browser-visible errors.

A safe upstream request ID may be retained as sanitized provenance. API keys must never appear in errors, logs, journals, receipts, UI responses, or committed artifacts.

## Decision 7 — Strict local structured-output validation

**PRODUCTION BLOCKER.**

OpenAI `strict: true` JSON-schema behavior is not the local trust boundary.

Structured output must pass this ordered pipeline:

1. enforce the structured-output byte limit;
2. perform duplicate-key-aware raw JSON validation;
3. enforce structural safety limits;
4. decode JSON;
5. enforce the complete local `SOD_OPENAI_TRANSPORT_SCHEMA` exactly;
6. perform semantic, source, and provenance validation;
7. perform canonical mapping.

Local schema enforcement includes required fields, `additionalProperties: false`, types, enums, `minItems`, `maxItems`, numeric requirements, and complete object structure.

Mapping defaults must not convert schema-invalid remote output into valid local data. Malformed-but-parseable output fails before semantic mapping. Duplicate object keys at any nesting level fail closed.

An already-present suitable dependency may be used. Do not introduce a large general validation framework unless necessary for the frozen contract.

## Decision 8 — No automatic provider retries in v1

**APPROVED / FROZEN.**

There are no silent automatic OpenAI generation retries in v1. Provider, network, rate-limit, and timeout failures become explicit durable failure or recovery states.

The operator may intentionally initiate another run. A new provider invocation after an ambiguous prior attempt requires a new `runId`.

The existing one-time browser session-handshake refresh is not a provider retry and may remain.

## Decision 9 — Stable run identity

**PRODUCTION BLOCKER.**

Every intentional Generate or Refresh operation has a stable client-visible `runId`. The browser creates the UUID-quality opaque identifier before invoking generation.

The server derives `requestHash` as SHA-256 over stable canonical JSON for the complete normalized analysis request. `runId` and ephemeral session credentials are excluded from `requestHash`.

The hash covers every normalized input that can affect provider output, including:

- `sourceDate`;
- `generationMode`;
- ordered authorized chart descriptors and `contentRef` values;
- `marketContext`;
- `priorSodRef`;
- every later normalized analysis-input field added under an approved contract.

## Decision 10 — Run replay and conflict semantics

**APPROVED / FROZEN.**

`same runId + same requestHash` resumes or replays the exact durable run. A repeated HTTP request does not by itself start another provider call.

`same runId + different requestHash` is a hard conflict. It fails closed without mutating the existing run.

A terminal exact replay returns the stored terminal status/result without another provider invocation, publication, or Candidate Feeder artifact.

## Decision 11 — Per-sourceDate single-flight

**APPROVED / FROZEN.**

At most one active SOD generation may exist per `sourceDate`. The rule applies across tabs, reloads, clients, INITIAL, REFRESH, and differing request hashes.

A second request while another run for the same `sourceDate` is active must not invoke the provider. It reports the active `runId` and durable state.

After the prior run reaches a terminal state, the operator may explicitly start a new run for that date. `requestHash` governs replay/conflict within one run; `sourceDate` is the single-flight key.

## Decision 12 — Narrow durable SOD run store

**APPROVED / FROZEN.**

Add a narrowly scoped durable SOD run store. It exists only for run identity, one-writer semantics, per-date single-flight, durable transitions, crash recovery, exact replay, provider-result recovery, publication recovery, and sanitized provenance.

The store location is explicit local configuration. Startup fails closed when the required location is absent, inaccessible, or unsafe.

Browser state is not durable authority. The candidate inbox is not the run journal. The run store is not another PRETRADE candidate store.

Prefer immutable or append-only journal evidence and atomic writes over one unprotected mutable JSON file. Established ExecutionOS durable-journal patterns may be reused.

## Decision 13 — Durable run state model

**APPROVED / FROZEN.**

The implementation may refine names, but must preserve these semantic stages and classifications:

| Stage | Classification / recovery meaning |
|---|---|
| `CLAIMED` | Active and resumable; owns the `sourceDate` single-flight claim. |
| `PROVIDER_REQUEST_STARTED` | Active while the request is known in flight; after restart without a durable result, transition to ambiguous recovery rather than retry. |
| `PROVIDER_RESULT_DURABLE` | Resumable without another provider call. |
| `PRETRADE_SNAPSHOT_ACQUIRED` | Resumable historical evidence; freshness must be re-established where required. |
| `PREPARED` | Resumable; lineage/artifacts/intent prepared from recorded fresh authority. |
| `PUBLICATION_INTENT_RECORDED` | Resumable using the same publication identity. |
| `PUBLICATION_COMMITTED` | Resumable to terminal success without republishing. |
| `SUCCESS` | Terminal; READY_TO_PUBLISH work includes committed publication. |
| `NO_CANDIDATES` | Terminal valid non-publication outcome. |
| `PRETRADE_PREFLIGHT_REQUIRED` | Terminal action-required non-publication outcome for this run. |
| `FAILED` | Terminal sanitized failure. |
| `RECOVERY_REQUIRED / PROVIDER_OUTCOME_AMBIGUOUS` | Durable action-required state that retains the claim until explicit eligible abandonment. |
| `ABANDONED` | Terminal; history retained and the `sourceDate` claim released. |

A run is not `SUCCESS` merely because the provider returned or artifacts rendered. For READY_TO_PUBLISH flows, publication commitment is part of success.

## Decision 14 — Durable provider result

**APPROVED / FROZEN.**

A hash alone is insufficient recovery evidence. After a provider response passes all local validation, the exact normalized bounded result required to resume orchestration becomes durable before authority-sensitive downstream work.

The preferred representation is an immutable content-addressed provider-result artifact plus its SHA-256 reference in the run journal.

The artifact contains the normalized artifact content, candidate proposals, and sanitized generation metadata. It excludes API keys, Authorization headers, local filesystem secrets, and unsanitized upstream error bodies.

Once `PROVIDER_RESULT_DURABLE` exists, recovery reuses that exact result and does not invoke OpenAI again.

## Decision 15 — Ambiguous provider outcome

**APPROVED / FROZEN.**

Production Responses uses `store: false`. A crash after `PROVIDER_REQUEST_STARTED` but before `PROVIDER_RESULT_DURABLE` can make the provider outcome unknowable.

Recovery must not retry silently or leave the run permanently active. It records:

```text
RECOVERY_REQUIRED
reason: PROVIDER_OUTCOME_AMBIGUOUS
```

The operator may explicitly abandon an eligible ambiguous run. Abandonment durably records `ABANDONED`, releases the `sourceDate` claim, preserves all prior history, and claims neither provider success nor failure. A subsequent intentional attempt uses a new `runId`.

## Decision 16 — PRETRADE freshness after provider work

**PRODUCTION BLOCKER.**

The snapshot obtained before a potentially long provider call is not authoritative for final lineage or publication. Provider latency can overlap PRETRADE changes.

The authoritative flow is:

```text
validate normalized request
→ claim durable run
→ provider analysis
→ durable provider result
→ fresh authoritative PRETRADE snapshot
→ canonical candidate export
→ lineage
→ deterministic rendering
→ publication intent
```

The post-provider PRETRADE snapshot is used for authority-sensitive lineage. NEW / UNCHANGED / REVISED must not be classified from a snapshot taken before provider latency.

## Decision 17 — Pre-publication PRETRADE authority fence

**PRODUCTION BLOCKER.**

After preparation from the fresh post-provider snapshot, re-read authoritative PRETRADE state immediately before the bundle becomes visible to Candidate Feeder.

Compare the authority-relevant preparation fingerprint to current state. For every candidate that may be published, the fingerprint covers all available relevant values, including:

- `candidateId`;
- `contractVersion`;
- `contentHash`;
- `lifecycleState`;
- `stateRevision`;
- current/superseded identity information required by lineage.

If relevant PRETRADE authority changed, do not publish stale preparation and do not rerun the provider. Retain the durable provider result and recompute or resume preparation from fresh authority.

If safe deterministic recomputation cannot finish in the same request, return a resumable/action-required run state. Continuous authority churn fails closed. No stale authorization may be revived.

## Decision 18 — Recovery uses fresh PRETRADE authority

**APPROVED / FROZEN.**

Every restart or crash recovery from a durable provider result obtains a fresh authoritative PRETRADE snapshot before lineage, classification, publication eligibility, or publication.

Persisted snapshots are historical provenance only. They never become current mutation authority across recovery.

## Decision 19 — Recoverable publication commit protocol

**APPROVED / FROZEN.**

Before a READY_TO_PUBLISH filesystem side effect, allocate the publication identity deterministically for the run and append `PUBLICATION_INTENT_RECORDED` with enough evidence to recover the exact publication:

- `publicationId`;
- bundle identity and hash;
- intended final-name/path identity as appropriate;
- candidate-bundle content hash;
- `runId`.

Then use the existing atomic same-directory publication boundary. After success, append `PUBLICATION_COMMITTED` with exact `publicationId`, `finalName`, SHA-256, and byte length.

On recovery from intent without commit:

- exact intended file present with expected hash: reconcile it as committed;
- file absent: retry safely with the same publication identity;
- conflicting bytes present: fail closed.

Recovery never creates a second unrelated publication because a crash occurred after rename but before journal update.

## Decision 20 — Client/API run recovery

**APPROVED / FROZEN.**

The loopback and session authorization boundary remains unchanged. Generation requests include `runId`.

The API exposes narrowly scoped read-only run observation so the browser can recover after reload, lost HTTP response, or server restart. A narrow run-status endpoint and an explicit ambiguous-run abandonment action are approved.

Exact route names may follow existing conventions, but capabilities are limited to:

- generate or resume using `runId`;
- observe durable run status/result;
- abandon only eligible ambiguous/recovery states.

All endpoints remain loopback-only and use the same SOD session authorization. No endpoint gains PRETRADE lifecycle or ARM authority.

## Decision 21 — Sanitized run provenance

**APPROVED / FROZEN.**

Durably retain only production-useful sanitized provenance. At minimum:

- `runId`, `requestHash`, `sourceDate`, and `generationMode`;
- creation and stage timestamps;
- authorized chart IDs, content refs, and hashes;
- provider identity and version;
- requested model and resolved model when available;
- safe upstream response/request ID;
- provider-result SHA-256;
- PRETRADE snapshot/fingerprint metadata used for preparation;
- publication identity/hash;
- terminal status;
- stable sanitized failure code.

Token/usage metadata may be retained when already safely available.

Never persist API keys, Authorization headers, browser session tokens, raw secret-bearing environment, or unsanitized upstream error bodies. Persistence of the raw OpenAI response is neither required nor authoritative.

## Decision 22 — Provider and model readiness

**APPROVED / FROZEN.**

Hard-coded `providerConfigured: true` is insufficient. Health/status distinguishes at least:

- `providerLoaded`: a provider object/module exists;
- `providerConfigured`: required production provider configuration exists;
- `modelConfigured`: an explicit non-empty model is configured;
- `liveAcceptanceValidated`: durable sanitized acceptance evidence exists for the configured provider/model combination.

Reading `/health` must not cause a paid or network provider call. There is no silent model fallback. Unsupported or incompatible model behavior fails closed.

## Decision 23 — Live OpenAI validation is an acceptance gate

**APPROVED / FROZEN.**

Live validation is not an architecture blocker. It is a mandatory implementation-acceptance gate after hardening, offline tests, regressions, and build are green.

An explicit opt-in credentialed run through the actual production provider path must demonstrate:

- Responses API connectivity;
- image input;
- required `web_search` behavior;
- strict structured-output request compatibility;
- returned-output compatibility with local validation;
- source-evidence extraction;
- current parser and mapping compatibility.

Retain only sanitized evidence: provider, configured and resolved model, timestamp, safe OpenAI response/request ID, completion status, web-search evidence presence, structured-output validation result, chart/image-path result, and production provider acceptance result.

Do not persist an API key, Authorization header, raw secret-bearing request, private chart bytes in documentation, or an unnecessary full provider response. The live validation is opt-in and excluded from normal offline regression.

## Decision 24 — Stable failure and HTTP semantics

**APPROVED / FROZEN.**

Production failures use stable sanitized error codes. Distinguish where practical:

- configuration failure;
- authentication failure;
- access denied;
- rate limiting;
- upstream unavailability;
- transport timeout;
- network failure;
- raw response too large;
- malformed outer response;
- structured output too large;
- duplicate JSON keys;
- local schema invalid;
- research evidence invalid;
- artifact source URL invalid;
- chart count exceeded;
- aggregate chart bytes exceeded;
- serialized request exceeded;
- active run conflict;
- `runId` / `requestHash` conflict;
- ambiguous provider recovery;
- PRETRADE change during preparation;
- publication recovery conflict.

Browser-visible responses redact configured local paths and credentials and never include raw upstream error bodies. Safe upstream request IDs may be retained.

The API may use more accurate HTTP statuses instead of collapsing every production failure to HTTP 400. Exact status mapping remains an implementation detail, but failure classes remain distinguishable.

## Decision 25 — Browser and operator control

**APPROVED / FROZEN.**

Generation remains explicitly operator-initiated. The browser represents presentation and operator intent only; browser busy state is UX, not concurrency authority.

The UI can show active `runId`, durable stage, provider/model readiness, terminal success/failure, PRETRADE preflight-required state, ambiguous provider recovery, active-run conflict, and eligible abandonment.

Browser code receives no direct journal or filesystem authority and gains no lifecycle, ARM, or execution authority.

## Decision 26 — No general retry or workflow subsystem

**APPROVED / FROZEN.**

The following are explicitly out of scope:

- generalized job scheduler;
- generalized workflow engine;
- generalized distributed lock system;
- automatic model retry policy;
- cloud or multi-device run authority;
- multi-user concurrency architecture.

This is a local, single-user, durable SOD generation journal only.

## Decision 27 — Accepted components are not reopened

**APPROVED / FROZEN.**

Do not redesign:

- chart-store identity and opaque-reference semantics;
- deterministic SOD artifact rendering;
- canonical 19-section ordering;
- A+ / Morning Priority derivation;
- standing renderer-owned risk rules;
- candidate export semantics, except narrow integration required here;
- NEW / UNCHANGED / REVISED lineage rules;
- Candidate Feeder authority boundary;
- PRETRADE authority;
- manual SOD/trade-card ingestion architecture;
- ARM;
- Execution Board handoff;
- downstream execution lifecycle;
- broker observation;
- broker-write prohibition.

Any necessary modification to an accepted component must be narrowly required by a decision above and preserve its accepted semantics.

---

# Part II — Explicit non-goals

This slice does not:

- replace the OpenAI Responses API;
- migrate to Chat Completions;
- add another analysis provider or make another provider the default;
- add automatic provider retries;
- redesign candidate identity;
- change contract-version or lineage semantics;
- automate REVISED-candidate supersession;
- change PRETRADE ARM flow, DSS, risk sizing, or quantity authority;
- change execution handoff or downstream execution ownership;
- add broker writes;
- redesign reports, dashboards, Candidate Feeder, or manual ingestion;
- merge or release the feature to `main`.

---

# Part III — Mandatory acceptance test matrix

Every matrix section is mandatory before implementation acceptance. Passing tests is evidence for review, not user acceptance.

## A. Candidate identity unchanged

- The model cannot author `candidateId` or `candidateKey`.
- Trusted-adapter deterministic identity remains stable.
- Duplicate deterministic identity fails closed.

## B. Artifact URL safety

- Absolute `https:` and `http:` URLs are accepted.
- `javascript:`, `data:`, `file:`, relative, malformed, and other-scheme URLs are rejected.
- An OpenAI artifact URL absent from actual search sources is rejected.
- A canonically matched actual search source is accepted.

## C. Chart limits

- Up to 16 valid charts are permitted.
- A 17th chart is rejected before all bytes are eagerly resolved.
- Aggregate raw bytes at or below 32 MiB are permitted.
- Aggregate raw bytes above 32 MiB are rejected incrementally.
- Unauthorized chart refs are rejected.
- Limit enforcement does not require redundant full-byte copies.

## D. Provider request and response limits

- A serialized request above 48 MiB is rejected locally.
- A raw HTTP response above 4 MiB is rejected before JSON parsing.
- Structured output above 768 KiB is rejected before parsing.
- Excessive depth, nodes, object keys, array length, and string bytes are rejected deterministically.

## E. Duplicate-aware parsing

- Duplicate top-level and nested object keys are rejected.
- Ordinary valid JSON is accepted.

## F. Exact local schema

- Missing required fields are rejected.
- Unknown fields are rejected where `additionalProperties: false`.
- Wrong enums and primitive types are rejected.
- `minItems` and `maxItems` are enforced.
- Previously tolerated malformed-but-parseable transport is rejected before mapping.

## G. Run identity

- New `runId` plus valid request claims a run.
- Same `runId` plus same `requestHash` resumes or replays.
- Same `runId` plus different `requestHash` fails conflict.
- Terminal exact replay does not invoke the provider again.

## H. sourceDate single-flight

- A second run for an active `sourceDate` does not invoke the provider.
- The second caller receives the active run identity and state.
- A terminal first run permits an explicit later run with a new `runId`.

## I. Provider-result durability

- A crash after durable provider-result persistence does not reinvoke the provider.
- Recovery reuses the exact durable normalized provider result.
- A provider-result hash mismatch fails closed.

## J. Ambiguous provider outcome

- A crash after `PROVIDER_REQUEST_STARTED` and before durable result persistence becomes `PROVIDER_OUTCOME_AMBIGUOUS`.
- No automatic provider retry occurs.
- Explicit abandonment records `ABANDONED` and preserves history.
- A later provider attempt requires a new `runId`.

## K. PRETRADE freshness after provider work

- An initial snapshot may show a candidate absent while PRETRADE changes during provider latency.
- Post-provider lineage uses fresh state.
- A stale NEW classification is not published.

## L. Pre-publication authority fence

- A PRETRADE change after preparation but before publication blocks publication.
- The provider is not called again.
- Preparation is recomputed or resumed from the durable provider result.

## M. Recovery freshness

- Restart recovery with a durable provider result fetches fresh PRETRADE authority.
- A persisted prior snapshot is never treated as current authority.

## N. Publication crash windows

- A crash before publication leaves no visible publication.
- Intent recorded before rename resumes with the same publication identity.
- Rename completed before commit is reconciled from the exact existing file.
- Conflicting existing bytes fail closed.
- Recovery never creates an unrelated duplicate publication.

## O. Lost HTTP response

- Publication may succeed while the response is lost.
- Retrying the same `runId` returns the prior durable result.
- No second provider call or publication occurs.

## P. Readiness

- Missing API key fails configured readiness.
- Missing model fails configured readiness.
- A loaded provider is not reported as live validated.
- `liveAcceptanceValidated` remains false until durable real acceptance evidence exists for the configured provider/model.

## Q. Error sanitization

- API key and Authorization headers are absent from every error surface.
- Configured local paths are redacted.
- Upstream error bodies are not leaked.
- A safe upstream request ID may be retained.

## R. Existing SOD regression

- Generic provider contract, mocked OpenAI provider, renderer, orchestration, chart store, candidate export, lineage, publication, and Candidate Feeder remain green.

## S. Manual-ingestion regression

- Accepted manual-ingestion tests remain green.
- No manual-ingestion or authority regression is introduced.

## T. PRETRADE and downstream regression

- Canonical ingress remains green.
- Existing PRETRADE, ARM, handoff, and execution authority regressions remain green.

## U. Full production build

- The production build passes.

## V. Credentialed OpenAI acceptance

- Validation is explicit and opt-in.
- A real Responses call uses the configured model and image input.
- Required web search occurs.
- Local structured-output validation succeeds.
- Sanitized acceptance evidence is retained.
- No secret is persisted.

---

# Part IV — Implementation and acceptance governance

Implementation is governed by:

`docs/ExecutionOS_V2.4_Production_SOD_Analysis_Provider_Implementation_Handoff_v1.0.md`

The required review workflow is:

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

The implementation must not be described as accepted merely because code exists, tests pass, a commit is created, or a review checkpoint is pushed. Live OpenAI evidence is mandatory but remains a separate final acceptance gate.

---

## Frozen close

This baseline freezes Decisions 1–27 and Acceptance Matrix A–V for implementation on `v24-sod-production-analysis-provider` from exact base `e2357933147600e702c5e252020b257debbe3392`.

Changes to these decisions require explicit new design approval. This document itself is design authority, not implementation evidence, live-provider evidence, merge evidence, release evidence, or user acceptance of a future implementation.
