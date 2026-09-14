# Decision 28 implementation and Production SOD acceptance report

2026-09-12. **Offline A–U PASS; live V BLOCKED. Uncommitted. No implementation or merge acceptance is claimed.**

This report supersedes the earlier provider-only status for current results. The approved Production SOD baseline and implementation handoff are unchanged. The user-authorized Decision 28 supplies the corrective authority for this continuation.

## 1. Repository state

- Branch: `v24-sod-production-analysis-provider`.
- Starting HEAD: `e0543be3cf0cffa246f03ca427aca17523790291`.
- Ending HEAD: `e0543be3cf0cffa246f03ca427aca17523790291`.
- Commit created: **no**; commit SHA: none. Nothing staged.
- No push, merge, rebase, amend, reset, stash, clean, or accepted-history rewrite occurred.
- The 38-file uncommitted provider state was preserved before implementation. The final working tree contains 49 changed/untracked files, including both reports. Among previously changed implementation files, only `sod-analysis-provider.mjs` received Decision 28 code additions. The earlier status report receives a current-status pointer; its historical findings remain intact.
- All six original regression-group files remain byte-identical to their pre-Decision-28 state. The original provider work and fixture corrections were retained.

## 2. Decision 28 implementation

Canonical ingress normalizes the proposal, hashes that normalized JSON, and constructs the complete admitted record before adding it to the state. The final assembled candidate is integrity-verified before it can be saved. Existing rollback and same-directory temporary-file/rename persistence remain in place.

The new representation is:

```text
candidateIntegrityVersion: 1
contractAuthority:
  authority: CANONICAL_CANDIDATE_INGRESS
  schemaVersion: 2
  contentHash: original admitted hash H
  bundleSource, bundleId, acceptedAt
  integrity:
    version: 1
    mode: ADMISSION | LEGACY_PROOF
    roots: exact sorted unique normalized top-level JSON property names
    binding:
      candidateId, contractVersion, schemaVersion, authority, contentHash
      bundleSource, bundleId, acceptedAt
    manifestHash: SHA-256 of canonical integrity body excluding manifestHash
```

The candidate semantic `schemaVersion`, `contractVersion`, and original `contentHash` retain their existing meanings. The integrity format is separately versioned. A system-owned top-level version marker and the acceptance event's version/manifest digest provide independent dispatch and consistency anchors. New admissions retain the existing acceptance operation identity and original candidate-hash provenance.

Each manifest root protects its entire nested JSON subtree. Projection uses own properties selected by the admitted manifest. Unknown optional roots are retained; neither normalization nor verification replaces the contract with a business-field allowlist. Missing roots, nested insertions/deletions/changes, altered identity/version/schema, malformed metadata, unsupported versions, contradictory admission anchors, and downgrade attempts fail closed. Authority and integrity objects use closed structural shapes; roots must already be sorted and unique. Verification runs on raw persisted candidates before load normalization, and at canonical use, including validity evaluation.

The manifest and runtime roots are outside substantive hashing. Ordinary normalized contracts have the same H they had before this correction. An unregistered, newly added top-level runtime root does not enlarge the admitted domain. A runtime root that collides with an admitted root fails ownership validation; a future writer can invoke `assertCandidateRuntimeRootOwnership()` before mutation. Current registered-root collisions are rejected during manifest validation. Changing nested admitted content remains an integrity error even when a caller describes it as runtime.

A shared frozen ingress registry contains the original 50 system/exclusion roots, all five newly identified runtime roots, and the integrity-version marker: **56 roots**. Canonical ingress, provider proposals, manual ingestion, and Candidate Feeder reject these by presence, including null, false, objects and arrays. The generic export adapter preserves its previously accepted exact `WAITING` and `armAuthorized: false` proposal-intent placeholders; it consumes these before emitting a canonical proposal. Other values for those placeholders and every other system root are rejected. This adapter convention does not confer runtime authority. No recursive ban of inert analytical names was introduced.

`canonicalCandidateContent()` and `candidateContractHash()` dispatch to the admitted projection for new records. Lineage and manual supersession/review already consume this shared projection, so their intentional generated-time/version exclusions remain unchanged. Manual review equality and diff construction now use own-key-safe comparison, including distinguishing an absent `constructor`/`prototype` property from an inherited JavaScript property.

