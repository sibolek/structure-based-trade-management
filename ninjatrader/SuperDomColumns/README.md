# ExecutionOS Pulling/Stacking SuperDOM Column

`ExecutionOSPullingStacking.cs` is the canonical source for the custom
ExecutionOS Pulling/Stacking column. It exists to preserve the stock
pulling/stacking behavior while avoiding the null-reference failure observed
in NinjaTrader's built-in column.

## Compatibility and installation

- Built and live-tested with NinjaTrader 8.1.8.2.
- Install to
  `Documents\NinjaTrader 8\bin\Custom\SuperDomColumns\ExecutionOSPullingStacking.cs`.
- Compile from the NinjaScript Editor, then add **ExecutionOS Pulling/Stacking**
  to a SuperDOM.

## Version 1

- Bid and ask values use NinjaTrader's volume-column foreground color.
- Bid and ask backgrounds use NinjaTrader's price-column background color.
- Live MES depth values populate on both sides.
- Column-label reset and bid/ask-change reset were exercised.
- No `OnMarketDepth` null-reference failure was observed.
- Layout and Recent-column alignment were verified after column reordering.

The v1 commit is the known-good baseline. Cosmetic changes should not alter the
pulling/stacking calculations or null-safety behavior.

## Version 1.1

- Bid and ask values are centered within their respective column halves.
- Bid stacking and ask pulling are lime green.
- Bid pulling and ask stacking are red.
- Zero values retain the configured side foreground color.
- Values remain culture-aware signed integers, including the minus sign for
  pulling values.
- Pulling/stacking calculations, reset behavior, and null guards are unchanged
  from v1.

## Version 1.2

Version 1.2 adds a configurable spoof-like activity alert. It watches for a
large stack near the inside market that is mostly pulled within a short window
while little of the stack executes.

Balanced defaults:

- Minimum stack: 100 contracts within the first 3 depth levels.
- Pull threshold: 80% within 1,500 milliseconds.
- Maximum executed volume: 10% of the peak stack.
- Repeat window: 10 seconds; a second event escalates `S?` to `S!`.
- Visual alert: amber outline and marker for 3 seconds.
- Audible alert: NinjaTrader `Alert2.wav`, with a 3-second cooldown.
- Custom PCM `.wav` files can be selected in the column properties.

The alert identifies behavior consistent with rapid stacking and pulling. It
does not establish trader identity or intent and must not be treated as a legal
determination of spoofing. Pulling/stacking calculations remain unchanged.

Status: implementation and static review complete; NinjaTrader compilation and
live-market threshold calibration are pending.
