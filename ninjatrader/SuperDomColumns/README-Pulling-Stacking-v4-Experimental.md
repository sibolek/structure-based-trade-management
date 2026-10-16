# ExecutionOS P/S + Flow v4 EXP — current checkpoint

**Build 2026-10-16.3 EXP** — compact, fixed last-qualified-event summary and complete event-reason reference.

- [Full source](ExecutionOSPullingStacking_v4_Experimental.cs)
- [Current build guide](NinjaTrader-v4-Compact-Summary-Guide.html#event-reasons)
- [Installation instructions](README-v4-Compact-Summary.md)
- [All event endings and diagnostic meanings](Event-Endings-Reference.md)
- [Current validation index](v4-validation-manifest.json)
- [Publication and runtime-observation notes](v4-compact-checkpoint-notes-2026-10-16.md)

The fixed summary remains visible when the event price leaves the ladder. Qualification type, price, and time stay frozen; an ending reason is recorded separately. The compact presentation removes redundant section headings and tightens spacing. It retains the same thresholds and calculation cores. One historical record remains until replacement or an existing context reset. Detection is experimental; a suppressed observation does not establish a false positive, and a retracement does not prove a lasting reversal.

**349 local C# 5 / API-shape scenarios passed on this exact 16.3 source before publication.** The 16.3 guide also passed desktop/tablet/mobile layout and link checks. User screenshots show the fixed panel and compact layout in NinjaTrader, but do not constitute a byte-for-byte installed-source attestation, complete native compilation/WPF certification, independent review, or predictive calibration.

To reproduce checks from the repository root:

```sh
python3 ninjatrader/SuperDomColumns/v4-validation-tests/run_tests.py --source ninjatrader/SuperDomColumns/ExecutionOSPullingStacking_v4_Experimental.cs
```

The harness requires .NET 10 and uses API-shaped stubs, not proprietary NinjaTrader assemblies.

Update the existing v4 script; do not add a duplicate class or column. Keep your current detection settings. The ZIP is a source/review bundle, not a NinjaTrader import archive. Original and v3 sources are preserved. The previous committed 16.1 source is recoverable from commit `0f0e5ed`; the [16.2 rollback text](rollback/ExecutionOSPullingStacking_v4_2026-10-16.2.cs.txt) and earlier rollback fixtures are retained. Keep duplicate `.cs` definitions outside NinjaTrader Custom.

Version-specific older guides/manifests record their original candidate checkpoints. The index above identifies the current source and publication validation; creation-time installed/committed/pushed fields in older manifests do not report current Git state. The containing Git commit and remote branch are the publication record.
