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

## Local manual package generator

For a completed canonical manual SOD bundle, emit all individual import files with:

```sh
node schwab-bridge/manual-sod-deliverables.mjs manual-canonical-bundle.json manual-package/individual-candidates
```

`buildManualSodIndividualCandidateBundles()` / `writeManualSodIndividualCandidateFiles()` validate the canonical proposals without substituting normalized candidates. Each file copies the original bundle metadata and exactly one original candidate, adding the manual policy. Filenames contain an ordinal and a filesystem-safe candidateId; candidateId itself is unchanged. The original combined bundle is never written or mutated. Existing output files are not overwritten; use a fresh output directory for a new package. With no candidates, there are no individual candidate files.

This dedicated manual generator accepts policy-less manual archival bundles or explicitly manual bundles. It rejects automated or unknown ingress policies and legacy manual proposal envelopes rather than converting their authority or vocabulary. For legacy draft material, complete the existing canonical export first; the packaging step itself must not normalize or reconstruct trade content.

## Import and authority boundary

Manual SOD → individual `MANUAL_AUTHORIZED` candidate bundle → existing Manual Candidate Import Preview → explicit Import → canonical PRETRADE admission. Valid new candidates return `ACCEPTED` / `WAITING`; an unchanged retry returns `DUPLICATE`. Existing validation, validity, conflict, and supersession rules still apply.

The policy selects the existing manual admission path. It grants no activation, permission, risk approval, ARM authorization, Execution Board trade/handoff, or broker authority. Operator decision, permission/risk evaluation, and manual ARM remain separate existing actions. Do not import through a new repository or alter the manual import adapter to inject missing policies.

## Combined and automated bundles remain unchanged

Only the individual manual import files are required to be `MANUAL_AUTHORIZED`. The existing combined A+ archival/export bundle retains its current shape and policy behavior, even when it contains just one candidate. The existing `examples/ExecutionOS_SOD_A_PLUS_TRADES_v24_template.json` remains the combined/draft template.

`buildCanonicalSodCandidateBundle()` and its CLI default retain their policy-less combined output; `--automated` / `automatedPublication: true` retain `AUTOMATED_UNTOUCHED_ONLY`. Production SOD provider, lineage, publication, feeder and PRETRADE authority semantics are unchanged. Do not route Production SOD through the manual deliverable generator or silently label its output manual.

## Offline acceptance

Tests must cover emitted files and full candidate preservation, the existing manual UI adapter, real canonical API admission as `ACCEPTED` / `WAITING`, retry as `DUPLICATE`, no ARM/Execution/broker authority, and unchanged automated publication bytes/policy. Browser tests verify that an emitted file can be Previewed and Imported intact through the existing control. No live analysis request is required.