The shared canonical JSON helper uses `Object.fromEntries()` over sorted own keys. It preserves top-level and nested `__proto__`, `constructor`, `prototype`, array order, and missing-versus-null distinctions without altering prototypes. It replaces the unsafe contract/state, ingress-comparison, and manual-ingestion helpers. Runtime operation/evidence-specific helpers outside candidate contract comparison were audited but not redesigned.

## 3. Exact files changed

### Production SOD implementation already present

- [package.json](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/package.json)
- [schwab-bridge/sod-analysis-provider.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-analysis-provider.mjs)
- [schwab-bridge/sod-artifact-content.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-artifact-content.mjs)
- [schwab-bridge/sod-artifact-renderer.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-artifact-renderer.mjs)
- [schwab-bridge/sod-candidate-publisher.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-candidate-publisher.mjs)
- [schwab-bridge/sod-chart-store.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-chart-store.mjs)
- [schwab-bridge/sod-openai-analysis-provider.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-openai-analysis-provider.mjs)
- [schwab-bridge/sod-openai-production-provider.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-openai-production-provider.mjs)
- [schwab-bridge/sod-orchestration-api.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-orchestration-api.mjs)
- [schwab-bridge/sod-orchestration-core.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-orchestration-core.mjs)
- [src/components/SodWorkspace.jsx](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/components/SodWorkspace.jsx)
- [src/hooks/useSodOrchestration.js](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/hooks/useSodOrchestration.js)
- [src/sod/sod-orchestration-api-client.js](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/src/sod/sod-orchestration-api-client.js)
- [schwab-bridge/sod-live-acceptance.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-live-acceptance.mjs)
- [schwab-bridge/sod-production-run.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-production-run.mjs)
- [schwab-bridge/sod-provider-validation.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-provider-validation.mjs)
- [schwab-bridge/sod-run-store.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-run-store.mjs)

`sod-analysis-provider.mjs` also imports the shared Decision 28 root registry and includes it in provider proposal prohibition; its earlier provider implementation remains intact.

### Decision 28 production/helper changes

- [schwab-bridge/candidate-integrity-roots.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/candidate-integrity-roots.mjs)
- [schwab-bridge/canonical-json.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/canonical-json.mjs)
- [schwab-bridge/pretrade-candidate-contract.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/pretrade-candidate-contract.mjs)
- [schwab-bridge/pretrade-candidate-ingress.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/pretrade-candidate-ingress.mjs)
- [schwab-bridge/pretrade-state.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/pretrade-state.mjs)
- [schwab-bridge/manual-sod-ingestion.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/manual-sod-ingestion.mjs)
- [schwab-bridge/candidate-feeder.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/candidate-feeder.mjs)
- [schwab-bridge/sod-analysis-provider.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-analysis-provider.mjs)
- [schwab-bridge/sod-candidate-export.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/schwab-bridge/sod-candidate-export.mjs)

### Tests

New Decision 28 test file:

- [tests/pretrade-admission-integrity.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-admission-integrity.test.mjs)

Already-present Production SOD tests and shared fixture:

- [tests/sod-openai-analysis-provider.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-openai-analysis-provider.test.mjs)
- [tests/sod-openai-production-provider.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-openai-production-provider.test.mjs)
- [tests/sod-orchestration-api-safety.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-orchestration-api-safety.test.mjs)
- [tests/sod-orchestration-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-orchestration-api.test.mjs)
- [tests/sod-orchestration-client.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-orchestration-client.test.mjs)
- [tests/helpers/sod-openai-fixture.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/helpers/sod-openai-fixture.mjs)
- [tests/sod-live-acceptance.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-live-acceptance.test.mjs)
- [tests/sod-provider-hardening.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-provider-hardening.test.mjs)
- [tests/sod-run-integrity.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/sod-run-integrity.test.mjs)

### Fixture-only corrections

Already present before this continuation:

