# ExecutionOS V2.4 transport diagnostics extension

This pass implements only the approved observability slice. The OpenAI
Responses transport, timeout values, dispatcher/protocol configuration,
request payload, model, `store:false`, retry policy, research and candidate
validators, PRETRADE, publication, lifecycle, broker boundary, renderer and
UI behavior are unchanged. No OpenAI request, retry, service restart,
abandonment, commit or push was performed.

## Files changed in this pass

- `schwab-bridge/sod-transport-diagnostics.mjs` — allowlisted exception/cause
  and transport-code normalization, bounded cause-chain builder, version and
  boundary-field sanitization.
- `schwab-bridge/sod-openai-production-provider.mjs` — capture the caught
  transport exception before the existing classification/sanitization and
  attach bounded diagnostics at the existing fetch catch boundary.
- `schwab-bridge/sod-openai-analysis-provider.mjs` — mark response-parse
  failures as having observed response headers so an already-safe request ID
  remains correctly qualified.
- `tests/sod-openai-production-provider.test.mjs` — offline transport fault
  injection, normalization, redaction, limits and response-boundary tests.
- `tests/sod-run-integrity.test.mjs` — durable timeout-diagnostic assertions
  alongside existing no-retry, no-PRETRADE and legacy replay coverage.
- This report.

## Durable diagnostic shape

The existing sanitized `providerDiagnostics` object is extended as follows;
the enclosing run transitions are unchanged.

```text
providerDiagnostics:
  errorCode: SOD_OPENAI_...                 # existing classified error
  phase: REQUEST_STARTED | HEADERS_RECEIVED | BODY_READING |
         BODY_RECEIVED | RESPONSE_PARSED
  timeoutMs: integer 1..600000
  elapsedMs: integer 0..2147483647
  headersObserved: boolean
  applicationAbortObserved: boolean
  requestId: req_...                         # only when headers were observed
  httpStatus: integer 100..599               # when a response status existed
  exceptionClass: allowlisted class | OTHER
  causeClass: allowlisted class | OTHER
  transportCode: allowlisted code | OTHER
  causeChain:                                # at most two entries
    - depth: 0 | 1
      class: allowlisted class | OTHER
      code: allowlisted code | OTHER
  nodeVersion: bounded version               # when available
  undiciVersion: bounded version             # when available
```

Recognized transport codes include the requested Undici values
(`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_SOCKET`), socket
and DNS values (`ECONNRESET`, `EPIPE`, `ENOTFOUND`, `EAI_AGAIN`), connection
timeouts and common TLS/certificate errors. Unknown classes and codes are
normalized to `OTHER`. The cause chain records the caught exception and at
most one direct cause; cycles and deeper causes are bounded away.

`headersObserved` starts false before `fetch()`, becomes true only after a
response object is returned, and remains an observation of the local boundary;
it does not assert that OpenAI accepted the request or completed processing.
The application timeout callback alone sets `applicationAbortObserved=true`.
An independently thrown `AbortError` therefore remains a network failure,
while the existing controller timeout remains `SOD_OPENAI_TIMEOUT`.

## Redaction and bounds

Only fixed allowlists, booleans, bounded integers, a validated `req_...`
identifier and bounded version strings are retained. Raw error messages, stack
traces, URLs, hostnames/IP addresses, socket objects, request/response headers,
request/response bodies, credentials and arbitrary nested error data are never
copied. Cause depth is capped at two entries; no arbitrary strings are carried
from an exception. A request ID is suppressed when the diagnostic explicitly
states `headersObserved:false`. Older journals lacking the new fields are
sanitized and replayed exactly as before.

## Behavioral preservation

The original classification remains in force: existing `SOD_OPENAI_*` errors
are preserved, application controller aborts remain timeouts, and other
transport failures remain `SOD_OPENAI_NETWORK_FAILED`. There is no automatic
provider retry and no change to timeout or connection policy. A deterministic
failure still follows `CLAIMED → PROVIDER_REQUEST_STARTED → FAILED` where
applicable; an ambiguous network outcome still follows the existing
`RECOVERY_REQUIRED` path.

