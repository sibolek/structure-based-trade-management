# Manual standalone trade-card deliverables

An ordinary request such as **“create a trade card for this chart”** produces the standalone trade-card HTML and `manual-trade-card-analysis-YYYY-MM-DD-SYMBOL.json` as standard authoring deliverables. Chart/screenshot interpretation remains upstream in ChatGPT/manual authoring. No full SOD report, dashboard, provider, model call, or local screenshot ingestion is required.

Normal flow:

```text
chart screenshot → ChatGPT/manual trade-card analysis + authored HTML
→ manual-trade-card-analysis-YYYY-MM-DD-SYMBOL.json
→ v24:manual-trade-card-package
→ standalone HTML; candidate JSON only if the current local validator passes
→ Preview → explicit Import
```

## Standard default destinations

```text
~/Downloads/ExecutionOS/TradeCards/YYYY-MM-DD/
├── SYMBOL/
│   ├── trade-card.html
│   ├── candidate-delivery-status.json
│   └── 01-<safe-candidateId>.json       # only when DELIVERED
└── SYMBOL-transport/
    └── manual-trade-card-analysis-YYYY-MM-DD-SYMBOL.json
```

The final output-directory argument is optional on both manual serializers and both manual packagers. Package defaults come only from the standard transport **filename** (valid calendar date and, for trade cards, a safe uppercase symbol label), never the clock or candidate fields. Labels do not rewrite or validate authored dates/symbols; authors must keep them consistent. An undated or renamed input still works with an explicit output directory. The `-TRANSPORT` suffix (case-insensitive) is reserved for transport-directory naming only in default trade-card path derivation; labels such as `NVDA-TRANSPORT` require explicit output directories for transport and package destinations.

Transport defaults use a fresh sibling directory so the transport never occupies an existing or future package directory. Both default transport directories and package directories must be absent, including empty directories and symlinks. A repeated run fails; there is no overwrite, auto-suffix, automatic retry, or silent fallback. For a new version or write-only recovery, supply an explicit fresh output directory as the last argument; preserve and verify the existing serialized analysis. Explicit transport destinations retain their existing exclusive-file behavior. Never choose an existing package as a transport destination.

CLI input and output paths expand `~` or `~/` using the current user's home directory, including when quoted; `~otheruser` is rejected. Default mode requires an existing writable `~/Downloads` directory. Missing/unavailable Downloads fails clearly and allows an explicit destination override. Other filesystem errors name the failing path; partial or interrupted output must be retried at a new path. Programmatic writer APIs still require explicit output paths. No changes to automated Production SOD, analysis, validator gating, Manual Import, PRETRADE, permission checks, ARM, execution, or broker authority.

Run `npm run v24:manual-output-test` for default-path sandbox smoke tests and regression coverage.

## Authoring and transport

The [transport example](../../examples/manual-trade-card-analysis.template.json) is transport-shape guidance only, not a second candidate schema or a visual template. Its placeholder proposal is deliberately incomplete. Replace the HTML and proposal during authoring; the example itself yields HTML with candidate delivery withheld.

| Field | Meaning |
|---|---|
| `artifactContent.html` | Complete, self-contained standalone HTML, including the author's existing styling/template. The package writes this string verbatim, without SOD rendering or status markup injection. |
| `candidateProposals` | Exactly one proposal object, derived upstream from the same authored trade definition as the HTML. Preserve all supplied candidate values, identity, version, provenance, and optional content. |
| `bundleMetadata` | Canonical manual bundle metadata excluding `candidates`, or `null` if unavailable. Use the existing manual delivery contract (`source: SOD_A_PLUS_TRADES`, matching `sourceDate`, `bundleId`, and other authored metadata). Candidate schema authority remains the current local validator. |

Repository inspection found no dedicated standalone trade-card renderer, HTML template, or chart-analysis generator. The existing renderer is for full SOD artifacts and compact A+ cards. This flow preserves upstream standalone HTML instead of inventing a new visual format. Keep the HTML independent of ExecutionOS services; do not include service calls or executable trading actions. The package does not execute, sanitize, scrape, or reverse-parse the HTML, or derive candidates from it. The author is responsible for making the card and structured proposal express the same analysis.

Optional serializer for already-authored JSON:

```sh
npm run v24:manual-trade-card-analysis -- /path/to/authored-trade-card.json 2026-09-16 NVDA
```

`serializeManualTradeCardAnalysis(input)` returns lossless transport JSON. `writeManualTradeCardAnalysis(input, analysisDate, symbol, outputDirectory)` writes the dated, symbol-labeled file exclusively and returns its absolute path. The serializer and its CLI path helper (distribute `manual-output-paths.mjs` alongside it) require only Node built-ins, with no validator/runtime/repository contract. The serializer checks the transport shape and JSON fidelity, not candidate validity. Filename labels never rewrite authored candidate fields. Use a valid calendar date and a safe uppercase symbol label (1–32 letters/digits/dots/underscores/hyphens, starting with a letter/digit); for symbols containing slashes, supply a safe filename label while preserving the actual candidate symbol.

