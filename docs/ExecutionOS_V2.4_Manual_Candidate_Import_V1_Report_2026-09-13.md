# ExecutionOS V2.4 — Production V1 manual candidate import

2026-09-13. **Implemented and verified offline. A–U remain PASS. No commit or push. Gate V was not run.**

## 1. Investigation result

Investigation was completed and reported before edits. The starting worktree contained the uncommitted Production SOD provider and Decision 28 implementation at HEAD `e0543be3cf0cffa246f03ca427aca17523790291`.

| Question | What already existed |
|---|---|
| Direct single-candidate file import | The canonical HTTP endpoint accepted a JSON bundle, not an unwrapped candidate file. A bundle containing exactly one candidate was already valid. There was no normal browser file-import control. |
| Canonical endpoint | `POST /api/candidates/import` called `PreTradeCandidateIngress.importBundle()`, followed by existing validity/OCO reconciliation. It required source, bundleId, candidates and a recognized ingress policy. |
| Standalone wrapping | An unwrapped canonical card needed a thin bundle wrapper. Existing canonical bundles could be submitted without changing their candidate content. |
| Existing UI | Navigation exposed PRETRADE, Execution, and SOD, with PRETRADE still the default. SOD had image upload, chart generation and run results. It had no candidate JSON picker, drag/drop, paste, preview or import-result surface. |
| Existing manual intake | `manual-sod-ingestion.mjs` already handled both `MANUAL_SOD` and `MANUAL_STANDALONE_TRADE_CARD` through a filesystem proposal inbox, preflight, durable submission processing and Candidate Feeder. It was not limited to full SOD packages. |
| Standalone export schema | `buildManualSodIngestionEnvelope()` already produced ingestion schema 1, a submission identity/type/preparation timestamp, `SOD_A_PLUS_TRADES`, sourceDate, bundleId, validity defaults, and candidates. For standalone trade cards it enforced one candidate. Canonical schema/version/time fields were materialized by the existing manual preflight and lineage step. |
| Canonical authority | Manual canonical proposals already received the same normalization, identity/version checks, WAITING admission, Decision 28 manifest, immutable content hash, and downstream lifecycle as automated proposals. |
| Decision 28 restrictions | System/runtime roots were already rejected by presence in canonical ingress and manual-envelope validation. Optional contract content and own special JSON keys were protected by the shared admission-domain hash. |
| Source semantics | Existing ad-hoc candidate tests used `AD_HOC_CHATGPT`; the approved manual SOD/standalone envelope fixed its source to `SOD_A_PLUS_TRADES`. Canonical admission required candidate source to match the bundle. No new source enum was needed. |
| Results | Backend responses already provided ACCEPTED/WAITING, DUPLICATE, CONFLICT, STALE, REJECTED and ACTION_REQUIRED, plus structured authority/integrity errors. Those outcomes were not exposed in an operator-facing import UI. |

Candidate Feeder's byte-preserving delivery/verification path, the existing manual filesystem workflow, canonical ingress, lifecycle, ARM and Execution implementations did not need redesign.

## 2. Gap identified

The gap was **UI, standalone wrapping, result presentation, and a narrow adapter for the existing exported manual envelope**. The canonical backend already admitted one-candidate bundles correctly.

An exported manual envelope could not be posted directly to canonical ingress because its existing schema deliberately omits canonical contract version/generated time and delegates those decisions to manual preflight/lineage. The new adapter invokes that existing code; it does not invent a second candidate schema or hash path.

## 3. Implementation

Added an **Import Candidate JSON** panel in the SOD workspace beside the existing chart-generation workflow. It uses the existing PRETRADE client/connection and is independent of SOD provider readiness.

The panel supports one `.json` file, pasted JSON, and drag/drop. It parses locally and shows symbol, direction, setup, trigger, structural invalidation, targets, source, sourceDate, supplied candidateId and applicable contractVersion before submission. The preview explicitly identifies local syntax parsing; canonical validation remains server-side.

Three existing input forms are supported:

- A standalone canonical candidate is wrapped into `{ source, bundleId, ingressPolicy: MANUAL_AUTHORIZED, candidates: [candidate] }`. The original candidate object is preserved. The bundleId is deterministic delivery metadata derived from the supplied candidateId/version; it does not generate or change candidate identity. The wrapper uses the supplied source or the already-used `AD_HOC_CHATGPT` ad-hoc label. Canonical cards require an explicit candidateId and positive integer contractVersion.
- A one-candidate canonical manual bundle is forwarded with its parsed metadata/content unchanged. This manual UI requires `MANUAL_AUTHORIZED`; it does not silently change a supplied policy or permit automated supersession through the manual control. An automated-policy or policy-less bundle receives a clear local error. This leaves the existing automated import path unchanged.
- An existing one-candidate manual envelope is forwarded intact to `POST /api/candidates/manual-import`. This small adapter uses `preflightManualSubmission()` and then the same canonical `importBundle()`. It preserves the envelope's fixed SOD source and existing lineage/version rules. There is no mandatory user schema translation and no second candidate repository.

