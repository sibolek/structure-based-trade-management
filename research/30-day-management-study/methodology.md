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

## Reproduction policy

`expected-results.json` is the historical numerical fingerprint. When the original normalized source dataset is recovered or reconstructed, `run-study.mjs` must reproduce those values within documented tolerances before the rebuilt analytics are considered equivalent to the original study.

Do not reverse-engineer fake trade rows merely to make the regression targets pass. The benchmarks validate real source data; they are not fixtures from which source data should be invented.

## Production evolution

The historical study used simplified market-window counterfactuals. Production ExecutionOS should additionally compute scaling-aware MFE_R / MAE_R from combined realized + unrealized trade value relative to the original contract risk. Both paths are kept deliberately: one for historical reproducibility, one for production telemetry.
