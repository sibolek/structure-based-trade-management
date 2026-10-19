> Archived build 16.4 instructions. Use [the current 16.5 guide](NinjaTrader-v4-Pause-Resume-Guide.html) for the latest source. Exact 16.4 source is retained in [rollback text](rollback/ExecutionOSPullingStacking_v4_2026-10-16.4.cs.txt).

# ExecutionOS v4 — quote-pause diagnostics

Build **2026-10-16.4 EXP**, based on committed **2026-10-16.3 EXP** (`7673cc9`).

## What’s in Play

- **Measure the pauses:** duration distribution, latest closed pause, longest recovered pause, and latest pause affecting a qualified event.
- **Explain recovery:** last valid inside, first/latest invalid inside, recovered inside, and the callback that produced each observation.
- **Keep the gate unchanged:** no debounce, grace period, new freshness rule, classification change, or altered suppression behavior.
- **Bound the diagnostics:** one coalesced QUOTE-DIAG line at most every five real seconds within a diagnostic run (a new run can emit its first sample immediately), four retained record references, eight duration bins, and six sampled affected event IDs per pause.

## Install and capture the next log

1. Save your current v4 settings and back up the installed source outside NinjaTrader 8/bin/Custom. The supplied rollback text is the exact committed 16.3 source.
2. Replace the entire existing ExecutionOSPullingStacking_v4_Experimental script with the supplied full source and compile with F5. Do not add a duplicate script or an earlier column. This is still the same v4 class. The ZIP is a source/review bundle, not a NinjaTrader import archive.
3. Verify the v4 read-only Build says **2026-10-16.4 EXP**. Reload that v4 column if the older build remains active, and restore its saved settings.
4. Under **Quote pause diagnostics**, set **Log quote pause diagnostics = True**. This new option defaults to False. Its read-only Quote pause summary reports the capture state and totals.
5. Keep **Log flow events = True** so qualified/suppressed event IDs can be matched to the new diagnostics. Keep **Log live rolling diagnostics = True** for the existing depth/reset counters. The quote diagnostics themselves also work with flow-event logging off.
6. Leave calculation mode, rolling period, all flow thresholds, fixed-summary settings, and execution reconciliation unchanged. Keep **Apply legacy resets to rolling = False** for this controlled capture.
7. Open NinjaScript Output. Capture **3–5 minutes** on the same instrument while market data is arriving. No screen recording is required for this first duration investigation. Reloading the script starts a new in-memory last-event record; old history is not imported.
8. Look for ExecutionOS Quote v4 [your instrument] build 2026-10-16.4 EXP; QUOTE-DIAG. Allow at least two five-second samples. A sample with zero pauses is valid evidence too.
9. While capture is still enabled and the column is open, copy the complete Output text, including QUOTE-DIAG, Flow event/STATUS rows, and P/S diagnostic rows, into one text file. Include the beginning and end of the interval rather than only isolated lines. Save the instrument, date, and NinjaTrader-local time span with it.
10. After saving the text, you may turn Log quote pause diagnostics off. This stops the extra output and releases its diagnostic records; it does not reset the detector. Turning it back on starts a new diagnostic run.

Use one v4 column for this capture. A separately installed earlier column is unnecessary. Preserve your original and v3 scripts.

## What one pause means

A measured pause begins when this recorder has already seen a trusted spread and then observes unconfirmed, locked, or crossed inside quotes. It ends as **Recovered** only when confirmed bid and ask again form a valid spread in the same detector context. A locked-to-crossed-to-unconfirmed sequence stays one continuous pause; the observed-kind mask records the changes within it.

Invalid quotes at capture startup are counted separately as initial-invalid-callbacks. Their start time is unknown, so the recorder waits for its first valid baseline instead of inventing a pause duration. Enabling capture while the gate is already paused has the same limitation.