- [tests/execution-v24-pretrade-full-e2e.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/execution-v24-pretrade-full-e2e.test.mjs)
- [tests/pretrade-arm-lifecycle-authority.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-arm-lifecycle-authority.test.mjs)
- [tests/pretrade-arm-service.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-arm-service.test.mjs)
- [tests/pretrade-blocked-handoff-retirement.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-blocked-handoff-retirement.test.mjs)
- [tests/pretrade-candidate-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-candidate-api.test.mjs)
- [tests/pretrade-lifecycle-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-lifecycle-api.test.mjs)
- [tests/pretrade-permission-pipeline.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-permission-pipeline.test.mjs)
- [tests/pretrade-trigger-api.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-api.test.mjs)
- [tests/pretrade-trigger-engine.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-engine.test.mjs)
- [tests/pretrade-trigger-persistence.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-trigger-persistence.test.mjs)
- [tests/pretrade-validity-lifecycle.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/pretrade-validity-lifecycle.test.mjs)

Those prior corrections supply required ingress policies, remove prohibited lifecycle/ARM fields from a canonical API fixture, supply the required management contract, and pin the candidate API fixture clock within its declared validity. Decision 28 did not modify these files further.

New fixture-only correction:

- [tests/candidate-feeder.test.mjs](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/tests/candidate-feeder.test.mjs)

The feeder proposal fixture no longer supplies top-level `status`, top-level `armAuthorized`, or nested `armPolicy.armAuthorized`. These were already prohibited by canonical admission. Byte-for-byte posting, receipts, quarantine, retries, ordering, and all behavioral assertions are unchanged.

### Reports

- [docs/ExecutionOS_V2.4_Production_SOD_Provider_Implementation_Status_2026-09-12.md](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/docs/ExecutionOS_V2.4_Production_SOD_Provider_Implementation_Status_2026-09-12.md)
- [docs/ExecutionOS_V2.4_Decision_28_Implementation_Report_2026-09-12.md](/Users/stevenhirsch/Documents/GitHub/structure-based-trade-management-v24-sod-production-analysis-provider/docs/ExecutionOS_V2.4_Decision_28_Implementation_Report_2026-09-12.md)

No frozen design, handoff, historical accepted checkpoint documentation, broker module, execution module, or Performance Intelligence source was edited.

## 4. Legacy compatibility

**A narrow explicit, pure upgrade boundary was implemented:** `upgradeLegacyCanonicalCandidateIntegrity(candidate)`. It returns an upgraded clone. It is not called by reads, store load, ordinary ingress, or runtime recovery, and no persisted user candidate was migrated in this task. There is no migration CLI, service endpoint, archive search, or automatic writeback.

Ordinary v1 canonical verification retains the frozen original 50-root exclusion rule. That list is deliberately separate from the evolving ingress ownership registry. No five-field runtime patch is applied to legacy hashes. Reads do not create manifests. Unsupported authority versions and historically ambiguous `__proto__` substance fail closed.

An explicit upgrade must first pass legacy integrity against the original stored H. It then requires an exact retained acceptance event and operation, matching candidate ID/version, original H, source, bundle, admission timestamp, event linkage, original operation identity, operation fingerprint, and initial WAITING/revision-0 result. The deterministic frozen projection must retain every non-runtime root. A currently system-owned root inside that projection is rejected, as is any historical own `__proto__` anywhere in its substantive tree. The latter is rejected even when a reproduced old incomplete hash still matches.

The returned clone changes only the system integrity marker and `contractAuthority` format/metadata. Original hash, candidate ID/version/schema, lifecycle state, state revision, lifecycle journal, imported history, and runtime fields remain unchanged. Ordinary correctly hashed JSON has the same digest under the repaired canonicalizer. No hashes are rewritten, no fields are repeatedly stripped to force a match, and no current mutable object is accepted without proof.

Legacy records already containing formerly unexcluded runtime fields may fail the original hash rule and cannot be upgraded by this narrow boundary. Missing proof, contradictory proof, ownership collisions, unsupported formats, and special-key ambiguity remain fail-closed. No retained-artifact migration route was necessary for the gates and none was invented.

## 5. Original 17 regression result

All 17 previously failing cases are green, with their original assertions unchanged. The complete affected groups contain 31 tests:

