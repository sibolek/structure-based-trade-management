# ExecutionOS V2.4 Manual SOD Deliverable Specification v1.0

Updated: 2026-09-16. Scope: **MANUAL Start-of-Day report** packaging and optional individual candidate JSON delivery. This is the canonical manual-package delivery requirement; it supplements the ingestion and rendering baselines without changing their authority rules.

## Frozen reporting / candidate-delivery boundary

Start-of-Day report generation is independent of ExecutionOS availability. The 19-section Markdown report, canonical HTML report, SOD dashboard, and A+ trade analysis must complete when PRETRADE, Schwab monitor, Execution Board, broker connectivity, or ExecutionOS services are offline. ExecutionOS candidate JSON is an **optional downstream deliverable**.

Candidate JSON may be delivered only after every individual file passes the **current local ExecutionOS canonical validator**. Missing/unloadable validator or repository contract, invalid candidate proposals, or candidate-delivery failures withhold the entire candidate package and surface a reason; they do not fail report/dashboard generation. Service availability is never a prerequisite for local candidate validation. No schema fallback, cached contract, repair, automatic import, ARM, execution, or broker write is allowed.

This boundary applies to the manual workflow. The deferred automated Production SOD provider, its validation/lineage/publication order, and its authority rules are unchanged.

## Standard morning deliverables and transport artifact

The standard manual workflow is:

```text
charts/screenshots
  → ChatGPT/manual SOD analysis
  → manual-sod-analysis-YYYY-MM-DD.json
  → npm run v24:manual-sod-package -- <analysis.json> <fresh-output-directory>
  → report.md + report.html + dashboard.html + candidate-delivery-status.json
  → individual-candidates/ only if the current local validator passes
```

ChatGPT/manual SOD authoring **must emit `manual-sod-analysis-YYYY-MM-DD.json` as part of the standard deliverables**, using the same report content and A+ proposals as the human-readable analysis. Download that JSON and pass it directly to the packager. The JSON is an intermediate transport artifact, **not an importable candidate bundle or evidence of validation**. Never upload it to Manual Candidate Import; use only the downstream individual candidate files after successful validation.

There is no upstream local generator for the ordinary ChatGPT/manual chart-analysis workflow in this repository. The existing local renderer and manual packager consume already-authored content; the separate automated analysis providers are not this workflow. The explicit serializer below is an authoring utility, not an automatic connection to a ChatGPT conversation. Neither CLI accepts screenshots, calls an AI model, fetches market data, or starts services. Analysis remains upstream.

The canonical [transport template](../../examples/manual-sod-analysis.template.json) contains all 19 report sections, clearly marked placeholders, an empty `candidateProposals` array, and `bundleMetadata: null`. It is transport/report-shape guidance, **not a second candidate schema**. Replace the report placeholders with authored content, including current VIX context or an explicit unavailable observation. For A+ proposals, author against the current [individual candidate template](../../examples/ExecutionOS_MANUAL_SOD_individual_candidate_v24_template.json): put the completed bundle's `candidates` in `candidateProposals` and its remaining top-level fields in `bundleMetadata`. Do not paste an entire bundle into `candidateProposals`. Keep the existing renderer's structured blocks; do not substitute rendered Markdown, HTML, or CSS for `artifactContent`.

If there are no A+ ideas, use `candidateProposals: []` and `bundleMetadata: null`; the downstream status is `NO_CANDIDATES`. Authored ideas without canonical bundle metadata may also be transported with `bundleMetadata: null`; their analysis renders, while candidate delivery is `WITHHELD / CANDIDATE_INPUT_UNAVAILABLE`.

For already-authored data saved under another filename, the optional local serializer provides the standard artifact name:

```sh
npm run v24:manual-sod-analysis -- authored-sod.json 2026-09-16 ~/Downloads/SOD-2026-09-16-analysis
npm run v24:manual-sod-package -- ~/Downloads/SOD-2026-09-16-analysis/manual-sod-analysis-2026-09-16.json ~/Downloads/SOD-2026-09-16-validated
```

If ChatGPT already supplied the correctly named transport file, only the second command is needed, with that file's actual location. These dates are examples; choose the actual analysis session date and a fresh package directory each morning.

`serializeManualSodAnalysis(input)` returns deterministic two-space JSON with a trailing newline. It extracts only `artifactContent`, `candidateProposals` (default `[]`), and `bundleMetadata` (default `null`), without adding timestamps, status, policy, or authority metadata. It checks those outer container types and lossless JSON serialization only; it does **not** validate report sections or candidate contracts. Invalid/draft candidate JSON values remain unchanged for the downstream validator to reject. The JavaScript helper rejects non-JSON/lossy values such as `undefined`, nonfinite numbers, Dates, and sparse arrays rather than silently changing them. CLI input must be ordinary JSON; authored numeric values must fit JSON/JavaScript number precision, and object keys must be unique.

