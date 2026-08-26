function entryMs(trade) {
  const value = Date.parse(trade?.entryAt || trade?.firstFillAt || "");
  return Number.isFinite(value) ? value : null;
}

function sampleMs(sample) {
  const value = Date.parse(sample?.timestamp || sample?.at || "");
  return Number.isFinite(value) ? value : null;
}

export function priceAtOrAfter(marketSamples = [], targetMs) {
  const sample = marketSamples
    .map((item) => ({ item, at: sampleMs(item) }))
    .filter((row) => Number.isFinite(row.at) && row.at >= targetMs)
    .sort((a, b) => a.at - b.at)[0]?.item;
  const price = Number(sample?.last ?? sample?.close ?? sample?.price);
  return Number.isFinite(price) ? price : null;
}

export function counterfactualPnlAtDuration(trade, marketSamples = [], holdSec) {
  const start = entryMs(trade);
  const entryPrice = Number(trade?.entryPrice ?? trade?.entryVWAP);
  const quantity = Number(trade?.initialQuantity ?? trade?.quantity);
  if (!Number.isFinite(start) || !Number.isFinite(entryPrice) || !Number.isFinite(quantity) || quantity <= 0) return null;
  const exitPrice = priceAtOrAfter(marketSamples, start + Number(holdSec) * 1000);
  if (!Number.isFinite(exitPrice)) return null;
  const direction = String(trade?.direction || "LONG").toUpperCase();
  return (direction === "SHORT" ? entryPrice - exitPrice : exitPrice - entryPrice) * quantity;
}

export function summarizeFixedDuration(trades = [], holdSec) {
  const rows = trades.map((trade) => {
    const counterfactual = counterfactualPnlAtDuration(trade, trade?.marketSamples || [], holdSec);
    const actual = Number(trade?.realizedPnl ?? trade?.realizedGrossPnl);
    return { id: trade?.id, actual, counterfactual };
  }).filter((row) => Number.isFinite(row.actual) && Number.isFinite(row.counterfactual));

  return {
    holdSec,
    trades: rows.length,
    actualAggregatePnl: rows.reduce((sum, row) => sum + row.actual, 0),
    counterfactualAggregatePnl: rows.reduce((sum, row) => sum + row.counterfactual, 0),
    improvedTrades: rows.filter((row) => row.counterfactual > row.actual).length,
    losingAtCounterfactualExit: rows.filter((row) => row.counterfactual < 0).length,
    rows,
  };
}