## Validation

The focused production-provider tests exercise header/body timeout causes,
socket/reset, DNS, TLS, independent and application aborts, post-header body
failures, unknown normalization, cause bounds, redaction and limits. Existing
run-integrity coverage verifies durable propagation, no provider-result
artifact, no PRETRADE/publication work, no retry, and byte-preserving legacy
replay.

| Check | Result |
|---|---|
| Focused OpenAI analysis provider | PASS — 14 tests |
| Focused production fetch/provider diagnostics | PASS — 22 tests |
| Provider hardening | PASS — 69 tests |
| Run integrity | PASS — 39 tests |
| SOD orchestration suite | PASS — 208 tests |
| Candidate feeder regression | PASS — 49 tests |
| Manual-ingestion/candidate regression | PASS — 69 tests |
| Full Node regression (`npm run analytics:test`) | PASS — 1,146 tests |
| Browser regression | PASS — 28 tests |
| Production build | PASS — 1,626 modules transformed |
| `git diff --check` | PASS |

All executed suites reported zero failures, cancellations and skips. The
transport extension did not change browser behavior, but the requested browser
regression and production build were rerun.

### Acceptance Matrix A–U

The frozen offline matrix remains green after this observability-only change:

| Gate | Result | Evidence |
|---|---|---|
| A — Candidate identity | PASS | Full Node and SOD suites; no identity authority changed. |
| B — Artifact URL safety | PASS | SOD/provider hardening URL and provenance tests. |
| C — Chart limits | PASS | SOD/provider hardening chart-limit tests. |
| D — Request/response limits | PASS | Provider hardening limits plus transport redaction bounds. |
| E — Duplicate-aware parsing | PASS | Provider hardening strict parser tests. |
| F — Exact local schema | PASS | SOD/provider hardening schema tests; schema unchanged. |
| G — Run identity | PASS | Run-integrity claim, replay and conflict tests. |
| H — sourceDate single-flight | PASS | Run-integrity active-date conflict tests. |
| I — Provider-result durability | PASS | Run-integrity durable-result and failure artifact tests. |
| J — Ambiguous provider outcome | PASS | Run-integrity no-retry/recovery tests; semantics unchanged. |
| K — PRETRADE freshness | PASS | SOD orchestration/run-integrity freshness tests. |
| L — Publication fence | PASS | SOD orchestration/run-integrity fence tests. |
| M — Recovery freshness | PASS | Run-integrity recovery tests. |
| N — Publication crash windows | PASS | SOD orchestration/run-integrity publication recovery tests. |
| O — Lost HTTP response | PASS | SOD orchestration/run-integrity exact replay tests. |
| P — Readiness | PASS | Production-provider/SOD API readiness tests. |
| Q — Error sanitization | PASS | 22 transport diagnostics tests plus hardening/run-integrity redaction. |
| R — Existing SOD regression | PASS | 208-test SOD orchestration suite. |
| S — Manual ingestion | PASS | 69-test manual-ingestion/candidate regression and full Node suite. |
| T — PRETRADE/downstream | PASS | Candidate feeder and full lifecycle regressions. |
| U — Production build | PASS | Vite production build, 1,626 modules. |

**A–U: PASS. Gate V: not run, as instructed.**

## Preserved ambiguous evidence

Run `3b3fb26c-a78d-4a82-b128-6d87eaa9a108` was not opened for writing,
abandoned, retried or replayed. Its journal files remain byte-for-byte
unchanged:

| Journal file | SHA-256 |
|---|---|
| `00000001.json` | `aa9597a80bfece39d56003f72f85b75484b146d6bb98bbd2c6761f30a78aa6fa` |
| `00000002.json` | `6ce5348e247d4ab0d474ae16a7100509cf98923dee4e52733b03e2e7feab3379` |
| `00000003.json` | `45797926d0cf59d77023ad9efbfa260dfb8f7f26b6f0c50435df8f5d8109d7c9` |

No artifact was created for that ambiguous run.
