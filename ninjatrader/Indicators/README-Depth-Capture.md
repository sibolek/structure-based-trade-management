# ExecutionOS Depth Capture

`ExecutionOSDepthCapture.cs` is a separate, data-only NinjaTrader indicator, build **0.1 EXP 2026-10-22**, schema `executionos.depth-capture.v0.1`. It records native depth and marketdata callbacks, connection notifications, and periodic UI markers for offline investigation. It does not calculate flow signals, modify the DOM column, or submit orders.

This publication preserves the existing source byte-for-byte. Source SHA-256: `5b9d787c7a8b4afffbd537ffdea5db995b38554680d402eca57afcf9493cc4f7`. It is a source checkpoint, not a deployment or a repair of the separately reviewed v4 liquidity accounting.

## Operation and output

The indicator starts a new bounded capture when it enters `State.Realtime`. Its defaults are 60 wall seconds, 250,000 admitted records, 32,768 queued records, and 128 MiB intended file limit. Duration and record count are configurable. The header is not checked against the byte limit: oversized settings such as a very long feed label can exceed it, so this is not a certified strict file-size bound. Depth is real-time input; the capture is not a historical exchange tape.

Files are written under Windows Documents → `ExecutionOS/DepthCaptures`. The worker writes to `.jsonl.partial`, drains admitted rows, writes the end record, flushes/closes the stream, and renames the file to `.jsonl`. A finalized filename alone does not establish completeness: inspect the end record, stop reason, counters, and `capture_complete`. A `.partial` file is incomplete.

The normal NinjaTrader source location is `Documents/NinjaTrader 8/bin/Custom/Indicators/ExecutionOSDepthCapture.cs`. Preserve one definition of the class; keep backups outside `bin/Custom`. Native compilation, loaded-assembly identity, provider routing, and performance require separate validation on the intended installation.

## Reading the records

- `seq` is local admission order under the recorder lock. It is not exchange-global chronology.
- `entry_seq` is assigned by `Stamp()` before admission. The UI timer stamps approximately every 250 ms but normally admits only one marker per second, so skipped entry numbers do not by themselves indicate lost market data.
- `stream_ordinal` counts eligible depth or marketdata callbacks separately before admission. Inspect each stream independently; do not sort the raw file by provider timestamps.
- `receipt_counter` and `receipt_utc` are sampled inside `Stamp()`. `admission_counter` is sampled later under the queue lock. Different callbacks can enter before another is admitted.
- `source_time` and `source_kind` preserve the API's raw DateTime. The host timezone does not establish the source timezone or network latency.
- `is_reset`, context records, startup without a prior native snapshot, and subscription boundaries matter to book reconstruction.
- A marker is a UI checkpoint, not a depth observation or an atomic snapshot.

`dropped_records` accounts for explicit record/queue rejection and admitted rows not serialized. Rows excluded at or after stopping or the admission deadline are outside that accounting, including a callback stamped before the deadline that reaches admission later. Zero drops and a complete local file do not prove provider/exchange completeness. The schema explicitly declares native intake validation unestablished and native DOM checkpoints externally required.

## Validation boundary

The matching-format ES after-hours and RTH files were independently counted and reconstructed during an October 23, 2026 audit. Both had contiguous admitted sequences and per-stream ordinals, and footer-reported zero drops. Those observations concern the files, not historical loaded-source attestation or correctness of the v4 column's live signals.

Run `python3 tests/depth-capture/run_tests.py` from this Indicators directory with Python 3 and .NET 10 installed. Eight expectations cover normal duration/finalization, record/queue/byte limits, injected flush failure, admission-order inversion, cutoff exclusion, and the oversized-header defect. The last two characterize limitations rather than certify losslessness or bounds. The source hash is checked before extracting the exact pure transport classes. See `depth-capture-validation.json`. These tests do not replace native NinjaTrader compilation, UI, connection, or load testing.