The envelope adapter rejects invalid preflight results. Valid NEW/UNCHANGED/REVISED proposals proceed to canonical ingress under `MANUAL_AUTHORIZED`. A replacement without an exact durable approval returns ACTION_REQUIRED; a replacement with an existing exact approval can be accepted and consume that approval. The adapter never creates a review, authorizes a replacement, or grants ARM. The browser exposes the review requirement and keeps the existing review/authorization process in place.

The UI displays canonical outcomes and reasons, identifies WAITING as the state at admission, and provides **Open PRETRADE** for current state and subsequent actions. It does not imply that an expired candidate remains active. Incomplete server responses cannot appear as confirmed imports. Delivery uncertainty is reported without an automatic retry or new candidate identity; retrying the same contract follows canonical duplicate semantics. Refresh failure does not erase a confirmed import result.

Input protection includes:

- JSON-only file extension and actual JSON syntax; no executable modules, eval, or HTML injection.
- 768 KiB input ceiling before file reading, 1 MiB wrapped request ceiling, depth 48, 25,000 value nodes, 500 object entries, 5,000 array elements, and 64 KiB string/value bounds.
- Decoded duplicate-key rejection, finite numbers, safe own JSON property preservation, and escaped text rendering.
- Original authority fields are not stripped or trusted by the UI; PRETRADE rejects them with its existing fail-closed errors.
- No browser-controlled filesystem path, extra service URL from JSON, raw input persistence, secret logging or stack/path error display.
- The envelope API reuses the existing bounded duplicate-aware manual JSON parser, local-origin rules and canonical request-size boundary.

No new dependency, candidate semantic schema, runtime authority, publication rule, candidate hash implementation, or identity algorithm was introduced. The existing filesystem manual intake/feeder remains available and unchanged; this UI uses direct canonical HTTP admission and its canonical journal/result rather than filesystem submission receipts.

## 4. Manual workflow

1. Open **SOD → Import Candidate JSON**.
2. Select/drop one `.json` file or paste JSON. Use a canonical standalone ad-hoc card, a one-candidate manual canonical bundle, or the existing standalone trade-card envelope.
3. Review the parsed candidate preview. File input previews automatically; pasted input uses **Preview JSON**. Editing invalidates the old preview.
4. Select **Import into PRETRADE**. For a valid new contract, canonical ingress creates the Decision 28 manifest and returns **ACCEPTED · WAITING at admission**.
5. Read any duplicate, conflict, invalid/authority/integrity error, or supersession-review result. Existing candidates are never silently overwritten. Complete any required replacement review through the existing PRETRADE review/authorization process.
6. Select **Open PRETRADE**. The candidate follows the existing trigger/structural-validity → permission/risk → manual ARM → Execution Board handoff path. Import itself does not ARM or create an Execution Board trade.

The automatic chart → OpenAI SOD workflow remains independently available. Manual parsing/import requires no OpenAI credential or live-provider validation; it requires PRETRADE connectivity at submission time.

## 5. Exact files changed in this task

These are the changes relative to the already-uncommitted provider/Decision 28 worktree, not the cumulative branch diff:

| File | Change |
|---|---|
| [schwab-bridge/pretrade-candidate-api.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/pretrade-candidate-api.mjs) | Registers the narrow manual-envelope route and selects its existing strict parser; canonical import and reconciliation remain shared. |
| [src/App.jsx](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/App.jsx) | Passes existing PRETRADE state/client and workspace navigation to SOD. |
| [src/components/SodWorkspace.jsx](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/components/SodWorkspace.jsx) | Renders the separate manual import panel; chart generation remains intact. |
| [src/pretrade/pretrade-api-client.js](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/pretrade/pretrade-api-client.js) | Adds canonical-bundle and manual-envelope import requests. |
| [schwab-bridge/pretrade-manual-import.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/pretrade-manual-import.mjs) | Thin single-envelope adapter using existing preflight, lineage and canonical ingress. |
| [src/components/ManualCandidateImport.jsx](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/components/ManualCandidateImport.jsx) | File/paste/drop, preview, guarded submit, outcome display and PRETRADE navigation. |
| [src/pretrade/manual-candidate-import.js](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/pretrade/manual-candidate-import.js) | Bounded safe JSON parser, deterministic wrapper, file reader and result/error presentation helpers. |
| [tests/browser/manual-candidate-import.spec.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/browser/manual-candidate-import.spec.mjs) | Ten focused browser cases for the actual SOD/manual UI. |
| [tests/browser/manual-import-harness.html](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/browser/manual-import-harness.html) | Browser harness document. |
| [tests/browser/manual-import-harness.jsx](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/browser/manual-import-harness.jsx) | Real SOD/manual components with test PRETRADE transport and controlled SOD state. |
| [tests/helpers/manual-candidate-fixture.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/helpers/manual-candidate-fixture.mjs) | Synthetic canonical ad-hoc test fixture. |
| [tests/manual-candidate-import.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/manual-candidate-import.test.mjs) | Eleven focused parser/wrapper and real HTTP ingress cases. |
| [docs/ExecutionOS_V2.4_Manual_Candidate_Import_V1_Report_2026-09-13.md](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/docs/ExecutionOS_V2.4_Manual_Candidate_Import_V1_Report_2026-09-13.md) | This nine-section final report. |

