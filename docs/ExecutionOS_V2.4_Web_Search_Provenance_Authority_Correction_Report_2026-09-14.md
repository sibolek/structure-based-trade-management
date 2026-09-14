# ExecutionOS V2.4 web-search provenance authority correction

Implemented the approved, narrow Option B correction. The provider remains
fail-closed and run-local. A source is authoritative only when it is observed
in the same Responses API response as either an existing
`web_search_call.action.sources[].url`, or a completed page action whose type is
`open_page` or `find_in_page` and whose `action.url` is a valid absolute HTTP(S)
URL. The existing URL normalization and exact normalized membership predicate
are unchanged.

No OpenAI request, retry, service restart, commit, push, or Gate V run was
performed. Existing live run evidence was not touched.

## Files changed in this pass

- `schwab-bridge/sod-openai-analysis-provider.mjs`
  - `extractOpenAiWebSearchSources()` now builds one deterministic,
    first-seen, deduplicated union from source arrays and qualified page
    actions.
  - The union remains the sole input to research, artifact, and candidate
    provenance checks.
- `schwab-bridge/sod-research-diagnostics.mjs`
  - Adds bounded extraction counters for source-array and page-action
    contributions.
  - Adds allowlisted page-action observations with action type, status,
    eligibility, reason, and fingerprint-only URL evidence.
  - Accepts historical version-1 diagnostics with missing new fields.
- `tests/sod-openai-analysis-provider.test.mjs`
  - Covers action-only authority, source/action deduplication, status/type
    gates, malformed and non-HTTP actions, missing status, and response-local
    membership.
- `tests/sod-provider-hardening.test.mjs`
  - Covers contribution counters, action observations, bounds and secret-safe
    diagnostics.
- This report.

## Authoritative set and eligibility

For each `response.output` item with `type === "web_search_call"`:

1. Every valid normalized `action.sources[].url` enters the source-array set,
   preserving the existing behavior.
2. A page-action URL enters the page-action set only when:
   `status === "completed"`, `action.type` is exactly `open_page` or
   `find_in_page`, and `action.url` passes the existing absolute HTTP(S) URL
   validation and normalization.
3. The authoritative set is the deterministic union of those two sets.

Search actions, unknown actions, missing/failed/incomplete statuses, malformed
URLs, message annotations, redirects, HTML canonical URLs, and URLs from any
other response are not promoted to authority. Research, artifact, and
candidate provenance all consume the same union.

## Durable diagnostic shape

The existing sanitized `FAILED` event remains the only durable location. No
provider result artifact is created by a provenance rejection.

```text
providerDiagnostics.semantic:
  version: 1
  validatorStage: RESEARCH_SOURCE_MEMBERSHIP
  extraction:
    webSearchCallCount: integer
    missingSourcesArrayCount: integer
    rawSourceCount: integer                 # existing source-array count
    invalidSourceCount: integer
    duplicateSourceCount: integer
    distinctSourceCount: integer            # existing source-array distinct count
    sourceArrayRawCount: integer
    sourceArrayDistinctCount: integer
    qualifyingPageActionCount: integer      # valid qualified entries, duplicates included
    qualifyingPageActionDistinctCount: integer
    combinedAuthoritativeDistinctCount: integer
    actionObservationCount: integer
    rejectedActionObservationCount: integer
  actionObservations: bounded list:
    - actionType: search | open_page | find_in_page | OTHER | null
      status: in_progress | searching | completed | failed | incomplete | OTHER | null
      eligible: boolean
      reason: QUALIFIED_PAGE_ACTION | ACTION_TYPE_NOT_QUALIFIED |
              STATUS_NOT_COMPLETED | INVALID_URL
      url: URL_DIAGNOSTIC (optional)
```

Action observations are capped at 16. Existing mismatch, extracted-source,
observed-link and 32 KiB semantic-diagnostic bounds remain in force. URL
diagnostics retain only allowlisted hashes, flags, schemes, and lengths; raw
hosts, paths, queries, credentials, headers, cookies, and model prose are not
retained. Historical diagnostics without these fields continue to sanitize and
replay without rewriting their journal bytes.

## CRUDE query mismatch

The earlier CRUDE mismatch was intentionally left unchanged. A cited URL with
no query does not match an extracted URL with a non-UTM query merely because
their host and path match. No query parameters were globally removed, and no
query identity rule was changed.

## Validation

| Check | Result |
|---|---|
| Focused OpenAI provider + hardening | PASS — 83 tests |
| Semantic diagnostics | PASS — 17 tests |
| Run integrity | PASS — 39 tests |
| SOD orchestration suite | PASS — 200 tests |
| Candidate/Decision 28 regression coverage | PASS within full Node regression; no candidate files changed |
| Full Node regression | PASS — 1,138 tests |
| Browser tests | PASS — 28 tests |
| Production build | PASS — 1,626 modules |
| `git diff --check` | PASS |

Acceptance Matrix A–U remains PASS based on these offline suites. Gate V was not
run and no live provider result is claimed for this correction.

The preserved run `a6b97129-c85c-4feb-887b-37ea241c24a6` and all other existing
run journals were not rewritten. Prompt text, transport schema, query
normalization, candidate authority, PRETRADE, ARM, Execution, renderer,
publication, retry policy, and `store:false` are unchanged by this slice.
