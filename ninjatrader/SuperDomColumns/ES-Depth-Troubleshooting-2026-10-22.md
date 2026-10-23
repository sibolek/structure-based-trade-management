# NinjaTrader 8: ES market-depth corruption — observed cache recovery (2026-10-22)

**Status:** Resolved by user-reported cache clearing; underlying root cause not established.  
**Instrument:** ES DEC26. **Comparison instruments:** MES DEC26 and NQ DEC26.  
**Context:** Evening / after-hours Globex session, October 22, 2026 (America/Denver).  
**Scope:** NinjaTrader 8 SuperDOM and Level II display; relevant to experimental ExecutionOS pulling/stacking and flow observations.  
**Safety:** Troubleshooting guidance only. No changes to order-management logic, detector source, or thresholds.

## Observed symptoms and independent checks

1. ES SuperDOM initially showed buy depth at **7705.25** while sell depth appeared at **7702.50**, an apparently **11-tick crossed book** (best visible bid above best visible ask). A screenshot alone cannot establish whether asynchronous display updates or an underlying provider snapshot caused the inconsistency.
2. MES DEC26 displayed a plausible book (visible bid **7704.50**, visible ask **7705.00**). NQ DEC26 also displayed a plausible, though thin, book (visible bid **29089.50**, visible ask **29090.50**). This suggested an ES-specific symptom, not universal market-depth failure.
3. In a subsequent ES Level II vs SuperDOM side-by-side screenshot, the Level II top quotes showed **7699.25 bid / 7699.50 ask**, a normal one-tick inside spread, while the ES SuperDOM showed buy depth at **7700.25** and no visible offer depth.
4. The Level II detail/summary simultaneously displayed repeated **7699.50**, **3-contract** entries on both bid and ask sides, with a **30 × 3 = 90** contract aggregation on each side and no meaningful differentiated ladder. This corroborated inconsistent depth *display/reconstruction*, not a definitive exchange-feed diagnosis.

**Observed remedy:** The user reported, “I cleared the NinjaTrader cache and it fixed the problem.” After cache clearing the ES depth display returned to coherent operation. The exact cache files/folders, precise deletion sequence, and whether NinjaTrader was restarted were **not recorded**. Do not infer or prescribe an exact cache path from this incident.

## Interpretation and limits

- **Confirmed:** An ES-specific abnormal depth display occurred, and user-reported cache clearing restored coherent ES book behavior.
- **Likely but unproven:** Stale or inconsistent local state, or market-depth reconstruction/state handling, contributed to the presentation.
- **Not established:** Whether the root cause was a cache issue, an interrupted ES subscription, provider data, dropped depth updates, NinjaTrader display processing, or interaction with custom columns.
- **Do not equate** low evening liquidity with a stable crossed book. Genuine thin liquidity can widen spreads and remove levels; it does not explain a persistent bid above ask as synchronized resting orders.
- Executed volume, Level I top-of-book quotes, and Level II resting depth are different data. An apparently valid Level I quote does not validate the underlying depth ladder.

## Safe recovery procedure for recurrence

1. **Order safety first.** Verify live positions, working orders, protective stop/target orders, and account/order state using a reliable independent view. Do **not** disconnect, restart, or clear cache during an unmanaged live position or while protective orders could be affected. If uncertainty exists, resolve the live order state before maintenance.
2. **Preserve evidence before recovery:** screenshots of ES SuperDOM and ES Level II side by side; instrument/contract; NT version; connection/provider; NinjaTrader-local date/time; relevant log and trace files; NinjaScript Output including complete `QUOTE-DIAG`, Flow/STATUS, and P/S rows if diagnostic logging is enabled. Do not rely on text logs to reconstruct an historical DOM.
3. **Confirm disparity:** compare ES SuperDOM against a fresh native ES Level II window; use MES/NQ only as *comparison*, not as evidence that the ES feed is correct. Note whether the top quote is sane but depth is crossed/missing/duplicated.
4. **Try non-destructive isolation:** select another instrument in the Level II window and then reselect ES; compare with a fresh SuperDOM without custom columns where safe. This may isolate a window/subscription problem but was **not documented as the successful remedy** in this case.
5. **After trading/order safety is established**, follow an appropriate NinjaTrader-supported cache-clearing procedure, backing up settings and evidence as needed. This was the successful user-reported remedy on 2026-10-22. Do not delete unverified directories or unrelated workspace/NinjaScript data; no exact cache path is asserted here.
6. **Validate recovery:** best bid below best ask; depth ladder ordered and populated on both sides; Level II and SuperDOM agree to the extent expected of independently refreshed displays; fresh prints/updates; stable feed. Allow v4 to warm up again and separately verify quote gate/coverage diagnostics before interpreting depth-derived signals.
7. If symptoms recur, preserve logs and investigate provider/connection/subscription and NinjaTrader processing with support; do not modify detector thresholds to compensate for bad depth.

## ExecutionOS v4 research implications

Experimental v4 (2026-10-16.5 EXP) uses valid quotes/depth coverage to protect absorption/initiative qualifications. If depth is incoherent, **P/S and depth-derived Flow interpretations are not trustworthy**, regardless of whether some Level I quotes or trades appear valid. The October 16 ES run had transient quote-pause episodes, but **this October 22 incident does not prove they share a root cause**.

For the post-recovery ES capture:
- Keep the experimental detector's settings and thresholds unchanged so this is a comparable run.
- Record **ES DEC26** plus exact **NT-local start/end timestamps** and build **2026-10-16.5 EXP**.
- Save **complete** `QUOTE-DIAG`, `Flow` event/`STATUS`, and `P/S` logs, including candidate/qualified/paused/resumed/ended transitions and full event identifiers.
- Prefer full-window records with book validity and warm-up noted. Compare observed pause frequencies and reasons with the prior baseline **without** attributing any difference to cache clearing absent evidence.
- Manual observation only; no trading action is authorized by a detector event.

**Incident evidence:** User-provided October 22 SuperDOM screenshots for MES, ES, NQ; an ES Level II / SuperDOM side-by-side; and the subsequent user report of resolution after clearing NinjaTrader cache. This note is not a native NinjaTrader bug report or root-cause certification.
