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