### Required durable write and recovery procedure

1. Preserve the completed analysis and serialize once. Deliver the transport as a **standalone top-level artifact in a fresh writable location**, separate from the package and outside any existing SOD output directory. Use an unused path at the root of a new transport directory.
2. Before reporting success or offering a download, the caller must verify that the exact file exists, is readable, and parses back to the same analysis. Verify content, not just a filename or successful write return. Link the verified transport and authored HTML.
3. On a filesystem permission/write failure, retain the serialized bytes and retry **only the write** to a fresh writable path, using exclusive creation. Read back and compare again. Do not regenerate analysis, repair candidate values, rerun chart interpretation, or overwrite an existing transport.
4. If no verified writable destination is available, report delivery failure; do not claim a downloadable transport exists. Neither CLI performs automatic retries. Recovery and verification are caller responsibilities, consistent with the [manual SOD procedure](ExecutionOS_V2.4_Manual_SOD_Deliverable_Spec_v1.0.md#required-transport-write-and-recovery-procedure).

## Local packaging and candidate delivery

```sh
npm run v24:manual-trade-card-package -- ~/Downloads/ExecutionOS/TradeCards/2026-09-16/NVDA-transport/manual-trade-card-analysis-2026-09-16-NVDA.json
```

Use the actual date/symbol and a fresh output directory; even an existing empty package directory is refused. `writeManualTradeCardPackage(input, outputDirectory)` returns `htmlPath`, `candidateDeliveryStatusPath`, and `candidateDelivery`. The package contains:

- `trade-card.html`: the exact authored HTML, written before loading candidate validation.
- `candidate-delivery-status.json`: delivery status, reason, message, candidate file paths, and diagnostic when relevant.
- One individual candidate `.json`, only on `DELIVERED`, named by the existing manual delivery writer. It is a canonical one-candidate bundle with top-level `ingressPolicy: MANUAL_AUTHORIZED`, matching manual SOD individual files.

The optional candidate step dynamically loads `writeManualSodIndividualCandidateFiles` from the **current local** `manual-sod-deliverables.mjs`. That path validates the candidate contract and exact serialized Preview/Import file. There is no copied candidate schema, alternate validator, envelope conversion, or new admission path. The supplied candidate is unchanged. A supplied automated/unsupported policy is rejected, never relabeled. The existing manual writer supplies `MANUAL_AUTHORIZED` when manual authoring omitted the bundle policy.

Candidate output is staged privately and published as one complete file only after validation. Zero or multiple proposals withhold candidate output; the packager still preserves valid authored HTML. The serializer rejects those transport shapes before writing. Missing metadata likewise permits HTML-only delivery. No partial candidate file is published on handled candidate-write failures. A final status-write failure removes the candidate and fails the command. Read only candidates listed by a completed `DELIVERED` status; `PENDING` means an interrupted/incomplete package and must not be imported.

| Status / reason | Meaning |
|---|---|
| `DELIVERED / CURRENT_LOCAL_VALIDATOR_PASSED` | One file passed the installed canonical/manual delivery gate. Preview and explicit Import remain required. |
| `WITHHELD / CANDIDATE_INPUT_INVALID` | Cardinality, transport metadata, or lossless JSON requirements failed. |
| `WITHHELD / CANDIDATE_INPUT_UNAVAILABLE` | Bundle metadata was not supplied. |
| `WITHHELD / VALIDATOR_UNAVAILABLE` | Local delivery gate or a required repository contract could not load. |
| `WITHHELD / VALIDATION_FAILED` | The existing gate rejected the candidate or final import file. |
| `WITHHELD / DELIVERY_FAILED` | Candidate filesystem delivery failed. |

Both CLIs exit 2 for usage errors and 1 for input/filesystem failures. The package exits 0 when valid HTML and a completed status are written, including candidate withholding; inspect the status rather than treating exit 0 as candidate approval. Malformed input JSON, absent HTML, HTML/status filesystem failures, and reused output directories still fail. HTML is independent of candidate validity, not immune to filesystem failure. An interrupted process is not successful delivery; use a fresh package directory on retry.

## Preview and explicit Import

PRETRADE, Schwab, Execution Board, and broker services may all remain offline during serialization and packaging. In the SOD workspace's existing **Import Candidate JSON** control, load only the delivered individual candidate file, inspect Preview, then explicitly choose **Import into PRETRADE** when PRETRADE is connected. Do not import the transport or status file.

Local validation does not guarantee live admission; the existing authority still checks validity, identity, conflicts, and supersession. A valid new candidate is `ACCEPTED / WAITING`; an unchanged retry is `DUPLICATE`. Existing standalone envelopes continue through the unchanged narrow manual adapter. Packaging never calls that adapter or any import endpoint.

This workflow grants no automatic import, activation, ARM, permission/risk approval, execution, Execution Board handoff, or broker-write authority. Existing review, quantity selection, manual ARM, and downstream checks remain required. Automated Production SOD/provider behavior and the existing manual SOD workflow are unchanged.