A disconnect, header reset, or other same-clock context replacement during an open pause ends that diagnostic record as **Abandoned**, not Recovered. Its duration is labelled censored-observed-ms: only the observed portion is known. It is excluded from the recovered-duration histogram and mean. A new valid context establishes a fresh baseline. Switching between live and Playback clocks or rewinding Playback starts a new diagnostic run instead of mixing incompatible time values; an open episode from the previous run is not bridged into a recovery. The previous run’s last output may therefore show an open episode at that capture boundary.

The existing flow quote-pause counter can therefore differ from observed-starts: it may have been counting before capture began, and its reset context differs. Compare diagnostic run IDs, instrument, and capture intervals rather than expecting those totals always to match.

## Read the summary fields

| Field | Meaning |
|---|---|
| run | Diagnostic capture identity within this column instance. It changes on re-enabling capture, changing instrument, switching live/Playback clocks, or rewinding Playback; it is not a globally unique ID across restarts. |
| observed-starts / recovered / abandoned / open | Episode accounting since this diagnostic run began on the current instrument. An open pause has not recovered yet. Context boundaries keep totals but interrupt open episodes; changing instrument or crossing a clock-mode/rewind boundary starts a new run. |
| start-kinds locked/crossed/unconfirmed | Initial condition of each measured pause, not the count of every intermediate invalid observation. |
| recovered-duration-bins-ms | Completed durations grouped as <=1, >1–5, >5–10, >10–50, >50–100, >100–500, >500–1000, >1000 ms. These are reporting bins only; they do not change any detector rule. |
| recovered-mean-ms / longest-recovered | Mean and longest duration among completed recoveries only. Open and abandoned pauses are excluded, so also inspect open age and abandoned count. |
| zero-receipt-duration | A pause began and recovered at the same recorded receipt-clock value. This does not prove an exchange condition lasted zero time. |
| initial-invalid-callbacks / baseline | Startup or mid-pause capture observations whose onset is unknown, and whether a trusted baseline has been established. |
| open-detail / latest-closed / longest-recovered / latest-qualified-affected | At most four representative record references. They are not a complete per-pause archive and may refer to the same episode. |

The histogram and totals aggregate every measured episode, even when only representative details survive between samples. Use differences between consecutive totals/bins to analyze a particular interval. No exact percentile or exchange-level duration is claimed.

## Read an individual record

| Detail | Meaning |
|---|---|
| pause / generation / flow-reset-count | Pause ID within the diagnostic run plus the flow context in which it began. Match instrument + run + pause, and use generation/event ID for the original flow events. |
| outcome / duration-ms / open-age-ms / censored-observed-ms | Valid recovery, still open, or interrupted context. An open age or censored interval is not a completed recovery duration. |
| before-inside / first-invalid / last-invalid / recovered-inside | Confirmed depth-engine bid/ask prices and quantities in bid-price x quantity / ask-price x quantity form. Unconfirmed marks a missing side. These are the same stored inside observations used by the existing quote gate, not a separate exchange-book snapshot. |
| reason / latest-invalid-reason / observed-kind-mask | Original onset reason, latest invalid reason, and all invalid categories observed: locked=1, crossed=2, unconfirmed=4; combined mask 7 means all three occurred. |
| before-callback / start-callback / last-invalid-callback / end-callback | Accepted callback sequence, stream, side, operation, position, price, quantity, reset flag, and source timestamp where available. Before-callback means the most recent valid gate observation; it is not necessarily the depth event that originally set those prices. |
| recovery-price-change | Same inside restored, both prices higher, both lower, or one-sided/mixed change relative to the last valid inside before the pause. This describes prices; it does not identify the cause or aggressor. |
| callbacks-including-start-and-recovery-if-present | Counts of accepted depth, L1 trade/quote, refresh, and render callbacks while the pause was open. Duplicate gate synchronizations inside a single callback do not double-count it. A render can be counted without itself re-evaluating the quote gate. |
| last-trade-during-pause / L1-snapshot | Latest trade callback observed while paused, including its bid/ask snapshot. A valid L1 snapshot does not reopen the L2 gate. The different snapshots may reveal timing differences but do not by themselves establish which source is wrong. |
| suppressed-qualified/candidates / affected / omitted-ids | Counts of original suppressed flow transitions linked to the pause, with at most six sampled generation/event IDs and patterns. Q marks a formerly qualified event, C a candidate. Omitted identities are counted explicitly. |

