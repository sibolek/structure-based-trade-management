# v4 — remember the last qualified signal

Build: **2026-10-16.1 EXP**. Based on the preserved **2026-10-15.1 EXP** source.

This is a display/history update. Both calculation cores, detection thresholds, confirmation timing, signed P/S values, existing reset rules, and spoof-like detector are unchanged. The new history record never feeds the detectors. There is one bounded in-memory record, not a growing event archive.

## What changes

- Each **qualified** absorption or initiative replaces the retained record. A candidate does not replace it.
- The qualification’s price, time and metrics are frozen. Its later Expired, Invalidated or Suppressed transition updates the recorded outcome and reason.
- While the original evidence remains active, the existing colored live label remains. After it ends, a neutral gray **LAST** marker stays at the qualification price and original bid/ask half until another signal qualifies or the context resets.
- Full text is available by hovering over the v4 column, even if the old price scrolls off the visible ladder. Hover support requires native UI verification.
- A read-only **Last qualified signal** property includes NT-local time, original price, age, outcome and reason. When Log flow events is enabled, it is also included in the existing five-second status output. No extra per-tick log stream was added.
- The old blanket 180-unit hide rule is replaced with actual text-space checks. Full labels shorten when necessary; labels are omitted if they cannot fit beside the P/S number. **Rendering** diagnostics report logical width, display scale and drawn/omitted label counts. This is not yet visually validated in NinjaTrader.

## Install for a controlled compile/display test

1. Save the settings of your existing v4 column (a screenshot is sufficient).
2. Save a copy of the currently installed v4 source **outside** `NinjaTrader 8/bin/Custom`. A second backup `.cs` defining the same class inside Custom can cause duplicate-class compilation errors.
3. In NinjaTrader’s NinjaScript Editor, open your existing `ExecutionOSPullingStacking_v4_Experimental` script.
4. Replace its complete contents with the supplied full source and compile with F5. **This replaces v4; do not add the file as a second script.** The class name is unchanged to preserve existing v4 settings. Your original and v3 columns are untouched.
5. In SuperDOM → right-click → Columns → select your existing v4 column, verify the read-only Build says **2026-10-16.1 EXP**. If it still shows 15.1, the running column has not loaded the replacement; reload that v4 column and restore its saved settings before testing.
6. Under **Flow display**, set **Persist last qualified signal = True** and **History marker seconds (0 = until replaced/reset) = 0**. Keep your current column width and all detection thresholds unchanged. Keep Log flow events enabled for this test; persistence itself also works with logging off.
7. Wait for the next qualified event. The record starts empty: old log lines are not automatically imported into the running column.
8. After the live label ends, check for a gray L/LAST marker at its qualification price. Hover anywhere over v4 for its timestamp, price and last outcome. If its price is off the ladder, the hover summary, read-only property and logged status still retain it.
9. Save one screenshot and several new status/event rows. A long video is not necessary for this first persistence/display check. If no qualification occurs, send a status row; absence of a marker is expected until a signal qualifies.

## Read the display

| Label | Meaning |
|---|---|
| BUY↑ / SELL↓ | Live qualified initiative; green / red |
| BABS / SABS | Live qualified buyer / seller absorption |
| A gold label ending in ? | Candidate only; not stored as the last qualified signal |
| LAST SELL↓ SUP (or L SI SUP) | Historical sell qualification, subsequently suppressed |
| L BI EXP | Historical buy initiative whose recorded state expired |
| L BA INV | Historical buyer absorption subsequently invalidated |
| L SI / L BI / L BA / L SA | Compact historical marker when fuller text cannot fit; use hover or the property for the outcome |

Compact pattern codes: **BI** buy initiative; **SI** sell initiative; **BA** buyer absorption; **SA** seller absorption. **SUP** suppressed, **INV** invalidated, **EXP** expired. **REC** means the last recorded transition is still Qualified, but that record is being displayed as history rather than as the selected live marker. Historical labels always use gray and L/LAST.

The cached qualification takes priority if a new candidate wants the same display slot. Candidates at other prices/sides still appear. The original P/S numbers retain their positions and calculations. A historical marker can stay on its original side even if the market crosses that price; the L/LAST prefix identifies the retained record.

## Lifetime and clearing

Default **0** retains the historical marker until replacement/reset. Optionally set 30 to hide the history marker 30 seconds after qualification; the full last-record summary remains available. This option does not change the existing live-marker lifetime or any detector threshold.

Records clear on column/header reset, session/context reset, instrument or connection change, playback clock rewind, detector reconfiguration/disable, and termination. Temporary locked/crossed-quote pauses retain the last record with its suppressed outcome. Records are not written into workspace XML and do not survive closing/restarting the column.

## Validation and limits

**313 local scenarios passed; 0 failed**, including 36 new history/display integration scenarios. The unchanged detector oracle again passed 30,000 steps with 1,263 identical transitions; the existing full-adapter differential passed 1,500 callbacks plus a seeded qualification with identical numeric P/S and original transition fields. Both calculation-core regions are text-identical to 15.1. Existing numeric renderers and spoof-like drawing logic are unchanged.

The local harness uses C# 5 and API-shaped stubs. **Actual NinjaTrader compilation, WPF tooltip/layout appearance, and live/replay display validation are still pending.** No independent Astra review of this update was performed. Signal accuracy and predictive usefulness are not established. No auto-trading, installation, Git commit or push was performed.

For rollback, the preserved prior source remains in `v4-validation-tests/v4-2026-10-15.1-rollback.cs.txt` alongside the repository source. Restore that source into the same v4 editor script and compile; keep duplicate copies outside Custom.