| Command / group | Result | Evidence |
|---|---|---|
| `node --test tests/pretrade-trigger-engine.test.mjs` | PASS — 6/6, 0 failed | [log](/tmp/sod-decision28/pretrade-trigger-engine.log) |
| `node --test tests/pretrade-trigger-api.test.mjs` | PASS — 4/4, 0 failed | [log](/tmp/sod-decision28/pretrade-trigger-api.log) |
| `node --test tests/pretrade-trigger-persistence.test.mjs` | PASS — 4/4, 0 failed | [log](/tmp/sod-decision28/pretrade-trigger-persistence.log) |
| `node --test tests/pretrade-validity-lifecycle.test.mjs` | PASS — 6/6, 0 failed | [log](/tmp/sod-decision28/pretrade-validity-lifecycle.log) |
| `node --test tests/pretrade-lifecycle-api.test.mjs` | PASS — 9/9, 0 failed | [log](/tmp/sod-decision28/pretrade-lifecycle-api.log) |
| `node --test tests/pretrade-blocked-handoff-retirement.test.mjs` | PASS — 2/2, 0 failed | [log](/tmp/sod-decision28/pretrade-blocked-handoff-retirement.log) |

## 6. New Decision 28 tests

`node --test tests/pretrade-admission-integrity.test.mjs`: **45/45 PASS**, zero failures/skips. The parameterized ingress case exercises all 56 roots with null, false, empty-object and empty-array values across the relevant boundaries; it is one reported Node test, not hundreds of separately counted tests.

Every new case is listed below. Labels A–L here refer to the user's Decision 28 test requirements, not the Production SOD acceptance matrix.

| # | New case | Result |
|---|---|---|
| 1 | A: admission records exact normalized sorted roots, version and bound original hash atomically | PASS |
| 2 | B: AD_HOC_CHATGPT optional roots protect full nested values, insertions, deletions and null | PASS |
| 3 | B: SOD_A_PLUS_TRADES optional roots protect full nested values, insertions, deletions and null | PASS |
| 4 | C/D/L: real trigger progress, second evidence, permission, expiration and terminal state survive restart with H | PASS |
| 5 | C/G: unregistered new runtime roots do not enlarge domain; ownership collision fails before writing | PASS |
| 6 | E: immutable tampering fails for symbol | PASS |
| 7 | E: immutable tampering fails for direction | PASS |
| 8 | E: immutable tampering fails for trigger | PASS |
| 9 | E: immutable tampering fails for structuralInvalidation | PASS |
| 10 | E: immutable tampering fails for targets | PASS |
| 11 | E: immutable tampering fails for managementContract | PASS |
| 12 | E: immutable tampering fails for validity | PASS |
| 13 | E: immutable tampering fails for extension | PASS |
| 14 | F: all system roots reject by presence at canonical, manual, feeder, provider and export boundaries | PASS |
| 15 | F: direct candidate HTTP API rejects forged new runtime roots without admission | PASS |
| 16 | H: own special keys survive admission and every substantive change is hashed: {"__proto__":{"x":1}} | PASS |
| 17 | H: own special keys survive admission and every substantive change is hashed: {"extension":{"__proto__":{"x":1},"constructor":1,"prototype":[{"__proto__":null}]}} | PASS |
| 18 | I/L: missing manifest fails on projection, verification and load | PASS |
| 19 | I/L: duplicate admission anchors fails on projection, verification and load | PASS |
| 20 | I/L: unknown authority member fails on projection, verification and load | PASS |
| 21 | I/L: missing binding fails on projection, verification and load | PASS |
| 22 | I/L: admission provenance mismatch fails on projection, verification and load | PASS |
| 23 | I/L: missing roots fails on projection, verification and load | PASS |
| 24 | I/L: duplicate roots fails on projection, verification and load | PASS |
| 25 | I/L: unsorted roots fails on projection, verification and load | PASS |
| 26 | I/L: unsupported version fails on projection, verification and load | PASS |
| 27 | I/L: modified manifest fails on projection, verification and load | PASS |
| 28 | I/L: contradictory hash fails on projection, verification and load | PASS |
| 29 | I/L: identity mismatch fails on projection, verification and load | PASS |
| 30 | I/L: version mismatch fails on projection, verification and load | PASS |
| 31 | I/L: schema mismatch fails on projection, verification and load | PASS |
| 32 | I/L: authority mismatch fails on projection, verification and load | PASS |
| 33 | I/L: downgrade fails on projection, verification and load | PASS |
| 34 | I/L: missing authority fails on projection, verification and load | PASS |
| 35 | I/L: missing acceptance anchor fails on projection, verification and load | PASS |
| 36 | I/L: changed domain with recomputed metadata fails on projection, verification and load | PASS |
| 37 | J: explicit proof upgrade preserves hash, ID, version, revision, runtime and journal; reads do not upgrade | PASS |
| 38 | J/G: tampered, unbound, unsupported, colliding and ambiguous old records never upgrade | PASS |
| 39 | K: lineage and supersession review use admitted domain after runtime history and protect special keys | PASS |
| 40 | L: failed admission save rolls back candidate and metadata together; restart retains only prior authority | PASS |
| 41 | C/K: ARM and blocked-handoff retirement preserve H, journal and downstream proof across restart | PASS |
| 42 | J/H: a matching historical incomplete __proto__ hash is insufficient proof for upgrade | PASS |
| 43 | J: contradictory retained legacy admission operation fails explicit upgrade | PASS |
| 44 | K: real supersession retains prior manifest and H with supersession runtime history | PASS |
| 45 | L: failure after temporary file write cannot commit partial admission on restart | PASS |

