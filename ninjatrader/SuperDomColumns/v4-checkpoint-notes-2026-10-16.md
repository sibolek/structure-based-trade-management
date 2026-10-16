# v4 checkpoint — October 16, 2026

Current source SHA-256: `d93321a3bc75d37c0f2052ed92fec77b43431c7ed772747825d8c3a566bf1920`.
Previous diagnostics build SHA-256: `2294852e8e21311e9baeef67b62f988f61266b1b2acda3d5d6251874e7dec434`.

## Current behavior

The experimental column combines signed legacy/rolling P/S with operational buyer/seller absorption and buy/sell initiative detection. A bounded one-record presentation cache retains the most recent qualified signal, preserves its qualification price/time/metrics, and records subsequent Expired, Invalidated or Suppressed outcomes. A neutral historical marker remains at the original price; tooltip, read-only properties and periodic status output retain details even when that price is off the ladder. Display-space measurement replaces the former blanket 180-logical-unit marker cutoff.

The history addition does not change calculation cores or detector thresholds. Both core regions match 2026-10-15.1 exactly after newline normalization; existing numeric renderers and legacy spoof-like drawing are unchanged.

## Evidence

- 313 local scenarios passed, including 36 new history/display cases.
- Existing 30,000-step detector differential: 1,263 identical transitions.
- Existing full-adapter differential: 1,500 callbacks plus seeded qualification, with identical numeric P/S and original transition fields.
- User-provided ES DEC26 runtime logs identify build 2026-10-16.1. The log records retained qualifications beyond five minutes, replacements by subsequent qualifications, and historical-marker drawing without reported space failures.
- A user screenshot visibly shows a gray `LAST BUY↑ SUP` historical marker.
- Runtime logs show repeated locked-quote pauses. Suppression is distinct from price invalidation and from a measured false positive.

## Limits

The build-time validation manifest retains its original packaging-time native/Git status fields. They describe that earlier snapshot. This note adds subsequent user runtime observations; the containing Git commit and remote branch identify publication status.

Installed source bytes have not been independently attested. A complete native compiler report and all tooltip/layout behaviors have not been independently verified. No independent Astra review of the October 16 display update was performed. Live pattern accuracy and predictive utility have not been measured. ES and MES calibration observations should remain separate.

The checkpoint contains no raw live trading logs, account screenshots or screen recordings. Market recording data and screenshots remain in the original workspace.

## Next proposed work — not part of this checkpoint

A larger fixed last-event summary, with qualification identity separated from the tracking-ending reason, and quote-pause duration/recovery diagnostics. Keep current thresholds unchanged while investigating the frequent quote pauses.