`writeManualSodAnalysis(input, analysisDate, outputDirectory)` writes `manual-sod-analysis-YYYY-MM-DD.json` and returns its absolute path. The date must be an explicit valid calendar date. It is a filename label only: authors must keep it consistent with report/bundle/candidate dates, which the serializer never infers or rewrites. Existing files are never overwritten; use a new transport directory for another version of the same date. No network, validator, renderer, runtime, or service availability is required. The standalone module uses only Node built-ins. The CLI prints `{ "analysisPath": "..." }`; exit status is 0 on serialization success, 1 on input/date/serialization/filesystem error, and 2 on usage error. Success certifies transport creation only.

For valid reporting content and writable output, reports/dashboard complete independently of candidate validation. Missing validators and invalid candidates remain nonfatal downstream withholding cases. Malformed reporting input and report filesystem errors still fail; neither a serialized transport nor the template guarantees a completed report or valid candidate delivery.

## Manual report package entry point

Use the report-aware command for a completed manual analysis:

```sh
npm run v24:manual-sod-package -- manual-sod-analysis-2026-09-16.json manual-package-new-run
```

The dated transport is directly compatible with the existing input shape. Existing undated/direct JSON inputs and `writeManualSodPackage()` callers remain supported without migration. The input contains:

- `artifactContent`: the existing structured 19-section rendering content;
- `candidateProposals`: the authored A+ trade ideas used by the existing renderer (default `[]`);
- optional `bundleMetadata`: the completed canonical bundle's existing top-level metadata, excluding `candidates`. When supplied, the package combines it with the same `candidateProposals` and invokes the current manual candidate writer. This is not a new candidate schema.

For an existing completed bundle, use its `candidates` as `candidateProposals` and its remaining fields as `bundleMetadata`. Reports render the authored ideas without requiring canonical candidate admission validity. There is only one trade-substance input: packaging cannot replace report ideas with different candidate contracts. Without bundle metadata, A+ analysis still renders and candidate JSON is explicitly withheld.

`writeManualSodPackage(input, outputDirectory)` requires a **fresh directory** and writes `report.md`, `report.html`, and `dashboard.html` before loading the optional local `manual-sod-deliverables.mjs` gate. It reuses the established renderer without changing automated rendering. It then stages the existing writer's validated individual files and exposes `individual-candidates/` only as a complete set. No combined candidate JSON is delivered by this command.

Every completed package includes `candidate-delivery-status.json` and a status badge in all three reports. Status is `DELIVERED`, `WITHHELD`, or `NO_CANDIDATES`; withholding reasons distinguish `VALIDATOR_UNAVAILABLE`, `VALIDATION_FAILED`, `CANDIDATE_INPUT_UNAVAILABLE`, and `DELIVERY_FAILED`. Full underlying errors, including candidate index/identity when provided by the validator, remain in the status file. The CLI prints the result and status as JSON. A completed report package exits 0 even when candidates are withheld; malformed report input/report filesystem failures exit 1, usage errors exit 2. Existing directories are rejected to prevent stale candidate files from appearing to belong to a new run.

The reporting runtime needs only the package entry point, renderer, and rendering-content module; it has no static dependency on the ExecutionOS candidate contract. If ExecutionOS has been removed, an independently retained reporting runtime can still render supplied analysis. Removing the reporting runtime itself cannot leave a runnable local command. This command packages already-authored analysis; it does not fetch charts or perform a live analysis request.

## Required individual import files

Every individual ExecutionOS candidate JSON generated for a manual SOD package MUST be emitted from the start as a one-candidate canonical bundle with top-level `"ingressPolicy": "MANUAL_AUTHORIZED"`. No subsequent policy injection, source conversion, or user post-processing is required. Apply this requirement whether a manual package is authored directly or produced by a local generator.

```json
{
  "schemaVersion": 1,
  "source": "SOD_A_PLUS_TRADES",
  "sourceDate": "YYYY-MM-DD",
  "generatedAt": "YYYY-MM-DDTHH:MM:SS.sssZ",
  "bundleId": "sod-YYYY-MM-DD-a-plus-trades-v1",
  "ingressPolicy": "MANUAL_AUTHORIZED",
  "candidates": ["ONE_UNCHANGED_CANONICAL_CANDIDATE_OBJECT"]
}
```

The string in `candidates` above is a documentation placeholder for the actual candidate object. The full object template is [the manual individual candidate template](../../examples/ExecutionOS_MANUAL_SOD_individual_candidate_v24_template.json); replace its date, identity, and trade placeholders during report authoring, before the candidate is finalized.

Packaging MUST preserve the completed candidate payload in substance, including candidateId, contractVersion, source `SOD_A_PLUS_TRADES`, sourceDate, generatedAt, trigger, structural invalidation, targets, risk policy, validity, provenance, armPolicy, management, all trade logic, and arbitrary optional content. Do not rewrite candidate-level source or provenance to describe the manual delivery channel. Whitespace/JSON indentation may change; candidate values may not. `MANUAL_AUTHORIZED` belongs on the bundle, never inside the candidate or its provenance.

## Required generation-time contract check

