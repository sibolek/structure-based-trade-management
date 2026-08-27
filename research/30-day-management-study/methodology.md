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

## Historical 19-trade market-study provenance

The retained evidence preserves the numerical fingerprint of a **19-trade stratified sample of fast winners**, but it does not preserve the 19 exact trade identities or the original sampling implementation.

A strong execution-only clue was recovered: **189 of the 265 winners were held for 209 seconds or less**, where 209 seconds is the preserved median-loser hold horizon used by the fixed-duration study. Ten percent of 189 is 18.9, naturally yielding a 19-trade sample. This supports, but does not prove, an eligibility interpretation of “fast winners” as winners exited within the median-loser horizon followed by an approximately 10% stratified sample.

To avoid outcome-fitting, the reconstruction froze a finite set of standard sampling rules before market-data validation: chronological and duration-sorted 1-in-10 systematic samples, equal-count 19-stratum representatives, and proportional-by-trading-day strata. These produced 27 predeclared 19-trade candidates. No arbitrary trade combinations were searched.

## Schwab historical 1-minute market data

The Schwab Market Data `GET /marketdata/v1/pricehistory` endpoint was validated read-only against the recovered study window. A test request for NVDA on 2026-08-20 returned 765 one-minute OHLCV candles with extended-hours coverage. The reconstruction therefore has a viable same-broker historical 1-minute source and does not require a substitute vendor for this preservation work.

For the 27 frozen candidate samples, 86 unique symbol/day minute histories were retrieved from Schwab and cached only in a local Git-ignored research file. The preserved market-study fingerprints were then used strictly as validation outputs:

- actual P/L: +$86.46;
- 209-second counterfactual: +$111.30, 6/19 improved;
- 842-second counterfactual: +$18.16, 11/19 losing;
- aggregate MFE: approximately $387 / $513 / $687 / $858 / $1,185 at 5 / 10 / 15 / 30 / 60 minutes;
- at least 2× realized profit reached by 15/19 at 5m, 16/19 at 10m, and 17/19 at 60m.

No predeclared candidate reproduced that fingerprint across the independent metrics. The best market-only candidate under the initial minute convention was `duration systematic offset 5`, but it materially missed the preserved actual P/L and several MFE/counterfactual statistics.

Because the historical work used 1-minute bars but did not preserve the bar-alignment convention for second-level trade entries, the same frozen 27 candidates were also tested under standard timestamp interpretations: next-minute-start close, containing-minute close, last-completed-minute close, and next-minute-start open, each with entry-minute overlap/exclusion where applicable. No new samples were generated.

The best standard alignment was **containing-minute close with entry-minute overlap**, which improved the market-only score but still missed multiple independent fingerprints simultaneously (including 209-second improved count, 842-second loser count, and the 2×-MFE counts). Bar alignment therefore does not explain the missing provenance.

### Preservation conclusion for MFE / capture / fixed-duration studies

The exact original 19 trade identities are **unresolved and not defensibly recoverable from the retained evidence**. The original market-study numerical benchmarks remain preserved as historical evidence, and the analytical formulas remain preserved and tested, but the project must not claim exact historical reproduction of the 19-trade MFE, capture-efficiency, or fixed-duration sample without the original membership list or an independently recovered sampling rule.

Do **not** search arbitrary combinations of 19 trades, custom offsets, symbol exclusions, or timing rules after seeing the benchmark values merely to manufacture a match. Any future replacement sample must be defined deterministically before observing its market outcomes and must be reported as a **new reproducible study**, not as recovery of the original historical sample.

## Preservation status

| Analysis | Status |
| --- | --- |
| Winner / loser duration | Recovered to preserved precision |
| Historical stop-management timing | Recovered to preserved precision |
| Initial-risk / realized-R | High-confidence recovery; one documented one-trade threshold discrepancy |
| 19-trade MFE windows | Benchmark + formula preserved; exact sample membership unresolved |
| 19-trade capture efficiency | Benchmark + formula preserved; exact sample membership unresolved |
| 19-trade fixed-duration counterfactuals | Benchmark + formula preserved; exact sample membership unresolved |

## Reproduction policy

`expected-results.json` is the historical numerical fingerprint. When an original normalized source dataset or independently evidenced sample membership is recovered, `run-study.mjs` may be used to test reproduction within documented tolerances.

Do not reverse-engineer fake trade rows or trade membership merely to make regression targets pass. The benchmarks validate source evidence; they are not fixtures from which source data should be invented.

The ignored local file `historical-study-trades.json` is enriched from raw Schwab history and normalized episodes. It must not be committed. The enrichment attaches historical stop actions, production stop changes and the recovered initial-risk fields needed for the R report. Schwab minute-history cache files used by diagnostics must also remain local and ignored.

## Production evolution

The historical study used simplified market-window counterfactuals. Production ExecutionOS should additionally compute scaling-aware MFE_R / MAE_R from combined realized + unrealized trade value relative to the original contract risk. Both paths are kept deliberately: one for historical benchmark preservation, one for production telemetry.