The earlier uncommitted implementation was preserved. Of files already changed before this task, only `src/components/SodWorkspace.jsx` received further edits. No existing test assertions or fixtures were weakened. Frozen design/handoff documents and the previous reports were not modified.

## 6. Tests

| Exact command | Final result | Evidence |
|---|---|---|
| `node --test tests/manual-candidate-import.test.mjs` | PASS — 11/11, 0 failed/skipped | [log](/tmp/sod-manual-v1/focused.log) |
| `node --test tests/manual-candidate-import.test.mjs tests/pretrade-admission-integrity.test.mjs tests/pretrade-candidate-*.test.mjs` | PASS — 102/102, 0 failed/skipped | [log](/tmp/sod-manual-v1/candidate-tests.log) |
| `npm run v24:manual-ingestion-test` | PASS — 69/69, 0 failed/skipped | [log](/tmp/sod-manual-v1/manual-regression.log) |
| `npm run v24:sod-orchestrator-test` | PASS — 153/153, 0 failed/skipped | [log](/tmp/sod-manual-v1/sod-regression.log) |
| `npm run analytics:test` | PASS — 1074/1074, 0 failed/skipped | [log](/tmp/sod-manual-v1/full.log) |
| `npm run v24:router-browser-test -- --output=/tmp/sod-manual-v1/browser-results-final` | PASS — 25/25 (10 new, 15 existing) | [log](/tmp/sod-manual-v1/browser.log) |
| `npm run build` | PASS — 1,626 modules transformed | [log](/tmp/sod-manual-v1/build.log) |
| `git diff --check` | PASS | Final diff checked |

The combined candidate run includes all 45 Decision 28 tests. Full regression contains the previous 1,063 tests plus 11 new tests = 1,074. Existing manual and SOD package results remain 69/69 and 153/153.

Focused coverage verifies valid standalone HTTP admission, ACCEPTED/WAITING, manifest creation, optional and nested special-key protection, restart, all 56 Decision 28 root prohibitions, no ARM/handoff state, duplicate/conflict/newer-version behavior, existing standalone envelope compatibility, malformed/duplicate JSON, and both unapproved and already-approved supersession paths. Browser tests cover file/paste/drop, required preview fields, editing invalidation, malformed and oversized inputs, executable-file refusal, escaped embedded markup, canonical outcomes, authority/integrity errors, response completeness, existing envelope routing, SOD-offline manual use, and continued chart generation.

The rendered synthetic preview was visually inspected: readable field labels, preserved structured values, distinct manual/automated sections, and an explicit import action. [Preview image](/tmp/sod-manual-v1/manual-preview.png).

One browser run reported `Execution context was destroyed` during the pre-existing cross-tab test's navigation/setup while a build was also running; 24/25 tests passed in that run. The unchanged complete suite was rerun alone and passed 25/25. No test/runtime workaround was added. [Preserved initial log](/tmp/sod-manual-v1/browser-first-25.log). An earlier harness stylesheet-path typo was corrected before successful browser validation.

## 7. Regression status

**A–U remain PASS.** Existing provider hardening, run integrity, publication, manual ingestion, canonical candidates, Decision 28, PRETRADE/downstream behavior, browser authority tests and build are green in the current source tree. The automated SOD UI remains available, and a browser test explicitly exercises its generation control beside manual intake.

**Gate V was not run**, as explicitly instructed. No real OpenAI request occurred and no live acceptance evidence or new readiness claim was created. These offline results do not supersede the prior blocked live-acceptance status and do not constitute merge acceptance.

## 8. Authority compliance

- No alternate execution path or parallel manual-candidate repository.
- Candidate identity and contract-version rules unchanged; no identity regeneration to avoid conflicts.
- Decision 28 unchanged: same admission manifest, canonical own-key-safe hashing, optional substance protection, runtime-root prohibition and fail-closed integrity dispatch.
- Structural validity, permission/risk evaluation and manual ARM preserved.
- Supersession approval remains exact, durable PRETRADE authority; the new UI/adapter never grants it.
- Execution Board handoff and execution ownership unchanged. Import cannot directly create an Execution Board trade.
- Automated SOD provider and Candidate Feeder publication behavior unchanged.
- Broker remains **READ ONLY / NO BROKER WRITES**.
- Performance Intelligence untouched.

## 9. Git state

- Branch: `v24-sod-production-analysis-provider`.
- Starting and ending HEAD: `e0543be3cf0cffa246f03ca427aca17523790291`.
- Work remains **uncommitted**; no files staged and no commit created.
- No push, merge, rebase, amend, reset, stash or clean occurred.
- Previous provider and Decision 28 work remains present; the frozen design/handoff files are unchanged.

Work stops at this report. The live automated-provider acceptance remains a separate user-directed step.
