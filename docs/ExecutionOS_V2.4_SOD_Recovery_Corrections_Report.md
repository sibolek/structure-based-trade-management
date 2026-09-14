# ExecutionOS V2.4 — SOD recovery corrections

Implemented the approved timeout, diagnostics, explicit-date, and recovery-presentation corrections. This is an offline implementation report; no new live acceptance attempt was performed.

## Resulting behavior

- Production SOD defaults to a 600,000 ms (10-minute) client timeout. `EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS` configures an integer from 1 through 600,000 ms. Invalid configuration fails at provider construction, including when credentials are absent. The existing production module entry uses this configuration without a new startup command. The timeout is visible in provider readiness and recorded with provider metadata at STARTED.
- This is a provisional bounded wait budget for the seven-chart workload, not evidence that OpenAI will complete within ten minutes. The timer covers fetch and bounded response-body consumption. It is cleared on settlement; a response arriving after abort cannot become a successful result.
- Handled transport failures carry allowlisted diagnostics: stable error code, effective timeout, elapsed milliseconds, last observed phase, safe request ID when available, and HTTP status when observed. Request IDs are captured when headers arrive. Diagnostics survive adapter sanitization, durable recording, run projection, and journal replay.
- Phases are `REQUEST_STARTED`, `HEADERS_RECEIVED`, `BODY_READING`, `BODY_RECEIVED`, and `RESPONSE_PARSED`. They describe client observations, never upload completion, socket connection, or remote completion. Analysis-validation failures after envelope parsing retain the safe request ID and parsed-envelope phase without changing their validation error.
- Existing journals without diagnostics remain readable and are not rewritten. Recovery still returns HTTP 409 for ambiguity; diagnostic error codes do not replace the recovery state or authorize retry.
- The new-run source-date field starts empty. A date must be explicitly selected before Generate or Refresh becomes available. Chart upload and workspace switching do not change the selection. Saved-run resume continues to use the saved request and its original date, independently of the new-run picker.
- Missing results display candidates as unavailable. Ambiguous results explicitly say “Candidates unavailable — provider outcome ambiguous.” Validated `NO_CANDIDATES` continues to display zero.
- The UI disables new generation for the known unresolved run's actual source date. Server conflict responses now include that source date and recovery reason so this also works after a cross-client conflict. The server remains authoritative. Other dates remain independent under the frozen per-date single-flight rule.

## Scope and invariants

Production changes are confined to `sod-openai-production-provider.mjs`, `sod-openai-analysis-provider.mjs`, `sod-production-run.mjs`, `sod-run-store.mjs`, the new `sod-transport-diagnostics.mjs`, and `SodWorkspace.jsx`.

The model, prompt, strict Responses schema, semantic/provenance validators, renderer, candidate identity rules, PRETRADE freshness/publication fences, `store: false`, state transitions, and no-automatic-retry behavior are unchanged. No historical research mode or replay clock was introduced. A historical source date does not enforce point-in-time web research.

Diagnostics are persisted when a handled failure reaches the durable transition. A process crash before that transition can still leave no transport diagnostics. This correction does not backfill unavailable evidence or make an ambiguous remote outcome knowable.

## Offline validation

- Full Node regression: **1,093 passed**, zero failures.
- Full browser regression: **28 passed**, zero failures.
- Production build: **PASS**, 1,626 modules transformed.
- `git diff --check`: **PASS**.

New coverage exercises timeout before headers and during body consumption, sanitized identifier retention, HTTP and analysis-validation failures, timeout bounds and normal module loading, timer cleanup, late responses, durable diagnostic replay, legacy journal compatibility, same-date conflict, synthetic abandonment preserving prior bytes, seven-chart historical-date request construction, absent-date rejection, date persistence, saved-request recovery, and unavailable-versus-zero presentation.

An existing manual-import browser test was updated to explicitly select a session date before testing Generate. Browser tests use isolated harnesses and mocked service responses. Node provider tests use injected fake transports. No test calls the live OpenAI service.

Logs: `/tmp/sod-recovery-regression.log`, `/tmp/sod-recovery-browser.log`, `/tmp/sod-recovery-build.log`. The earlier focused SOD run passed 171 tests; the subsequent full regression includes the additional analysis-validation diagnostic test.

## Preserved live evidence and runtime status

Run `5d3f0254-fb05-483b-8030-f77e85727383` remains `RECOVERY_REQUIRED / PROVIDER_OUTCOME_AMBIGUOUS`, source date `2026-09-13`, under `~/.executionos/v24/historical-2026-09-11/runs`.

Its three original journal files remain byte-for-byte unchanged:

| File | SHA-256 |
|---|---|
| `00000001.json` | `526f3222eb96033224f34e1861e215a668886d7ccebf936d516ef08b41b5be4f` |
| `00000002.json` | `e023589b2ccfbd0be623d16ee4200f328b79e89224fd5d56960cbb7b8f8fdb17` |
| `00000003.json` | `afabf4f9708de9821b6aa7bbba7589bdc77d69b3a2519bbdc94a60c484e8083c` |

There is still exactly one run in this historical store, no provider artifact, and no isolated candidate inbox. No live abandonment, retry, publication, or service restart was performed. The existing SOD server process (PID 66036 at verification) still has its pre-correction backend code loaded. The frontend development server may apply UI changes through hot reload; that does not update the backend timeout.

After review, activation requires loading the corrected backend and separately authorizing eligible abandonment of the existing ambiguous run. A later paid attempt must intentionally use a new run ID, explicitly selected September 11 source date, and confirmed charts. Do not change the old run's date or hash. Nothing was committed or pushed.
