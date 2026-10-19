# ExecutionOS v4 — pause qualified events and recheck recovery

Build **2026-10-16.5 EXP**. Experimental replacement for the same v4 class, based on exact build 16.4. Original and v3 scripts are preserved. Codex has not installed the script into NinjaTrader. The containing Git commit and remote branch record source publication; later runtime observations are summarized in the checkpoint notes.

## What’s in Play

- New optional lifecycle: Qualified → Paused → Resumed, or an explicit terminal ending.
- Original qualification type, price, time and metrics stay frozen; resume does not add to Qualified count.
- Invalid quotes still block new qualification. Candidates are suppressed and restart confirmation normally.
- Original display lifetime, retracement, execution-quality, coverage, source timing and reset rules remain in force. No new grace timeout or altered threshold is added.
- The option defaults to False. Explicitly set it True for this test; False preserves the strict behavior.

## Install and configure

1. Save your current v4 settings and back up the installed source outside NinjaTrader 8/bin/Custom.
2. Open the existing ExecutionOSPullingStacking_v4_Experimental script in NinjaScript Editor. Replace its entire contents with the supplied full .cs file, save and compile with F5. Do not create a duplicate v4 script. The ZIP is a source/review bundle, not a NinjaTrader import archive.
3. Verify the column’s read-only Build says **2026-10-16.5 EXP**. If it still shows the older build, reload that v4 column and restore its saved settings.
4. In SuperDOM → Columns → v4 → **Flow detection (experimental)**, set **Pause qualified events on quote loss = True**. It defaults to False for compatibility. Changing this detection setting resets the detector/history and requires fresh warm-up.
5. Keep **Enabled, Absorption, Initiative and Log flow events = True**, **Log quote pause diagnostics = True**, and **Log live rolling diagnostics = True**. Keep **Show fixed last-event summary = True**.
6. Keep your existing calculation mode, rolling window, detection thresholds, marker lifetime and execution reconciliation unchanged. Keep **Apply legacy resets to rolling = False**. Do not retune ES/MES thresholds during this comparison.
7. Open NinjaScript Output and collect about five minutes on the same instrument after warm-up. Copy the complete Quote/Flow/P/S text, including the beginning and end of the interval. Record the instrument and NT-local time span. No video is needed for this first lifecycle check.

## What to look for

The first event must still log **Qualified**. A quote interruption may then log **Paused** for the same generation/id; the card shows **Paused: quote validation** and its exact quote reason. A valid recovery that passes current support checks logs **Resumed** and the card returns to **Active**. The original type, price and qualification time remain unchanged.

Pauses often last only milliseconds. You may not see the paused card at all. The Paused/Resumed log rows are the durable evidence. Resumed is not a new qualification or a buy/sell instruction. A gray LAST row marker records past qualification and must not be read as an active signal.

If the original lifetime ends while paused, the event logs Expired and the card says Ended: Expired. A reported adverse price move can still invalidate it while paused. Absorption coverage loss, source uncertainty or poor execution quality can still suppress it. Disconnection, reset or a new context can clear the card. Later valid quotes cannot revive a terminal event.

If quotes recover but the full support recheck fails, the exact reason is **Quote recovery evidence no longer qualifies** and the card says **Ended: Recovery check failed**. Inspect that row’s checks-now/blockers for the current failed checks. The historical qualification remains recorded; this is not a retrospective claim that the pattern never occurred.

With a 3000 ms Marker display lifetime, a qualification at 12:00:00.000 keeps its deadline of 12:00:03.000, including pause time. A recovery at 12:00:02.500 does not create another three seconds. Evaluations recognize expiry on the next callback/refresh.

The quote recorder separately counts paused-qualified, with P:Q identity samples. Existing suppressed-qualified/candidates remains a separate field. Quote summaries remain coalesced every five real seconds per run; Flow transitions log individually.

## What this changes and what remains uncertain

The L2 quote-validity test itself is unchanged: confirmed bid and ask with bid < ask are required. An L1 trade snapshot cannot reopen it. The optional policy changes what happens to already-qualified tracking during an invalid interval and requires a current support recheck at recovery. It is not a time-based debounce and does not assume equal source timestamps identify an atomic exchange update.

Your prior ES log showed 521 additional pauses over 414.585 seconds; all recovered, 94.4% within 50 ms, mean about 18 ms, maximum 819.725 ms. All four new initiatives in that pasted interval later ended through quote validation. An earlier retained event linked to a 3.248 ms pause. These are observed receipt intervals, including delivery, processing and scheduling. They do not prove exchange lock duration or provider cause. That log is bounded diagnostic sampling, not a full replay tape, so we cannot claim which of those four events would have resumed under this build.

The 819 ms local scenario is synthetic, not a replay of historical DOM data. More retained/longer active signals do not establish a trading edge. The next log should establish lifecycle correctness before any threshold tuning or signal-quality conclusion.

## Validation and rollback

**443 local scenarios passed; 0 failed**: 391 regression checks plus 34 core and 18 column-integration checks for pause/recheck. Coverage includes all four kinds, no duplicate qualification, fresh confirmed quotes, failed recovery, original expiry, adverse prints during pause, coverage/source/quality failures, context resets, UI summary, logging, serialization and strict-policy compatibility. An additional 1500-callback differential trace exercises a genuine harness qualification/pause/recovery and verifies identical numeric rolling P/S with the policy enabled and disabled. Existing strict-policy adapter differential and 30000-step core-oracle checks remain in the suite.

These use C# 5, .NET 10 and API-shaped stubs. Native NinjaTrader compilation and live UI/log behavior still need confirmation. There is no native performance benchmark or validated predictive accuracy. Test evidence, reproducible fixtures, source diff, scope checks and a validation manifest are included.

For immediate behavior rollback, set Pause qualified events on quote loss to False; this resets its detection context and restores strict suppression. For source rollback, replace the existing v4 script with the exact file in rollback/ExecutionOSPullingStacking_v4_2026-10-16.4.cs.txt and recompile. Store backup copies outside bin/Custom to avoid duplicate classes. Earlier guides/releases are preserved. See the current v4 index and October 18 checkpoint notes for publication status.
