export function captureEfficiency(realized, mfe) {
  const actual = Number(realized);
  const opportunity = Number(mfe);
  return Number.isFinite(actual) && Number.isFinite(opportunity) && opportunity > 0 ? actual / opportunity : null;
}

export function summarizeCapture(rows = []) {
  const valid = rows
    .map((row) => ({ realized: Number(row?.realizedPnl), mfe: Number(row?.mfeDollars) }))
    .filter((row) => Number.isFinite(row.realized) && Number.isFinite(row.mfe) && row.mfe > 0);
  const aggregateRealized = valid.reduce((sum, row) => sum + row.realized, 0);
  const aggregateMfe = valid.reduce((sum, row) => sum + row.mfe, 0);
  return {
    trades: valid.length,
    aggregateRealized,
    aggregateMfe,
    aggregateCapture: captureEfficiency(aggregateRealized, aggregateMfe),
    perTrade: valid.map((row) => ({ ...row, capture: captureEfficiency(row.realized, row.mfe) })),
  };
}
