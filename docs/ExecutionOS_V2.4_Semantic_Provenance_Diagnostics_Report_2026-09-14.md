# ExecutionOS V2.4 semantic-provenance failure diagnostics

Implemented only the approved diagnostic extension. Research citation rejection, URL normalization, source-date semantics, prompt, renderer, model transport schema, candidate authority, downstream authority, publication and retry behavior are unchanged. There was no live provider request or service restart during this implementation.

## Exact files changed in this pass

1. `schwab-bridge/sod-research-diagnostics.mjs` — new bounded diagnostic builder and independent allowlist sanitizer.
2. `schwab-bridge/sod-openai-analysis-provider.mjs` — attach diagnostic evidence when the existing membership predicate rejects research citations; pass it through the existing failure handler. The raw mismatch list is no longer exposed on the thrown error.
3. `schwab-bridge/sod-transport-diagnostics.mjs` — permit the versioned semantic object only for `SOD_OPENAI_RESEARCH_SOURCE_MISMATCH`, and sanitize it at each existing propagation/replay boundary.
4. `tests/sod-provider-hardening.test.mjs` — 20 new tests for matching behavior, diagnostic structure, extraction observations, fingerprints, normalization differences, bounds, redaction and unchanged inputs.
5. `tests/sod-run-integrity.test.mjs` — 2 new tests for durable deterministic failure, no downstream work, safe request-ID coexistence, and unchanged legacy FAILED replay.
6. This report.

No candidate, PRETRADE, ARM, Execution, renderer, schema, UI, startup, or publication files changed in this pass. Existing uncommitted work was preserved.

## Durable shape

The existing FAILED event remains the storage location. No diagnostic provider-result artifact is created.

```text
data:
  failureCode: SOD_OPENAI_RESEARCH_SOURCE_MISMATCH
  providerDiagnostics:
    errorCode: SOD_OPENAI_RESEARCH_SOURCE_MISMATCH
    phase: RESPONSE_PARSED
    requestId: req_...                         # existing allowlisted ID, if available
    semantic:
      version: 1
      validatorStage: RESEARCH_SOURCE_MEMBERSHIP
      redirectResolution: NOT_PERFORMED
      mismatchCount: integer
      extractedSourceCount: integer
      observedLinkCount: integer
      mismatchesTruncated: boolean
      extractedSourcesTruncated: boolean
      observedLinksTruncated: boolean
      extraction:
        webSearchCallCount: integer
        missingSourcesArrayCount: integer
        rawSourceCount: integer
        invalidSourceCount: integer
        duplicateSourceCount: integer
        distinctSourceCount: integer
      mismatches:
        - researchIndex: integer              # zero-based
          sourceUrlIndex: integer             # zero-based
          category: existing research-category enum
          reason: INVALID_URL | SOURCE_NOT_IN_WEB_SEARCH_SET | EMPTY_EXTRACTED_SOURCE_SET
          url: URL_DIAGNOSTIC
      extractedSources: [URL_DIAGNOSTIC]
      observedLinks:
        - location: WEB_SEARCH_ACTION_URL | MESSAGE_URL_CITATION
          url: URL_DIAGNOSTIC
```

`URL_DIAGNOSTIC` contains only allowlisted hashes, enums, booleans and lengths:

- `rawSha256` (trimmed input), optional `canonicalSha256`;
- optional `hostSha256`, `pathSha256`, `decodedPathSha256`, `querySha256`, `decodedQuerySha256`;
- `valid`, `oversized`, and applicable flags: `fragmentPresent`, `utmRemoved`, `trailingSlashRemoved`, `hostnameCaseNormalized`, `percentEncodingPresent`, `queryRetained`, `credentialsPresent`;
- `rawLength`, and where inspected `pathLength`, `queryLength`;
- optional `scheme`, exactly `http` or `https`.

Decoded component hashes are diagnostic comparisons only. Neither decoded paths nor decoded queries are supplied to the validator's matching set. URL normalization remains the existing function, invoked unchanged.

## Redaction and bounds

- Maximum **8 mismatches**, **16 unique extracted-source descriptors**, and **8 additional observed-link descriptors**.
- Maximum serialized semantic diagnostic: **32,768 UTF-8 bytes**. A defensive final size check trims observations, then extracted descriptors, then mismatches if necessary; counts and truncation flags remain explicit.
- URLs longer than **4,096 characters**, before or after canonicalization, retain fingerprints, length and oversized/valid flags only. Component parsing for diagnostics is skipped. Original provider input/resource limits continue to govern validation.
- All fingerprints are deterministic SHA-256, exactly 64 lowercase hexadecimal characters.
- No raw hostnames, paths, query names/values, fragments, userinfo, raw URLs, headers, cookies, report text or model prose are retained. Component hashes provide equality information while excluding secrets that could appear anywhere in a URL. This is intentionally stricter than retaining human-readable host/path strings.
- Numeric metadata must be integer and within 0–10,000,000; unsupported values/fields are discarded or replaced with the safe numeric fallback. Categories, reasons, locations, stages and schemes use fixed allowlists.
- Existing bounded transport metadata, including a validated `req_...` identifier, coexists with the semantic object. Raw exception messages/details are not copied into it.
- Sanitization is repeated through the existing provider failure, runner and store replay paths. Unknown semantic versions/stages are not accepted.