[Exact corrective test output](/tmp/sod-decision28/adversarial-tests.log). The tests also exercise each nested special key independently, absent own-property review flags, contradictory legacy operation hashes, real DSS provenance, second trigger evidence, terminal reload, and a complete uncommitted temporary file that restart must ignore.

## 7. Acceptance matrix A–V

| Gate | Status | Direct evidence |
|---|---|---|
| A — Candidate identity unchanged | PASS | OpenAI/provider identity rejection and deterministic export/lineage tests |
| B — Artifact URL safety | PASS | Provider hardening and renderer tests |
| C — Chart limits | PASS | 17-chart rejection before resolution; 16/32 MiB boundary and incremental overflow |
| D — Provider resource ceilings | PASS | Request, raw response, structured output, depth/node/key/array/string tests |
| E — Duplicate-aware parsing | PASS | Root/nested/array-object decoded duplicate rejection |
| F — Exact local schema | PASS | Missing/additional/type/enum/nested/bounds and semantic/provenance checks |
| G — Run identity | PASS | Durable claim, request-hash conflict, same-run replay |
| H — sourceDate single-flight | PASS | Concurrent delivery, shared writer, competing-run and startup-claim tests |
| I — Provider-result durability | PASS | Content-addressed result replay and tamper rejection |
| J — Ambiguous outcome | PASS | Provider-start crash/network uncertainty and explicit abandonment |
| K — Post-provider PRETRADE freshness | PASS | State mutation during provider work and fresh lineage |
| L — Pre-publication fence | PASS | Preparation/filesystem mutation fences and bounded recomputation |
| M — Recovery freshness | PASS | Restart fetches fresh PRETRADE; persisted snapshot is not current authority |
| N — Publication crash windows | PASS | Intent/file/commit/terminal crash recovery and conflicting-byte rejection |
| O — Lost response | PASS | One provider/publication with exact durable replay |
| P — Readiness | PASS | Missing key/model checks; live flag cannot be manufactured by ordinary generation |
| Q — Error sanitization | PASS | Provider/API/store tests for secrets, headers, paths and upstream bodies |
| R — Existing SOD regression | PASS | SOD files 166/166; orchestration package 153/153; export 13/13; feeder 49/49 |
| S — Manual ingestion | PASS | Manual-ingestion package 69/69 |
| T — PRETRADE and downstream | PASS | PRETRADE 262/262; full regression 1,063/1,063; browser 15/15; all downstream packages |
| U — Production build | PASS | npm run build PASS; 1,624 modules transformed |
| V — Credentialed OpenAI acceptance | BLOCKED | Required live configuration absent; no real request or acceptance evidence |

