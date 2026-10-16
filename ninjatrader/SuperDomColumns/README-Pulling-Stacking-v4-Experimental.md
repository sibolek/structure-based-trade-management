# ExecutionOS P/S + Flow v4 EXP — current checkpoint

**Build 2026-10-16.1 EXP** — persistent last-qualified-signal history.

- [Full source](ExecutionOSPullingStacking_v4_Experimental.cs)
- [Installation and behavior guide](NinjaTrader-v4-Last-Signal-Guide.html)
- [Plain-text instructions](README-v4-Last-Signal.md)
- [Validation manifest](last-signal-validation-manifest.json)
- [Checkpoint and live-observation notes](v4-checkpoint-notes-2026-10-16.md)

313 local C# 5 / API-shape scenarios passed. The user’s ES runtime logs identify this build and screenshots show its historical marker. These observations are not a byte-for-byte attestation of installed source, full native/WPF validation, independent review of this update, or predictive calibration.

To reproduce the local checks from the repository root:

```sh
python3 ninjatrader/SuperDomColumns/v4-validation-tests/run_tests.py --source ninjatrader/SuperDomColumns/ExecutionOSPullingStacking_v4_Experimental.cs
```

The harness requires a .NET 10 SDK. It uses API-shaped stubs, not proprietary NinjaTrader assemblies.

Existing v4 installations replace the existing v4 script; do not add a duplicate class. Install only the intended `.cs` source in NinjaTrader. The ZIP is a review/source bundle, not a NinjaTrader import archive. Original and v3 source files are preserved.

The prior 2026-10-15.1 source is retained byte-for-byte as [a rollback fixture](v4-validation-tests/v4-2026-10-15.1-rollback.cs.txt); rename/copy its contents into the same v4 editor script only when deliberately rolling back. Keep duplicate `.cs` copies outside NinjaTrader Custom.

This checkpoint does not include the proposed fixed always-visible summary panel or quote-pause-duration diagnostics. Those remain future work.