## Interpretation limits

Source descriptors reflect the validator's actual normalized source set, in existing deterministic first-seen order. Extraction counters record missing source arrays, invalid URLs and duplicate normalized URLs. Additional known URL locations are diagnostic observations only: they never become accepted search sources.

Matching hashes can expose a citation appearing in a message annotation or action URL while absent from the accepted `action.sources` set. Component hashes distinguish differing hosts, paths or retained queries. Decoded hashes and flags help identify percent-encoding or ignored-normalization differences without repairing them.

No redirects are followed and no canonical-page fetch is added. When the response does not represent a redirect relationship, diagnostics cannot establish it. Capped lists may omit relevant items; truncation flags prevent claiming complete evidence. This extension cannot recover the already-discarded response from the preserved live failure.

## Validation

| Check | Result |
|---|---|
| Focused OpenAI analysis/production provider, hardening and run integrity | PASS — 130 tests |
| SOD orchestration suite | PASS — 194 tests |
| Decision 28/admission integrity, candidate contract/ingress/export/lineage, publication intent, feeder and manual SOD ingestion | PASS — 161 tests |
| Full Node regression | PASS — 1,115 tests |
| Browser regression | PASS — 28 tests |
| Production build | PASS — 1,626 modules |
| `git diff --check` | PASS |

All reported test runs have zero failures, cancellations and skips. The final focused/SOD/full runs include the query-percent-encoding diagnostic test. The browser/build and candidate checks are also covered by unchanged frontend/candidate implementation and the final full Node regression where applicable.

### Acceptance Matrix A–U

This is a review of the frozen matrix against the executed offline suites, not a new live acceptance run.

| Gate | Result | Evidence |
|---|---|---|
| A — Candidate identity | PASS | Existing deterministic identity and forbidden model-authority tests; no identity code changed. |
| B — Artifact URL safety | PASS | Existing URL safety/provenance rejection plus unchanged matching-equivalence cases. |
| C — Chart limits | PASS | Existing 16-chart, aggregate-byte and trusted-reference tests. |
| D — Request/response limits | PASS | Existing resource tests; new diagnostic count/size/redaction tests. |
| E — Duplicate-aware parsing | PASS | Existing nested duplicate-key and raw structural parser tests. |
| F — Exact local schema | PASS | Existing strict transport schema tests; schema unchanged. |
| G — Run identity | PASS | Run replay/conflict tests; same FAILED run causes no provider invocation. |
| H — Per-date single-flight | PASS | Existing active claim and terminal release tests; date semantics unchanged. |
| I — Provider-result durability | PASS | Existing durable-result recovery; new rejection stores zero result artifacts. |
| J — Ambiguity recovery | PASS | Existing crash/abandon/no-retry tests; research mismatch remains deterministic FAILED. |
| K — Post-provider PRETRADE freshness | PASS | Existing fresh snapshot tests; failed research performs zero PRETRADE reads. |
| L — Publication fence | PASS | Existing before-publication mutation/fence tests. |
| M — Recovery freshness | PASS | Existing recovery discards stale snapshots; diagnostic replay adds no authority. |
| N — Publication crash windows | PASS | Existing journal/filesystem reconciliation tests; no publication code changed. |
| O — Lost HTTP response | PASS | Existing exact replay/no-duplicate-publication tests. |
| P — Readiness | PASS | Existing credential/model/acceptance receipt tests. |
| Q — Error sanitization | PASS | New fingerprint-only diagnostic redaction, request-ID coexistence and durable secret-exclusion tests. |
| R — Existing SOD regression | PASS | 194-test SOD suite and full regression. |
| S — Manual ingestion | PASS | Targeted candidate/manual ingestion tests and browser manual-import coverage. |
| T — PRETRADE/downstream | PASS | Candidate/admission integrity and full lifecycle/ARM/Execution regression. |
| U — Production build | PASS | Production build completed successfully. |

**A–U: PASS. Gate V: not run, as instructed.** Historical live evidence is not represented as a new acceptance of this extension.

Logs are `/tmp/sod-semantic-focused.log`, `/tmp/sod-semantic-sod.log`, `/tmp/sod-semantic-candidates.log`, `/tmp/sod-semantic-regression.log`, `/tmp/sod-semantic-browser.log`, and `/tmp/sod-semantic-build.log`.

## Live evidence preservation

Run `76016adc-426f-4ebb-9629-3de6cc16dcab` remains terminal FAILED for source date `2026-09-11`. Its three original files are unchanged:

| File | SHA-256 |
|---|---|
| `00000001.json` | `25412dc8b51593ba95adccc5f0f4ef8d0c9fcbb8bebc9dfe65c6d3c75bf3e968` |
| `00000002.json` | `5e7ad1274efe86d346c46694c9d8f6f818315cb8f6357715b82e30f998aeb5c8` |
| `00000003.json` | `8251d3dcc1c74e5a010f8e9e486ce86be9ff937e7a0a904190be8d583d3f994a` |

No abandonment, rewrite, deletion, replay, provider call, publication, commit or push was performed. The historical run-store artifact directory remains empty. The running service was not restarted; this new diagnostic code is not activated there by this pass. No deviations from approved scope.
