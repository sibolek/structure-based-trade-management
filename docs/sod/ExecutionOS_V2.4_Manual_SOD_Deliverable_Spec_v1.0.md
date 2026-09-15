# ExecutionOS V2.4 Manual SOD Deliverable Specification v1.0

Date: 2026-09-14. Scope: individual candidate JSON files delivered with a **MANUAL Start-of-Day report**. This is the canonical manual-package delivery requirement; it supplements the ingestion and rendering baselines without changing their authority rules.

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

At each manual SOD generation, use the **current repository checkout** of the full template above and validate with its authoritative `normalizeCanonicalCandidateProposal` implementation. Cached ChatGPT examples, prior reports, and the combined/draft template do not establish the current candidate contract. Do not create a second schema or strip rejected fields to make an old artifact pass; re-author the proposal against the current template.

Delivery validation enforces the current authoritative canonical validator contract, not literal byte or shape equality with the example template. Accepted shorthand, such as `{"type":"MANUAL_CONFIRMATION","description":"..."}`, may normalize internally for validation; packaging preserves the original candidate values, including the shorthand trigger.

Before delivery, every completed individual JSON file (including directly ChatGPT/manual-authored files) MUST pass:

```sh
npm run v24:manual-sod-validate -- manual-package/individual-candidates/01-candidate.json
```

This read-only command validates the exact supplied file using the existing Preview JSON/envelope checks and current canonical validator. It requires one candidate and an already-present top-level `MANUAL_AUTHORIZED` policy. It never wraps, rewrites, repairs, writes, imports, or grants authority. Exit status is 0 for a valid deliverable, 1 for invalid/unreadable input, and 2 for command usage errors. Diagnostics identify the candidate index/identity and the authoritative field errors. Revalidate after any edit.

The check rejects candidate `status` and `armAuthorized` (even `false`), conflicting `timeframe`/`entryTimeframe`, free-text `managementPlan`, missing or invalid structured trigger/invalidation/management contract, invalid absolute validity timestamps, invalid validity order, and invalid/missing timezone according to the current canonical contract. It also rejects ambiguous duplicate JSON keys and files exceeding Preview limits. Optional structured content stays intact.

A pass certifies file format and contract validity only. It does not evaluate current market conditions, expiry against the current clock, stored conflicts, or admission eligibility; Preview → explicit Import → PRETRADE remains required. Running against the repository contract at generation time is mandatory even if a prior day's file passed.

## Local manual package generator

For a completed canonical manual SOD bundle, emit all individual import files with:

```sh
node schwab-bridge/manual-sod-deliverables.mjs manual-canonical-bundle.json manual-package/individual-candidates
```

`buildManualSodIndividualCandidateBundles()` / `writeManualSodIndividualCandidateFiles()` validate the canonical proposals without substituting normalized candidates. Before creating output, the writer also runs the same delivery gate on every final serialized individual file; an invalid later candidate or oversized final file prevents any files from being written. Each file copies the original bundle metadata and exactly one original candidate, adding the manual policy. Filenames contain an ordinal and a filesystem-safe candidateId; candidateId itself is unchanged. The original combined bundle is never written or mutated. Existing output files are not overwritten; use a fresh output directory for a new package. With no candidates, there are no individual candidate files.

This dedicated manual generator accepts policy-less manual archival bundles or explicitly manual bundles. It rejects automated or unknown ingress policies and legacy manual proposal envelopes rather than converting their authority or vocabulary. For legacy draft material, complete the existing canonical export first; the packaging step itself must not normalize or reconstruct trade content.

## Import and authority boundary

Manual SOD → individual `MANUAL_AUTHORIZED` candidate bundle → existing Manual Candidate Import Preview → explicit Import → canonical PRETRADE admission. Valid new candidates return `ACCEPTED` / `WAITING`; an unchanged retry returns `DUPLICATE`. Existing validation, validity, conflict, and supersession rules still apply.

The policy selects the existing manual admission path. It grants no activation, permission, risk approval, ARM authorization, Execution Board trade/handoff, or broker authority. Operator decision, permission/risk evaluation, and manual ARM remain separate existing actions. Do not import through a new repository or alter the manual import adapter to inject missing policies.

## Combined and automated bundles remain unchanged

Only the individual manual import files are required to be `MANUAL_AUTHORIZED`. The existing combined A+ archival/export bundle retains its current shape and policy behavior, even when it contains just one candidate. The existing `examples/ExecutionOS_SOD_A_PLUS_TRADES_v24_template.json` remains the combined/draft template.

`buildCanonicalSodCandidateBundle()` and its CLI default retain their policy-less combined output; `--automated` / `automatedPublication: true` retain `AUTOMATED_UNTOUCHED_ONLY`. Production SOD provider, lineage, publication, feeder and PRETRADE authority semantics are unchanged. Do not route Production SOD through the manual deliverable generator or silently label its output manual.

## Offline acceptance

Run `npm run v24:manual-sod-test` for the focused delivery/contract regression suite. Tests must cover emitted files and full candidate preservation, the existing manual UI adapter, real canonical API admission as `ACCEPTED` / `WAITING`, retry as `DUPLICATE`, no ARM/Execution/broker authority, and unchanged automated publication bytes/policy. Browser tests verify that an emitted file can be Previewed and Imported intact through the existing control. No live analysis request is required.