Depth operations are labelled Add, Update, or Remove. A Remove callback may have an optional zero/omitted price; use its position and the stored inside snapshots rather than interpreting that zero as a market price. Context-boundary records label their associated last callback separately; they are not fabricated depth events. Price and quantity fields have their usual instrument/contract units. Callback counts count updates, not contracts.

## Clock and sequencing limits

Duration uses this column’s existing receipt clock: a monotonic stopwatch in live mode and the playback receipt clock in Playback. The output labels the clock mode. A mode switch or rewind starts a fresh diagnostic run, so compare duration totals only within the same run. A low-level censored record whose interval cannot be compared is explicitly labelled unavailable-clock-rewind rather than assigned an invented zero duration. Within a diagnostic run, printing is capped by five seconds of real elapsed stopwatch time even if Playback runs faster or pauses. A new run resets that limiter and can emit its first sample immediately.

Durations are measured between observed invalid and valid callbacks inside the column. They include processing/scheduling effects and any instrumentation overhead. They are **not the duration of an exchange-book lock**. NT-local timestamps correlate the records to the original event log; they are not assumed to be Mountain Time. source-as-delivered preserves the callback timestamp without timezone normalization or a claim that all source clocks agree.

NinjaTrader documents sequencing within the depth stream and warns against assuming a particular order between depth and market-data callbacks. A bid update followed by an ask update can be worth examining when an intermediate locked state is observed, but that explanation is still a hypothesis until the captured transitions support it. A brief pause is not automatically a harmless artifact, and a long pause is not automatically an exchange fault.

The recorder does not store every raw update, change quote readiness, delay suppression, revive ended events, or submit orders. Logging has runtime cost even with bounded storage/output. Absence of a native recording or replay limits conclusions about the external source of a transient state.

## How we will use your capture

First, compare consecutive histograms to measure the pause count and duration distribution during the interval. Then inspect the longest recovered/open episodes and the latest-qualified-affected record. Match its Q event ID and generation to the original Qualified and Suppressed rows. Compare before, invalid, and recovered inside prices and the start/recovery callback types.

For a pause around a qualified event, distinguish a same-inside restoration from a staged inside-price change or loss of confirmed depth. Review any simultaneous original continuity, invalid-depth, source-regression, or reset counters. Treat the callback evidence as observations, not an automatic diagnosis of the provider or exchange.

Only after that review should we consider whether a gate change is justified. This build intentionally supplies measurements while retaining current signal behavior.

## Validation and rollback

**391 local scenarios passed; 0 failed**, including 42 quote-pause diagnostic scenarios. The new group covers exact histogram boundaries and fractional durations, startup/mid-pause capture, changing invalid states, duplicate synchronization, bounded identity storage, ten thousand accounting observations, locked/crossed/missing-side recovery, L1/L2 separation, real suppressed qualifications, context resets, rate-bounded output, serialization, instrument changes, and explicit live/Playback clock boundaries.

Two new full-adapter comparisons against the exact committed 16.3 source passed 1,500 callbacks each plus positive qualification and quote-pause sequences, with quote diagnostics both off and on. Original numeric P/S, flow state, original signal transitions, and retained last-qualified summaries matched. The existing 30,000-step core oracle and earlier adapter checks also pass. Both calculation-core regions are text-identical to 16.3; the numeric, spoof, and compact-card renderers and detector configuration key are unchanged.

Local compilation uses C# 5 and API-shaped stubs. Native NinjaTrader compilation, the new property/output UI, and a live duration capture still need verification. No live cause, signal accuracy, full native certification, or new independent Astra review is claimed. No installation, Git commit, or push is performed by this package.

Rollback: paste rollback/ExecutionOSPullingStacking_v4_2026-10-16.3.cs.txt into the same v4 editor script and compile. That is the exact prior source, also preserved in Git commit 7673cc9. Keep duplicate class definitions outside Custom.
