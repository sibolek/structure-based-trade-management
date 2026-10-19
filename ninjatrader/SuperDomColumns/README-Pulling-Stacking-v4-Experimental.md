# ExecutionOS P/S + Flow v4 EXP — current checkpoint

**Build 2026-10-16.5 EXP** — optional qualified-event pause/recheck, quote-pause diagnostics, and the compact persistent last-event summary.

- [Full replacement source](ExecutionOSPullingStacking_v4_Experimental.cs)
- [Current build guide](NinjaTrader-v4-Pause-Resume-Guide.html)
- [Installation and capture steps](README-v4-Pause-Resume.md)
- [All event endings and pause/recheck meanings](Event-Endings-Reference.md)
- [Current validation index](v4-validation-manifest.json)
- [Publication and live-observation notes](v4-pause-resume-checkpoint-notes-2026-10-18.md)

The new **Pause qualified events on quote loss** option defaults to **False** for compatibility. Set it **True** to test the new lifecycle. Already-qualified events pause while L2 quotes are invalid and resume only after valid confirmed quotes return and current support checks pass. Candidates still stop and must qualify normally. The original qualification type, price, time and metrics remain frozen. Expiry continues from the original qualification; retracement, coverage, source-timing, execution-quality and reset protections remain active. There is no new grace timer. Rolling P/S arithmetic and original/v3 sources are unchanged.

**443 local C# 5 / API-shape scenarios passed again on October 18, 2026 on the exact published source.** These are 391 regression checks plus 34 pause/recheck core and 18 column-integration checks. They include an enabled-versus-strict 1,500-callback numeric P/S comparison, the existing strict adapter differential traces and 30,000-step core oracle. Guide layout checks at 1440/768/390 pixels are retained with build-specific filenames.

The user supplied a NinjaTrader 16.5 screenshot and live ES DEC26 log showing one Sell Initiative qualifying, pausing, resuming, pausing again, then ending with DominanceBelowMinimum at recovery. This supports that one observed lifecycle. It is not a byte-for-byte installed-source attestation, independent native compiler/WPF certification, native performance benchmark, or trading-edge validation. Further qualified examples, especially absorption, are still needed before threshold tuning.

To reproduce from the repository root:

```sh
python3 ninjatrader/SuperDomColumns/v4-validation-tests/run_tests.py --source ninjatrader/SuperDomColumns/ExecutionOSPullingStacking_v4_Experimental.cs
```

The harness requires .NET 10 and uses API-shaped stubs, not proprietary NinjaTrader assemblies. Update the existing v4 script and compile in NinjaTrader; do not add a duplicate class or column. The ZIP is a source/review bundle, not a NinjaTrader import archive. Keep existing thresholds and Apply legacy resets to rolling=False for the controlled comparison.

Rollback: set Pause qualified events on quote loss=False to restore strict behavior (this rebuilds detection). Exact source rollback text for [16.4](rollback/ExecutionOSPullingStacking_v4_2026-10-16.4.cs.txt), [16.3](rollback/ExecutionOSPullingStacking_v4_2026-10-16.3.cs.txt), and earlier checkpoints is retained. Store duplicate definitions outside NinjaTrader Custom. The previous committed checkpoint is `7673cc9` (16.3); earlier source is recoverable through Git history.

Version-specific manifests retain their creation-time installed/committed/pushed flags. Those historical values do not report current Git publication or the later user runtime observations. This index and its publication-validation block identify the current source; the containing Git commit and remote branch are the publication record.