Gate V remains mandatory. The green offline matrix does not constitute overall implementation acceptance.

## 8. Full regression/build commands and exact results

Validation ran in the requested order: new/original corrective cases, all PRETRADE files, all SOD files, complete offline commands/build/browser checks, adversarial self-review, final verification after the proof checks, then live configuration inspection. Initial development failures and stale-fixture failures were corrected; the table contains final results, not an average or an earlier failing run.

| Phase command | Result | Evidence |
|---|---|---|
| `node --test tests/pretrade-admission-integrity.test.mjs tests/pretrade-trigger-engine.test.mjs tests/pretrade-trigger-api.test.mjs tests/pretrade-trigger-persistence.test.mjs tests/pretrade-validity-lifecycle.test.mjs tests/pretrade-lifecycle-api.test.mjs tests/pretrade-blocked-handoff-retirement.test.mjs` | PASS — 76/76, 0 failed/skipped | [log](/tmp/sod-decision28/phase1.log) |
| `node --test tests/pretrade-*.test.mjs` | PASS — 262/262, 0 failed/skipped | [log](/tmp/sod-decision28/phase2.log) |
| `node --test tests/sod-*.test.mjs` | PASS — 166/166, 0 failed/skipped | [log](/tmp/sod-decision28/phase3.log) |

The frozen handoff commands and downstream checklist commands:

| Command | Exact final result | Evidence |
|---|---|---|
| `node --test tests/sod-analysis-provider.test.mjs` | PASS — 5/5, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/01.log) |
| `node --test tests/sod-openai-analysis-provider.test.mjs` | PASS — 12/12, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/02.log) |
| `node --test tests/sod-openai-production-provider.test.mjs` | PASS — 5/5, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/03.log) |
| `node --test tests/sod-artifact-renderer.test.mjs` | PASS — 8/8, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/04.log) |
| `node --test tests/sod-orchestration-api.test.mjs` | PASS — 7/7, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/05.log) |
| `node --test tests/sod-orchestration-api-safety.test.mjs` | PASS — 2/2, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/06.log) |
| `node --test tests/sod-orchestration-core.test.mjs` | PASS — 3/3, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/07.log) |
| `node --test tests/sod-chart-store.test.mjs` | PASS — 5/5, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/08.log) |
| `node --test tests/sod-candidate-export.test.mjs` | PASS — 13/13, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/09.log) |
| `node --test tests/sod-candidate-lineage.test.mjs` | PASS — 11/11, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/10.log) |
| `node --test tests/sod-candidate-publisher.test.mjs` | PASS — 3/3, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/11.log) |
| `node --test tests/sod-provider-hardening.test.mjs` | PASS — 41/41, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/12.log) |
| `node --test tests/sod-run-integrity.test.mjs` | PASS — 31/31, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/13.log) |
| `node --test tests/sod-live-acceptance.test.mjs` | PASS — 2/2, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/14.log) |
| `npm run v24:sod-orchestrator-test` | PASS — 153/153, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/15.log) |
| `npm run v24:sod-export-test` | PASS — 13/13, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/16.log) |
| `npm run v24:candidate-feed-test` | PASS — 49/49, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/17.log) |
| `npm run v24:manual-ingestion-test` | PASS — 69/69, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/18.log) |
| `npm run v24:execution-ownership-test` | PASS — 25/25, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/19.log) |
| `npm run v24:market-data-test` | PASS — 11/11, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/20.log) |
| `npm run v24:dss-test` | PASS — 91/91, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/21.log) |
| `npm run v24:risk-sizing-test` | PASS — 170/170, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/22.log) |
| `npm run v24:handoff-test` | PASS — 34/34, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/23.log) |
| `npm run v24:handoff-api-test` | PASS — 7/7, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/24.log) |
| `npm run v24:broker-provenance-test` | PASS — 24/24, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/25.log) |
| `npm run v24:handoff-admission-test` | PASS — 16/16, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/26.log) |
| `npm run v24:v23-compat-test` | PASS — 13/13, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/27.log) |
| `npm run v24:v23-install-test` | PASS — 16/16, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/28.log) |
| `npm run v24:fill-ownership-test` | PASS — 24/24, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/29.log) |
| `npm run v24:retirement-test` | PASS — 17/17, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/30.log) |
| `npm run v24:activation-test` | PASS — 21/21, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/31.log) |
| `npm run v24:live-lifecycle-test` | PASS — 15/15, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/32.log) |
| `npm run v24:store-authority-test` | PASS — 23/23, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/33.log) |
| `npm run v24:runtime-router-test` | PASS — 46/46, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/34.log) |
| `npm run v24:router-hardening-test` | PASS — 1/1, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/35.log) |
| `npm run v24:full-lifecycle-e2e-test` | PASS — 1/1, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/36.log) |
| `node --test tests/execution-v24-live-management.test.mjs tests/execution-v24-slice7.test.mjs tests/execution-v24-slice7-final.test.mjs tests/execution-v24-retired-assignment.test.mjs tests/execution-v24-legacy-management-compat.test.mjs` | PASS — 26/26, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/37.log) |
| `node --test tests/execution-v24-pretrade-full-e2e.test.mjs` | PASS — 1/1, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/38.log) |
| `npm run analytics:test` | PASS — 1063/1063, 0 failed, 0 skipped | [log](/tmp/sod-decision28/offline/39.log) |
| `npm run build` | PASS — Vite build, 1,624 modules | [log](/tmp/sod-decision28/offline/40.log) |
| `npm run v24:router-browser-test -- --output=/tmp/sod-decision28/browser-results` | PASS — 15/15 | [log](/tmp/sod-decision28/browser.log) |

