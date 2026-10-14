# ExecutionOS Pulling/Stacking v3 — continuity repair

Build **2026-10-12.2**, October 12, 2026. The separate class remains `ExecutionOSPullingStacking_v3`; existing v3 settings remain compatible. Your working original `ExecutionOSPullingStacking.cs` is preserved.

**The live screenshot proves that the prior candidate was repeatedly rebuilding its rolling baseline. Its zeros were not reliable five-second readings. This candidate fixes a reproduced clock-comparison defect and passes 35 calculation plus 37 synthetic integration scenarios. Native compilation and live confirmation of this revision remain pending.**

## What the live output established

Across the visible output, continuity breaks rose from 218 to 590 and resets from 438 to 1,184. Almost every sample said “warming up”; the last-reset reason was “Depth continuity lost.” Disabling ordinary legacy resets did not stop this independent reset path. The screenshot did not record the precise rejected event, so it cannot establish every live cause.

The prior engine compared provider event timestamps with a cutoff taken from the computer/session clock. With ordered callbacks stamped 200 ms behind receipt time, a deterministic reproduction produced 50 false continuity breaks, 104 resets, and an incorrect zero where the retained rolling sum should have been 50. The earlier test suite used matching event and receipt times and missed this case.

## What changed in this build

- Rolling retention and expiry use receipt time (monotonic live clock; playback time during replay). Provider event time is used for execution matching. A depth callback is no longer rejected merely because its timestamp precedes the computer clock or a measurement reset.
- Execution reset fences use the provider timestamps already observed, rather than local wall-clock time. Histories and pending matches are cleared on reset; untimestamped reset baselines cannot manufacture an execution interval. At/before-cutoff executions receive no credit.
- Ordered callbacks with regressing source timestamps still update the depth book and rolling quantity changes. They increment **source regressions** and discard ambiguous matching intervals on that side. Timestamp uncertainty does not itself erase the book.
- Startup retains the complete available positional book, bounded at 4,096 rows per side, even when display coverage is shallower. Valid deeper updates cannot masquerade as missing positions. Only configured depth coverage produces known rolling values.
- Truly invalid positions/quantities still cause a continuity reset. Diagnostics now include **invalid depth**, **source regressions**, and the side, operation, position and stored-row count behind the failure.
- Diagnostic output includes **build 2026-10-12.2**, so the newly loaded version can be identified. Synthetic snapshot rows no longer inflate the unstamped-provider-depth counter.

The prior display fixes remain: current snapshot levels are represented as zero, rolling rendering is independent of legacy maps, unavailable levels show `—`, and initial calendar arrival preserves current snapshot coverage. Actual session transitions still require fresh quantities. Bid/ask signs, colors, alignment, legacy defaults, serialized settings and original alert input remain intact.

## Reload your installed v3

1. Back up the existing **v3** script. In NinjaScript Editor open the script containing `public partial class ExecutionOSPullingStacking_v3`, currently **EOSPullingStacking.cs**. Preserve the separate original **ExecutionOSPullingStacking.cs**.
2. Replace the existing v3 script contents with all of [ExecutionOSPullingStacking_v3.cs](ExecutionOSPullingStacking_v3.cs). Compile with F5. Do not create a second file defining the same v3 class.
3. After successful compilation, remove and re-add the v3 column in the testing SuperDOM to obtain a fresh instance. Record settings first if needed.
4. Select **RollingWindow**, **5 seconds**, **Apply legacy resets to rolling = False**, **execution reconciliation = 250 ms**, and **Log live rolling diagnostics = True**.
5. Open Control Center → New → NinjaScript Output. Confirm each new diagnostic sample includes **build 2026-10-12.2**. Observe at least 30 seconds without manually resetting or changing the instrument/settings.

Expected during uninterrupted observation:

- “Warming up” clears after the first full five seconds of rolling observation; subsequent sampling can display that change later.
- Continuity-break, invalid-depth and reset counts remain stable during ordinary valid depth updates.
- Known bid/ask counts remain consistent with subscribed/configured coverage. New/removed levels and genuine resets can change availability.
- Numbers expire individually; quiet observed levels show zero. A drop from positive to zero can be normal expiry and is not itself evidence of cancellation.
- Matched/unmatched counters are cumulative for the engine lifetime. Compare changes between samples; matching is still an estimate. Stable resets alone do not establish correct execution attribution.

If continuity breaks continue, retain four or more consecutive new output lines. Their specific position/operation reason can distinguish an actual positional mismatch from timestamp anomalies. An occasional source regression is now an attribution warning, not an automatic book reset.

## Calculation and interpretation

The column sums signed `(depth quantity change + attributed execution volume)` in `(now − window, now]`, separately by side and price tick. It displays net liquidity change, not gross additions/cancellations, trader identity or intent. Equal additions and withdrawals can cancel to zero. Use executed volume and price response alongside it.

A snapshot supplies quantity without individual row timestamps. Except for a confirmed triggering observation, the first subsequent depth interval cannot receive timestamp-based execution credit. Regressing or missing source times similarly limit matching. The 250 ms reconciliation setting requires provider-specific replay calibration; this repair does not establish a trading edge or prove every execution was matched correctly.

LegacyBaseline remains the default. Rolling seconds accept integer 1–30. Apply legacy resets remains True by default for configuration compatibility, although False is appropriate when evaluating an uninterrupted window. Header, feed, connection, instrument, session and playback resets remain active. Live refresh is 100 ms; optional diagnostic printing is limited to one sample every five wall-clock seconds. A 500,000-entry history cap makes results unavailable on overflow.

## Verification

- **35 calculation scenarios passed**, including 10,000 independent rolling-oracle updates, provider lag, reset fencing, source regression, trade/depth ordering, coverage, expiry and session changes.
- **37 synthetic API-shape integration scenarios passed** under C# 5. These include 1,000 original-versus-v3 legacy events, the earlier sparse-display regressions, ordered lagged callbacks, lagged execution matching in both arrival orders, deeper books, explicit reset recovery, calendar/lifecycle behavior and exact invalid-position diagnostics.
- The lagged-feed reproduction now retains the expected 50 contribution sum, becomes warm, and has zero continuity breaks with four stable startup resets. Previously it returned zero with 50 breaks and 104 resets.
- Core load checks exercise one million updates per 3/5/10/30-second horizon and another million across 20 levels. These exclude native NinjaTrader/WPF, Windows and actual MES feeds.
- The installed original and repository baseline still match preserved SHA-256 `a521f8c49dc62dcac8391d813ad5eb3399922764f7a42b4bfd69899dcc001298`.

You reported compilation of earlier candidates. This revised source still needs NinjaTrader F5 compilation, fresh instance reload and live diagnostic confirmation. Recorded Level II Market Replay should then test sessions, reconnect, rewind, executions/replenishment, coverage and native performance. No installed file or trading control was changed during this repair.

From this SuperDomColumns directory, reproduce the local harness with Python 3 and .NET SDK 10:

```sh
python3 tests/pulling-stacking-v3/run_tests.py --source ExecutionOSPullingStacking_v3.cs
```

Test fixtures use `.txt` and synthetic API-shaped substitutes; they are not NinjaTrader assemblies. The ZIP is a source review bundle, not a native import ZIP.

Primary references: [OnMarketDepth callback sequencing](https://static.ninjatrader.com/support/helpGuides/nt8/onmarketdepth.htm), [MarketDepthEventArgs](https://static.ninjatrader.com/support/helpGuides/nt8/marketdeptheventargs.htm), [MarketDataEventArgs](https://static.ninjatrader.com/support/helpGuides/nt8/marketdataeventargs.htm).