At each manual SOD generation **that delivers ExecutionOS candidate JSON**, use the **current repository checkout** of the full template above and validate with its authoritative `normalizeCanonicalCandidateProposal` implementation. Cached ChatGPT examples, prior reports, and the combined/draft template do not establish the current candidate contract. Do not create a second schema or strip rejected fields to make an old artifact pass; re-author the proposal against the current template.

Delivery validation enforces the current authoritative canonical validator contract, not literal byte or shape equality with the example template. Accepted shorthand, such as `{"type":"MANUAL_CONFIRMATION","description":"..."}`, may normalize internally for validation; packaging preserves the original candidate values, including the shorthand trigger.

Before delivery, every completed individual JSON file (including directly ChatGPT/manual-authored files) MUST pass:

```sh
npm run v24:manual-sod-validate -- manual-package/individual-candidates/01-candidate.json
```

This read-only command validates the exact supplied file using the existing Preview JSON/envelope checks and current canonical validator. It requires one candidate and an already-present top-level `MANUAL_AUTHORIZED` policy. It never wraps, rewrites, repairs, writes, imports, or grants authority. Exit status is 0 for a valid deliverable, 1 for invalid/unreadable input, and 2 for command usage errors. Diagnostics identify the candidate index/identity and the authoritative field errors. Revalidate after any edit.

The check rejects candidate `status` and `armAuthorized` (even `false`), conflicting `timeframe`/`entryTimeframe`, free-text `managementPlan`, missing or invalid structured trigger/invalidation/management contract, invalid absolute validity timestamps, invalid validity order, and invalid/missing timezone according to the current canonical contract. It also rejects ambiguous duplicate JSON keys and files exceeding Preview limits. Optional structured content stays intact.

A pass certifies file format and contract validity only. It does not evaluate current market conditions, expiry against the current clock, stored conflicts, or admission eligibility; Preview → explicit Import → PRETRADE remains required. Running against the repository contract at generation time is mandatory even if a prior day's file passed.

## Local manual package generator

For a completed canonical manual SOD bundle, the lower-level candidate-only command remains available:

```sh
node schwab-bridge/manual-sod-deliverables.mjs manual-canonical-bundle.json manual-package/individual-candidates
```

`buildManualSodIndividualCandidateBundles()` / `writeManualSodIndividualCandidateFiles()` validate the canonical proposals without substituting normalized candidates. Before creating output, the writer also runs the same delivery gate on every final serialized individual file; an invalid later candidate or oversized final file prevents any files from being written. Each file copies the original bundle metadata and exactly one original candidate, adding the manual policy. Filenames contain an ordinal and a filesystem-safe candidateId; candidateId itself is unchanged. The original combined bundle is never written or mutated. Existing output files are not overwritten; use a fresh output directory for a new package. With no candidates, there are no individual candidate files.

The candidate-only command and validation-only command remain strict/nonzero on rejection; report workflows must use the report package entry point above to contain candidate failures.

This dedicated manual generator accepts policy-less manual archival bundles or explicitly manual bundles. It rejects automated or unknown ingress policies and legacy manual proposal envelopes rather than converting their authority or vocabulary. For legacy draft material, complete the existing canonical export first; the packaging step itself must not normalize or reconstruct trade content.

## Import and authority boundary

Manual SOD → individual `MANUAL_AUTHORIZED` candidate bundle → existing Manual Candidate Import Preview → explicit Import → canonical PRETRADE admission. Valid new candidates return `ACCEPTED` / `WAITING`; an unchanged retry returns `DUPLICATE`. Existing validation, validity, conflict, and supersession rules still apply.

The policy selects the existing manual admission path. It grants no activation, permission, risk approval, ARM authorization, Execution Board trade/handoff, or broker authority. Operator decision, permission/risk evaluation, and manual ARM remain separate existing actions. Do not import through a new repository or alter the manual import adapter to inject missing policies.

## Combined and automated bundles remain unchanged

Only the individual manual import files are required to be `MANUAL_AUTHORIZED`. The existing combined A+ archival/export bundle retains its current shape and policy behavior, even when it contains just one candidate. The existing `examples/ExecutionOS_SOD_A_PLUS_TRADES_v24_template.json` remains the combined/draft template.

`buildCanonicalSodCandidateBundle()` and its CLI default retain their policy-less combined output; `--automated` / `automatedPublication: true` retain `AUTOMATED_UNTOUCHED_ONLY`. Production SOD provider, lineage, publication, feeder and PRETRADE authority semantics are unchanged. Do not route Production SOD through the manual deliverable generator or silently label its output manual.

## Offline acceptance

Run `npm run v24:manual-sod-test` for the focused delivery/contract regression suite. Tests cover transport CLI round trips, deterministic/lossless serialization with no runtime or validator, compatibility with direct inputs, transport template rendering, reporting with services offline, absent/unloadable validator code, rejected candidates, a later candidate failing validation/serialization, no partial candidate delivery, full candidate preservation, the existing manual UI adapter, real canonical API admission as `ACCEPTED` / `WAITING`, retry as `DUPLICATE`, no ARM/Execution/broker authority, and unchanged automated publication bytes/policy. Browser tests verify that an emitted file can be Previewed and Imported intact through the existing control. No live analysis request is required.