Browser launch used the required local Chromium permissions; no test/code workaround was introduced. The output option only directs generated browser artifacts outside the repository. `git diff --check` also passed. Full regression count is 1,018 pre-existing tests plus 45 new tests = 1,063. Tests invoking `analytics:test` exercise the repository's broad offline suite; no Performance Intelligence code or data was changed.

## 9. Live OpenAI acceptance

**Not executed; V BLOCKED. No real OpenAI request occurred.** Only the no-network configuration function was inspected after all offline gates passed. Required missing settings:

- `OPENAI_API_KEY`: server-side credential.
- `EXECUTIONOS_SOD_OPENAI_MODEL`: explicit production model.
- `EXECUTIONOS_SOD_RUN_STORE`: durable run-store directory.
- `EXECUTIONOS_SOD_CHART_STORE`: chart-store directory.
- `EXECUTIONOS_CANDIDATE_INBOX`: candidate publication inbox.
- `EXECUTIONOS_SOD_ACCEPTANCE_CHART`: operator-authorized non-sensitive raster.

The explicit opt-in flag is also unset. `EXECUTIONOS_PRETRADE_URL` is unset, but that setting has an existing loopback default and is not itself a required configuration failure; default service reachability was not tested because the required settings are absent. No secret values were read into output.

The prepared mandatory command remains:

```bash
EXECUTIONOS_SOD_LIVE_ACCEPTANCE=1 npm run v24:sod-live-acceptance
```

Its real path is the existing production OpenAI Responses provider plus chart store, durable run store, production runner, required web search, local structured-output validation, and fresh PRETRADE reader. It asks for zero candidates and rejects unexpected candidates before publication. Success would retain sanitized durable acceptance evidence. No mocked or transport-only result was substituted for V, no live evidence was manufactured, and no provider/run/publication fence was weakened.

The handoff requires evidence for all mandatory gates and does not expressly authorize a checkpoint with V blocked. Under the user's conditional checkpoint instruction, all work is left uncommitted. No push occurred.

## 10. Adversarial review

Defects and gaps corrected during the implementation/self-review:

