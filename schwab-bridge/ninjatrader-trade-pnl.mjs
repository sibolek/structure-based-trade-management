// The cash tool supplies posting dates/currencies but no fill/order references.
// Only allocate its charges when every account fill in the requested UTC dates
// belongs wholly to this one round trip. Never apportion a daily fee average.
const CORE_FEES = ['Commission', 'ExchangeFee', 'ClearingFee', 'NfaFee'];
const EXTRA_FEES = ['BrokerageFee', 'IPFee', 'OrderRoutingFee', 'ThirdPartyFee', 'RithmicFee', 'LiquidationFee', 'LiquidationFee2'];
const NON_TRADE = new Set(['NewSession', 'FundTransaction', 'FundTransactionFee', 'TradovateSubscription', 'MarketDataSubscription', 'EntitlementSubscription',
  'InactivityFee', 'AddUserFee', 'DepositFee', 'StopPaymentFee', 'DormantFee', 'AccountClosureFee', 'NsfCheckFee', 'SeatLeasePayment', 'ChallengePayout', 'Escheatment', 'Courtesy', 'GoodwillCredit', 'PROMO']);
const FEES = new Set([...CORE_FEES, ...EXTRA_FEES]);
const unavailable = reason => ({ status: 'UNAVAILABLE', reason, grossPnl: null, fees: null, netPnl: null, currency: null, feeBreakdown: [] });
export function isolatedTradeWindow(summary, fills) {
  if (summary?.status !== 'AVAILABLE' || !Array.isArray(summary.trade?.fillQuantities)) return { reason: 'NO_COMPLETE_TRADE' };
  const trade = summary.trade, startDate = trade.openedAt.slice(0, 10), endDate = trade.closedAt.slice(0, 10);
  if (startDate < summary.startDate || endDate > summary.endDate) return { reason: 'INCOMPLETE_FEE_WINDOW' };
  const allocations = new Map(trade.fillQuantities.map(row => [row.fillId, row.quantity]));
  const rows = fills.filter(fill => fill.accountId === summary.accountId && fill.environment === summary.environment && fill.executionTime.slice(0, 10) >= startDate && fill.executionTime.slice(0, 10) <= endDate);
  if (allocations.size !== trade.fillQuantities.length || rows.length !== allocations.size || rows.some(fill => fill.symbol !== trade.symbol || allocations.get(fill.fillId) !== fill.quantity))
    return { reason: 'FEES_NOT_ATTRIBUTABLE_TO_SINGLE_TRADE' };
  if (rows.some(fill => typeof fill.commission !== 'number' || !Number.isFinite(fill.commission) || fill.commission < 0)) return { reason: 'COMMISSION_NOT_ASSESSED' };
  return { startDate, endDate, fills: rows, reason: null };
}
export function calculateTradeNetPnl({ summary, fills, accountName, accountCurrency, cashHistory, contracts, observedAt }) {
  const window = isolatedTradeWindow(summary, fills);
  if (window.reason) return unavailable(window.reason);
  if (!/^[A-Z]{3}$/.test(accountCurrency || '')) return unavailable('CURRENCY_UNVERIFIED');
  let factor;
  try { factor = 10 ** new Intl.NumberFormat('en-US', { style: 'currency', currency: accountCurrency }).resolvedOptions().maximumFractionDigits; }
  catch { return unavailable('CURRENCY_UNVERIFIED'); }
  const minor = value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const rounded = Math.round(value * factor);
    return Number.isSafeInteger(rounded) && Math.abs(value - rounded / factor) < 1e-7 ? rounded : null;
  };
  const matches = Array.isArray(contracts?.contracts) ? contracts.contracts.filter(row => row.symbol === summary.trade.symbol) : [];
  const spec = matches[0];
  if (matches.length !== 1 || !['Future', 'Futures'].includes(spec?.productType) || ![spec.valuePerPoint, spec.tickSize, spec.tickValue].every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
      || Math.abs(spec.tickSize * spec.valuePerPoint - spec.tickValue) > 1e-8) return unavailable('CONTRACT_VALUE_UNVERIFIED');
  if (!Array.isArray(cashHistory?.items) || cashHistory.items.length >= 5000) return unavailable('CASH_HISTORY_UNVERIFIED');
  const seen = new Set(), counts = new Map(), totals = new Map(); let settlements = 0, settlementCount = 0;
  for (const row of cashHistory.items) {
    if (row?.account !== accountName || !Number.isSafeInteger(row.transactionId) || row.transactionId < 0 || seen.has(row.transactionId)
        || typeof row.timestamp !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(row.timestamp) || !Number.isFinite(Date.parse(row.timestamp))) return unavailable('CASH_HISTORY_UNVERIFIED');
    seen.add(row.transactionId);
    const date = new Date(row.timestamp).toISOString().slice(0, 10);
    if (date < window.startDate || date > window.endDate) continue;
    if (NON_TRADE.has(row.cashChangeType)) continue;
    if (row.cashChangeType !== 'TradePaired' && !FEES.has(row.cashChangeType)) return unavailable('OTHER_LEDGER_ACTIVITY');
    if (row.currency !== accountCurrency || (row.symbol != null && row.symbol !== summary.trade.symbol)) return unavailable('CURRENCY_OR_CONTRACT_MISMATCH');
    const amount = minor(row.delta); if (amount === null) return unavailable('CASH_AMOUNT_UNASSESSED');
    if (row.cashChangeType === 'TradePaired') { settlements += amount; settlementCount++; }
    else { totals.set(row.cashChangeType, (totals.get(row.cashChangeType) || 0) - amount); counts.set(row.cashChangeType, (counts.get(row.cashChangeType) || 0) + 1); }
  }
  const gross = minor(summary.trade.grossPointsPerContract * summary.trade.quantity * spec.valuePerPoint);
  if (gross === null || !settlementCount || gross !== settlements) return unavailable('GROSS_SETTLEMENT_MISMATCH');
  // Require affirmative assessed records for each core fee on each fill. Null,
  // missing components or a zero total alone never establish zero charges.
  if (CORE_FEES.some(type => counts.get(type) !== window.fills.length)) return unavailable('FEE_COMPONENTS_INCOMPLETE');
  const commissions = window.fills.map(fill => minor(fill.commission));
  if (commissions.some(value => value === null) || commissions.reduce((sum, value) => sum + value, 0) !== totals.get('Commission')) return unavailable('COMMISSION_LEDGER_MISMATCH');
  const fees = [...totals.values()].reduce((sum, value) => sum + value, 0), net = gross - fees;
  if (![fees, gross, net].every(Number.isSafeInteger)) return unavailable('CASH_AMOUNT_UNASSESSED');
  return { status: 'AVAILABLE', reason: null, grossPnl: gross / factor, fees: fees / factor, netPnl: net / factor,
    currency: accountCurrency, feeBreakdown: [...totals].map(([type, value]) => ({ type, amount: value / factor })),
    basis: 'RECONSTRUCTED_ISOLATED_CASH_LEDGER_DATES', startDate: window.startDate, endDate: window.endDate, observedAt };
}
