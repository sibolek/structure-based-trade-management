# 30-day management study — preserved methodology

This folder preserves the analytical methodology and historical benchmark outputs that motivated the ExecutionOS Management Governor.

## Source evidence

The project specification records that the study used:

- approximately 30 days of Schwab account statement / order-history execution data;
- flat-to-flat same-day stock episodes reconstructed from executions;
- options excluded from the core equity study;
- initial stop order history where a defensible original stop could be reconstructed;
- consolidated SIP 1-minute historical market data for fixed-duration and favorable-excursion analysis.

Counterfactual exits are analytical approximations. MFE is an opportunity envelope, not a claim that the peak could have been captured.

## Preserved analyses

1. Winner / loser duration.
2. Stop movement timing, especially movement toward breakeven or profit.
3. MFE windows at 5, 10, 15, 30 and 60 minutes.
4. Initial-risk / realized-R analysis.
5. Fixed-duration counterfactual exits.
6. Capture efficiency: realized result divided by favorable excursion.

## Recovered source window and episode population

The Schwab execution history reconstructs the duration fingerprint to preserved precision when the study window is taken as **2026-07-22 09:30 ET through 2026-08-21 inclusive**. The 09:30 ET start boundary is inferred from the benchmark: it removes one premarket Jul 22 winner and yields exactly 384 flat-to-flat same-day stock episodes, 265 winners, 118 losers and one flat trade. The original specification did not preserve this exact timestamp, so this boundary is high-confidence reconstruction evidence rather than proof of the original implementation.

## Recovered historical stop-action semantics

The stop-movement fingerprint is reproduced by strict episode linkage with submitted stop-order actions, including REJECTED modification attempts for the historical study only. This yields 135 winners and 3 losers with a breakeven/profit stop action, median winner timing of 77 seconds, 43.0% within 60 seconds and 63.7% within 120 seconds.

This is deliberately separate from production broker truth. Production `STOP_CHANGED` events exclude rejected actions and represent only accepted broker-state changes.

## Recovered historical R methodology

The best reconstructible initial-risk rule is implemented in `analytics/r-history.mjs` and intentionally contains no symbol- or trade-specific overrides.

A trade enters the historical R subset only when the **first accepted closing stop observed inside the flat-to-flat episode is already on the loss side of the episode blended opening-fill VWAP**. If the first accepted stop is already at breakeven/profit relative to that blended basis, the retained order history does not defensibly reveal the original risk-bearing stop and the trade is excluded.

For qualifying trades, reconstructed initial risk is:

`abs(episode entryVWAP - first accepted loss-side stop) * peak episode quantity`

This rule recovers exactly **83 trades / 35 winners / 48 losers** and reproduces the preserved winner median/mean R (0.31 / 0.60), loser median/mean R (-1.00 / -1.01), winners below +0.5R (68.6%), and winners below +1R (82.9%).

One discrete threshold remains one trade away from the preserved benchmark: the reconstruction produces **27/48 losers at or beyond -1R (56.3%)** versus the preserved **26/48 (54.2%)**. The sole crossing trade is the 2026-08-20 NVDA long. Its full 40-share position was established before the first accepted in-episode stop at 216.76, so episode VWAP was already knowable at stop time. A ±30-minute stop-order forensic found no defensible earlier stop tied to that episode. Therefore the code does **not** introduce a hybrid entry basis or one-trade exception merely to force 54.2%.

The recovered R rule should be treated as a high-confidence reconstruction of the historical analysis, with that one documented source-detail discrepancy. It is not the production ExecutionOS TradeContract risk model.

## Reproduction policy

`expected-results.json` is the historical numerical fingerprint. When the original normalized source dataset is recovered or reconstructed, `run-study.mjs` must reproduce those values within documented tolerances before the rebuilt analytics are considered equivalent to the original study.

Do not reverse-engineer fake trade rows merely to make the regression targets pass. The benchmarks validate real source data; they are not fixtures from which source data should be invented.

The ignored local file `historical-study-trades.json` is enriched from raw Schwab history and normalized episodes. It must not be committed. The enrichment attaches historical stop actions, production stop changes and the recovered initial-risk fields needed for the R report.

## Production evolution

The historical study used simplified market-window counterfactuals. Production ExecutionOS should additionally compute scaling-aware MFE_R / MAE_R from combined realized + unrealized trade value relative to the original contract risk. Both paths are kept deliberately: one for historical reproducibility, one for production telemetry.