1. Runtime additions were included in the old reconstructed contract domain: replaced by the admission manifest for new records, with the original hash preserved.
2. Fifty excluded roots and twenty-nine prohibited roots disagreed: one shared ingress ownership registry now covers all current roots by presence.
3. Ordinary-object canonicalization omitted own `__proto__` content: replaced with own-data-property construction in the relevant hashing/comparison helpers.
4. Review recursion could treat absent `constructor`/`prototype` as inherited values: own-presence reads now preserve accurate added/deleted review flags.
5. Metadata could otherwise be malformed or downgraded without strong dispatch: version marker, closed integrity shape, manifest digest, unique acceptance anchor, provenance checks and pre-normalization load verification now fail closed.
6. A constructed admission needed verification before persistence: the complete candidate/metadata record is now checked before insertion/save.
7. Legacy upgrade proof needed more than matching content: retained event and operation identity/fingerprint/result bindings are checked, and incomplete special-key hashes are explicitly rejected.
8. A stale feeder fixture bypassed already-required canonical proposal rules: removed only its forbidden authority placeholders; all behavioral assertions remained.

All eighteen requested review scenarios were checked:

| # | Scenario | Finding/evidence |
|---|---|---|
| 1 | New runtime root without registry update | H unchanged under an unregistered top-level root; registry does not define new-record projection |
| 2 | Optional admitted-field tampering | Full subtree insertion/change/deletion fails |
| 3 | Provider/manual forged runtime authority | Presence matrix across 56 roots plus real HTTP rejection |
| 4 | Runtime state after restart | Raw-load integrity validation; actual trigger/terminal/ARM history survives |
| 5 | Malformed/missing manifest | Corruption cases fail on projection, verification and load |
| 6 | Tampered legacy upgrade | Original hash and exact admission proof required |
| 7 | Special-key hashing | Own-key preservation, independent nested changes, no prototype mutation |
| 8 | Lifecycle root added after admission | Real activation/deactivation/expiration/terminal transitions preserve H |
| 9 | Manual versus SOD extensions | Open optional roots retained under both candidate sources; manual suite remains green |
| 10 | Supersession/retirement after history | Prior manifest/H retained through real supersession; blocked-handoff retirement reload passes |
| 11 | Trigger recovery | Second evidence/recovery after persisted triggerRuntime succeeds |
| 12 | Terminal verification | EXPIRED and RETIRED verify after restart |
| 13 | In-place contractVersion mutation | Identity binding and projection fail closed |
| 14 | Downstream contentHash consumers | DSS and ARM proof use original H; downstream suites all green |
| 15 | Journal original-H references | Acceptance provenance and original operation identity retained |
| 16 | Metadata downgrade | Version/authority/manifest deletion or contradiction cannot bypass retained new-format anchors |
| 17 | Partial admission persistence | Save failure rolls back; post-temp-write failure leaves only prior committed state on restart |
| 18 | Old optional root promoted to runtime | Collision rejected during explicit proof upgrade; future-root ownership guard refuses an admitted root |

No remaining contradiction with frozen authority was identified. The metadata is an internal consistency/provenance mechanism under the existing trusted local-store boundary, not an external cryptographic signature over the entire store. This task does not claim protection against an actor replacing all content, hashes, and retained authority history together.

## 11. Frozen-design compliance

Candidate IDs, deterministic identity generation, contract versions, semantic schema, and lineage rules are unchanged. Trigger and lifecycle transitions, CAS, revision advancement, operation identities, runtime evaluator versions, journals, ARM authorization, DSS/risk authority, Execution authority, publication semantics, and downstream ownership are unchanged. Runtime changes retain original H and their existing revision/journal behavior. The only added admission event content is system integrity metadata.

Broker access remains **READ ONLY / NO BROKER WRITES**. No broker transaction, order placement, execution redesign, Performance Intelligence work, merge, push, or accepted-history rewrite was performed. Frozen baseline/handoff files remain byte-identical to HEAD.

## 12. Remaining concerns

Gate V is the remaining acceptance blocker. Actual configured-model compatibility and sanitized real acceptance evidence are unproven. The implementation remains uncommitted and is not accepted for merge.

Unprovable old canonical records remain fail-closed. The explicit upgrade boundary does not repair historical tampering, incomplete special-key hashes, formerly unexcluded runtime contamination, or missing archival/admission proof. No broad migration or new provenance architecture was added. Future runtime writers must preserve admitted-root ownership and may use the exported ownership assertion before assigning a new root.

No other unresolved offline failure, frozen-design contradiction, or scope expansion was identified. Work stops at this report.
