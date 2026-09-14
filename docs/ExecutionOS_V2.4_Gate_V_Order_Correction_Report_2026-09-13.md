# ExecutionOS V2.4 — section-order correction and second Gate V acceptance

2026-09-13. **A–V PASS. Implementation remains uncommitted. No push or implementation-checkpoint commit.**

Branch: `v24-sod-production-analysis-provider`. Starting and ending HEAD: `e0543be3cf0cffa246f03ca427aca17523790291`.

## Approved correction

Option A only: five instruction lines were added to `providerInstructions()` in `schwab-bridge/sod-openai-analysis-provider.mjs`. The count and ordered list are generated from the existing `REPORT_SECTION_IDS` constant. The actual transport field is `artifactContent.sections`.

The instructions require exactly 19 sections, exactly one per canonical ID, exact positional order, correct title/block association, and insufficient-evidence statements within the correct section. They prohibit substituting another allowed ID or omitting, replacing, duplicating, or moving a section.

The schema, positional validator, canonical mapper, renderer, candidate identity, Decision 28, lifecycle/ARM/Execution authority, model configuration, and provider retry behavior are unchanged. A hash comparison against the starting worktree confirmed that removing these five instruction lines reproduces the exact original production module.

Three test files changed:

- `tests/sod-openai-analysis-provider.test.mjs`: the constructed request's ordered list matches the schema enum and independent canonical renderer IDs; all new instructions and existing strict output/web-search/store:false settings are checked.
- `tests/sod-provider-hardening.test.mjs`: six added rejection cases cover shuffled valid IDs, duplicate-with-omission, missing/extra sections, unknown ID, and malformed section structure. Inputs remain unchanged after rejection.
- `tests/sod-run-integrity.test.mjs`: an added production-adapter test with synthetic HTTP transport proves CLAIMED → PROVIDER_REQUEST_STARTED → FAILED, no durable result or publication, no downstream reads, and no additional provider call on immediate or post-restart replay. Replay preserves journal bytes.

No other pre-existing source or test file changed in this correction.

## Offline validation, completed before the live attempt

| Order | Command | Result |
|---|---|---|
| 1 | `node --test tests/sod-openai-analysis-provider.test.mjs tests/sod-provider-hardening.test.mjs tests/sod-run-integrity.test.mjs` | 91/91 PASS |
| 2 | `npm run v24:sod-orchestrator-test` | 160/160 PASS |
| 3 | `node --test tests/manual-candidate-import.test.mjs tests/pretrade-admission-integrity.test.mjs tests/pretrade-candidate-*.test.mjs` | 102/102 PASS |
| 4 | `npm run analytics:test` | 1,081/1,081 PASS |
| 5 | `npm run v24:router-browser-test -- --output=/tmp/sod-order-correction/browser-results` | 25/25 PASS |
| 6 | `npm run build` | PASS; 1,626 modules |
| 7 | `git diff --check` | PASS |

Logs: `/tmp/sod-order-correction/{focused,sod,candidates,full,browser,build}.log`. No failures or retries of these validation commands were needed.

## Live attempt and durable evidence

Exactly one new live command was executed after A–U passed:

```sh
EXECUTIONOS_SOD_LIVE_ACCEPTANCE=1 npm run v24:sod-live-acceptance
```

The credential and model were inherited from the local environment. The non-secret path variables, absent from this task's inherited environment, were set to the original Gate V resources under `/Users/stevenhirsch/.executionos/v24/gate-v`: `runs`, `charts`, `candidate-inbox`, and `gate-v-no-candidate.png`. PRETRADE was verified at `http://127.0.0.1:8788`. Storage was writable and the run store had no competing writer lock. The selected image's SHA-256 matched the original run's chart hash.

