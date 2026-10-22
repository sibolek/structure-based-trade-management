// Historical presentation only. This never updates live broker positions.
// Anchor the recent history to the independent ending position, rather than
// assuming the first returned fill opened a flat account. The bounded history
// and portfolio/fill reads are not a broker-certified atomic trade ledger.
export function lastNinjaTraderRoundTrip({ account, positions, fills, startDate, endDate, observedAt, positionSnapshotStartedAt }) {
  const result = { accountId: account.accountId, accountDisplay: account.accountDisplay, environment: account.environment,
    status: 'NOT_FOUND', reason: 'NO_COMPLETE_ROUND_TRIP_IN_RECENT_HISTORY', trade: null,
    startDate, endDate, observedAt, basis: 'RECONSTRUCTED_RECENT_FILLS_AND_POSITION_SNAPSHOT' };
  const selected = fills.filter(fill => fill.accountId === account.accountId && fill.environment === account.environment);
  if (!selected.length) return result;
  // Portfolio is read before fill history. Do not infer historical inventory
  // from that older position if the history includes activity during/after the
  // portfolio request. Different source/local clocks may also make this unknown.
  if (!Number.isFinite(Date.parse(positionSnapshotStartedAt)) || selected.some(fill => Date.parse(fill.executionTime) >= Date.parse(positionSnapshotStartedAt)))
    return { ...result, status: 'UNAVAILABLE', reason: 'POSITION_AND_FILL_TIMING_OVERLAP' };
  const bySymbol = new Map();
  for (const fill of selected) {
    if (!bySymbol.has(fill.symbol)) bySymbol.set(fill.symbol, []);
    bySymbol.get(fill.symbol).push(fill);
  }
  let latest = null, latestIncomplete = -Infinity, ambiguous = false;
  for (const [symbol, rows] of bySymbol) {
    rows.sort((a, b) => Date.parse(a.executionTime) - Date.parse(b.executionTime) || a.fillId - b.fillId);
    const ending = positions.find(position => position.accountId === account.accountId && position.environment === account.environment && position.symbol === symbol)?.quantity ?? 0;
    let quantity = ending - rows.reduce((total, fill) => total + (fill.action === 'Buy' ? fill.quantity : -fill.quantity), 0);
    if (!Number.isSafeInteger(quantity)) { ambiguous = true; continue; }
    let cycle = null, symbolAmbiguous = false;
    for (let index = 0; index < rows.length;) {
      // Simultaneous same-side partial fills can be combined without assuming
      // fill IDs encode chronology. Opposing fills at the same timestamp cannot.
      const batch = []; const timestamp = rows[index].executionTime;
      while (index < rows.length && rows[index].executionTime === timestamp) batch.push(rows[index++]);
      if (batch.some(fill => fill.action !== batch[0].action)) { symbolAmbiguous = true; break; }
      const side = batch[0].action === 'Buy' ? 1 : -1;
      let remaining = batch.reduce((total, fill) => total + fill.quantity, 0);
      const batchQuantity = remaining;
      const price = batch.reduce((total, fill) => total + fill.quantity * fill.price, 0) / remaining;
      if (!Number.isSafeInteger(remaining) || !Number.isFinite(price)) { symbolAmbiguous = true; break; }
      if (quantity && Math.sign(quantity) !== side && remaining > Math.abs(quantity) && batch.some(fill => fill.price !== batch[0].price)) {
        symbolAmbiguous = true; break; // Cannot allocate tied reversal prices.
      }
      if (quantity && Math.sign(quantity) !== side) {
        const closed = Math.min(Math.abs(quantity), remaining);
        if (cycle) {
          cycle.exitQuantity += closed; cycle.exitValue += closed * price;
          for (const fill of batch) cycle.fills.set(fill.fillId, (cycle.fills.get(fill.fillId) || 0) + fill.quantity * (closed / batchQuantity));
        }
        quantity += side * closed; remaining -= closed;
        if (quantity === 0) {
          if (cycle) {
            const trade = { symbol, direction: cycle.direction, quantity: cycle.entryQuantity, peakQuantity: cycle.peakQuantity,
              entryAverage: cycle.entryValue / cycle.entryQuantity, exitAverage: cycle.exitValue / cycle.exitQuantity,
              openedAt: cycle.openedAt, closedAt: timestamp, fillQuantities: [...cycle.fills].map(([fillId, quantity]) => ({ fillId, quantity })) };
            trade.grossPointsPerContract = (trade.exitAverage - trade.entryAverage) * (trade.direction === 'LONG' ? 1 : -1);
            if (!Number.isSafeInteger(trade.quantity) || cycle.entryQuantity !== cycle.exitQuantity || !Number.isFinite(trade.grossPointsPerContract)) { symbolAmbiguous = true; break; }
            if (!latest || Date.parse(trade.closedAt) > Date.parse(latest.closedAt)) latest = trade;
            else if (trade.closedAt === latest.closedAt) { symbolAmbiguous = true; break; }
          } else latestIncomplete = Math.max(latestIncomplete, Date.parse(timestamp));
          cycle = null;
        }
      }
      if (remaining) {
        if (quantity === 0) cycle = { direction: side > 0 ? 'LONG' : 'SHORT', openedAt: timestamp,
          entryQuantity: 0, entryValue: 0, exitQuantity: 0, exitValue: 0, peakQuantity: 0, fills: new Map() };
        quantity += side * remaining;
        if (!Number.isSafeInteger(quantity)) { symbolAmbiguous = true; break; }
        if (cycle) {
          cycle.entryQuantity += remaining; cycle.entryValue += remaining * price;
          cycle.peakQuantity = Math.max(cycle.peakQuantity, Math.abs(quantity));
          for (const fill of batch) cycle.fills.set(fill.fillId, (cycle.fills.get(fill.fillId) || 0) + fill.quantity * (remaining / batchQuantity));
        }
      }
    }
    if (symbolAmbiguous || quantity !== ending) ambiguous = true;
  }
  if (ambiguous) return { ...result, status: 'UNAVAILABLE', reason: 'AMBIGUOUS_FILL_SEQUENCE' };
  if (latestIncomplete >= (latest ? Date.parse(latest.closedAt) : -Infinity) && latestIncomplete !== -Infinity)
    return { ...result, status: 'UNAVAILABLE', reason: 'LATEST_CLOSING_ACTIVITY_HAS_INCOMPLETE_ENTRY_HISTORY' };
  return latest ? { ...result, status: 'AVAILABLE', reason: null, trade: latest } : result;
}