| Evidence | Result |
|---|---|
| New runId | `ba33d656-fc87-4857-94c0-91af5d64164c` |
| Real production Responses request | Confirmed; no injected transport or mock in live command |
| Provider | `openai`, version 1 |
| Model requested / resolved | `gpt-5.6-sol` / `gpt-5.6-sol` |
| Response status | `completed` |
| Safe request ID | `req_a5939598380748589b9fe28d80dfff5e` |
| Safe response ID | `resp_098130a48518334b016aa70b8ed26c87d19646e6419e4daeba` |
| Required web search | PASS; 1 web-search call, 16 extracted source URLs |
| Authorized image input | PASS; 1 chart |
| Strict transport/schema validation | PASS |
| Section-order validation | PASS; durable content has the exact canonical 19-ID sequence |
| Local semantic/provenance validation | PASS under current implemented checks; zero candidate-specific cases |
| Provider-result durability | PASS; artifact SHA-256 verified against journal reference |
| Provider-result SHA-256 | `62a05cd731631b156178e3a253e599763cf9c14f62bc4c06787c15454e606bc4` |
| Fresh PRETRADE checks | PASS; post-provider snapshot recorded, followed by the implemented fresh pre-terminal comparison |
| Publication fence | Not exercised: zero-candidate path makes no publication attempt |
| Candidates | 0 |
| Publication | `null`; candidate inbox remained empty |
| Terminal durable stage | `NO_CANDIDATES` |
| Live readiness | `liveAcceptanceValidated: true` for this provider/model and Gate V store |
| Gate V | PASS |

The final PRETRADE comparison occurs after PREPARED and before NO_CANDIDATES. Its relevant-candidate fingerprint covers an empty set for this run. This evidence does not claim live candidate publication or nonempty-candidate stale-state detection; those remain covered by the offline fence/recovery tests.

Durable journal sequence (UTC):

| Stage | Timestamp |
|---|---|
| CLAIMED | 2026-09-13T20:46:05.489Z |
| PROVIDER_REQUEST_STARTED | 2026-09-13T20:46:05.521Z |
| PROVIDER_RESULT_DURABLE | 2026-09-13T20:46:38.303Z |
| PRETRADE_SNAPSHOT_ACQUIRED | 2026-09-13T20:46:38.323Z |
| PREPARED | 2026-09-13T20:46:38.344Z |
| NO_CANDIDATES | 2026-09-13T20:46:38.356Z |

All six journal hashes and chain links verified. Acceptance recorded at `2026-09-13T20:46:38.368Z`.

Durable acceptance receipt: `/Users/stevenhirsch/.executionos/v24/gate-v/runs/acceptance-b540375c4b9ab6e1ad9a0285fa335378b09d8273f663d98c8cd4e000c5bdeaa4.json`.

Sanitized command output and verification: `/tmp/sod-order-correction/live.log` and `/tmp/sod-order-correction/verified-evidence.json`. Runtime evidence and chart bytes remain outside Git; this report contains no credentials or raw provider prose.

## Complete acceptance matrix

| Gate | Scope | Status |
|---|---|---|
| A | Candidate identity unchanged | PASS |
| B | Artifact URL safety | PASS |
| C | Chart limits | PASS |
| D | Provider request/response limits | PASS |
| E | Duplicate-aware parsing | PASS |
| F | Exact local schema | PASS |
| G | Run identity | PASS |
| H | sourceDate single-flight | PASS |
| I | Provider-result durability | PASS |
| J | Ambiguous provider outcome | PASS |
| K | Post-provider PRETRADE freshness | PASS |
| L | Pre-publication authority fence | PASS — offline validation |
| M | Recovery freshness | PASS |
| N | Publication crash windows | PASS |
| O | Lost HTTP response | PASS |
| P | Readiness | PASS |
| Q | Error sanitization | PASS |
| R | Existing SOD regression | PASS |
| S | Manual-ingestion regression | PASS |
| T | PRETRADE/downstream regression | PASS |
| U | Full production build | PASS |
| V | Credentialed OpenAI acceptance | PASS — second attempt |

## Preserved first failure and known limitation

The original run `cd86ce30-eb51-4ee0-acf3-5d04a290b53c` remains FAILED with `SOD_OPENAI_ARTIFACT_SECTION_ORDER_INVALID`. All three original journal files remain byte-identical to the investigation hashes. It was not deleted, rewritten, abandoned, or retried. The Gate V store contains exactly the original failed run and the new successful run. No third live request occurred.

**Known post-V1 hardening item:** correctly positioned IDs can still carry semantically inappropriate free-text titles or blocks. This prompt correction does not implement general semantic prose classification and does not represent that limitation as solved.

Broker authority remains READ ONLY. Performance Intelligence remains out of scope. No commit or push occurred. Stop here for review of the complete uncommitted implementation before establishing its implementation checkpoint.
