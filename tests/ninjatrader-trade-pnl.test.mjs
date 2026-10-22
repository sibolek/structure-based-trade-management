import test from 'node:test';
import assert from 'node:assert/strict';
import { lastNinjaTraderRoundTrip } from '../schwab-bridge/ninjatrader-round-trip.mjs';
import { isolatedTradeWindow, calculateTradeNetPnl } from '../schwab-bridge/ninjatrader-trade-pnl.mjs';
import { NinjaTraderMonitor } from '../schwab-bridge/ninjatrader-monitor-state.mjs';
import { runNinjaTraderMonitor } from '../schwab-bridge/ninjatrader-monitor.mjs';
const NAME = 'PRIVATE-ACCOUNT-1234', NOW = Date.parse('2026-10-22T12:00:00Z');
const account = { accountId: 'opaque-live', accountDisplay: '••••1234', environment: 'live', currency: 'USD' };
const contracts = { contracts: [{ symbol: 'MESZ6', productType: 'Futures', tickSize: 0.25, tickValue: 1.25, valuePerPoint: 5 }] };
function fixture({ quantity = 1, buy = 7733, sell = 7734.25, short = false, rates = {} } = {}) {
  const fills = [
    { ...account, fillId: 1, orderId: 10, symbol: 'MESZ6', action: short ? 'Sell' : 'Buy', quantity, price: short ? sell : buy, executionTime: '2026-10-22T05:56:04.016Z', commission: 0.39 * quantity },
    { ...account, fillId: 2, orderId: 11, symbol: 'MESZ6', action: short ? 'Buy' : 'Sell', quantity, price: short ? buy : sell, executionTime: '2026-10-22T05:57:25.992Z', commission: 0.39 * quantity },
  ];
  const summary = lastNinjaTraderRoundTrip({ account, fills, positions: [], startDate: '2026-10-21', endDate: '2026-10-23', observedAt: new Date(NOW).toISOString(), positionSnapshotStartedAt: new Date(NOW).toISOString() });
  const cashHistory = { items: [] }; let transactionId = 10;
  for (const fill of fills) for (const [cashChangeType, perContract] of Object.entries({ Commission: 0.39, ExchangeFee: 0.35, ClearingFee: 0.19, NfaFee: 0.01, ...rates })) {
    if (cashChangeType === 'Commission') fill.commission = perContract * fill.quantity;
    cashHistory.items.push({ account: NAME, transactionId: transactionId++, symbol: 'MESZ6', timestamp: new Date(Date.parse(fill.executionTime) + 10).toISOString(), currency: 'USD', cashChangeType, delta: -perContract * fill.quantity });
  }
  cashHistory.items.push({ account: NAME, transactionId: transactionId++, symbol: 'MESZ6', timestamp: '2026-10-22T05:57:26.003Z', currency: 'USD', cashChangeType: 'TradePaired', delta: (sell - buy) * quantity * 5 });
  const args = { summary, fills, accountName: NAME, accountCurrency: 'USD', cashHistory, contracts: structuredClone(contracts), observedAt: new Date(NOW).toISOString() };
  return { args, fills, summary, cashHistory, calculate: () => calculateTradeNetPnl(args) };
}
test('net deducts assessed exchange, clearing, regulatory and commission charges exactly once', () => {
  const result = fixture().calculate(); assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.grossPnl, 6.25); assert.equal(result.fees, 1.88); assert.equal(result.netPnl, 4.37); assert.equal(result.currency, 'USD');
  assert.equal(result.feeBreakdown.find(row => row.type === 'Commission').amount, 0.78);
  assert.equal(result.feeBreakdown.find(row => row.type === 'ExchangeFee').amount, 0.70);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-ACCOUNT/);
});
test('short, losing and price-break-even trades retain their real net signs', () => {
  assert.equal(fixture({ short: true }).calculate().netPnl, 4.37);
  assert.equal(fixture({ buy: 7734.25, sell: 7733 }).calculate().netPnl, -8.13);
  assert.equal(fixture({ sell: 7733 }).calculate().netPnl, -1.88);
});
test('multi-contract fills use total assessed commission, not a second quantity multiplication', () => {
  const result = fixture({ quantity: 2 }).calculate(); assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.grossPnl, 12.5); assert.equal(result.fees, 3.76); assert.equal(result.netPnl, 8.74);
});
test('explicit zero fees and commission are different from missing or unassessed amounts', () => {
  const zero = fixture({ rates: { Commission: 0, ExchangeFee: 0, ClearingFee: 0, NfaFee: 0 } });
  assert.equal(zero.calculate().netPnl, 6.25);
  for (const value of [null, undefined, NaN, -0.39]) {
    const f = fixture(); f.fills[0].commission = value; assert.equal(f.calculate().reason, 'COMMISSION_NOT_ASSESSED');
  }
  const missing = fixture(); missing.cashHistory.items = missing.cashHistory.items.filter(row => row.cashChangeType !== 'NfaFee');
  assert.equal(missing.calculate().reason, 'FEE_COMPONENTS_INCOMPLETE');
  const unassessed = fixture(); unassessed.cashHistory.items[0].delta = null; assert.equal(unassessed.calculate().reason, 'CASH_AMOUNT_UNASSESSED');
});
test('a second completed or open trade in the UTC dates prevents assigning account-wide fees to this trade', () => {
  const f = fixture(); f.fills.push({ ...f.fills[0], fillId: 3, executionTime: '2026-10-22T06:00:00Z' });
  assert.equal(isolatedTradeWindow(f.summary, f.fills).reason, 'FEES_NOT_ATTRIBUTABLE_TO_SINGLE_TRADE');
  assert.equal(f.calculate().netPnl, null);
});
test('unrelated accounts outside the selected account are not merged into its fill window', () => {
  const f = fixture(); f.fills.push({ ...f.fills[0], accountId: 'other', fillId: 3 });
  assert.equal(f.calculate().netPnl, 4.37);
});
test('reversal portions cannot be charged the whole shared fill fee', () => {
  const f = fixture(); f.fills[1].quantity = 3;
  const summary = lastNinjaTraderRoundTrip({ account, fills: f.fills, positions: [{ ...account, symbol: 'MESZ6', quantity: -2 }], startDate: '2026-10-21', endDate: '2026-10-23', observedAt: new Date(NOW).toISOString(), positionSnapshotStartedAt: new Date(NOW).toISOString() });
  assert.equal(summary.trade.quantity, 1); assert.equal(summary.trade.fillQuantities.find(row => row.fillId === 2).quantity, 1);
  assert.equal(isolatedTradeWindow(summary, f.fills).reason, 'FEES_NOT_ATTRIBUTABLE_TO_SINGLE_TRADE');
});
test('cash duplicates, oversized history, wrong account and malformed timestamps are refused', () => {
  const duplicate = fixture(); duplicate.cashHistory.items.push({ ...duplicate.cashHistory.items[0] }); assert.equal(duplicate.calculate().reason, 'CASH_HISTORY_UNVERIFIED');
  const oversized = fixture(); oversized.cashHistory.items = Array(5000).fill(oversized.cashHistory.items[0]); assert.equal(oversized.calculate().reason, 'CASH_HISTORY_UNVERIFIED');
  for (const extra of [{ account: 'OTHER' }, { timestamp: 'yesterday' }, { transactionId: 1.5 }]) {
    const f = fixture(); Object.assign(f.cashHistory.items[0], extra); assert.equal(f.calculate().reason, 'CASH_HISTORY_UNVERIFIED');
  }
});
test('mixed currency and exact-contract mismatches never become dollar net P/L', () => {
  for (const extra of [{ currency: 'EUR' }, { symbol: 'MESH7' }]) {
    const f = fixture(); Object.assign(f.cashHistory.items[0], extra); assert.equal(f.calculate().reason, 'CURRENCY_OR_CONTRACT_MISMATCH');
  }
  const unknown = fixture(); unknown.args.accountCurrency = null; assert.equal(unknown.calculate().reason, 'CURRENCY_UNVERIFIED');
});
test('trade corrections and unknown ledger debits are not silently excluded', () => {
  for (const cashChangeType of ['CancelledPairedTrade', 'ManualAdjustment', 'AutomaticReconciliation', 'UnknownFee']) {
    const f = fixture(); f.cashHistory.items.push({ ...f.cashHistory.items[0], transactionId: 99, cashChangeType });
    assert.equal(f.calculate().reason, 'OTHER_LEDGER_ACTIVITY');
  }
});
test('recurring subscriptions and funding movements are not trading fees', () => {
  const f = fixture(); f.cashHistory.items.push({ ...f.cashHistory.items[0], transactionId: 99, cashChangeType: 'MarketDataSubscription', delta: -12 });
  f.cashHistory.items.push({ ...f.cashHistory.items[0], transactionId: 100, cashChangeType: 'FundTransaction', delta: 1000 });
  assert.equal(f.calculate().netPnl, 4.37);
});
test('gross must reconcile to an actual broker settlement, including a legitimate zero settlement', () => {
  const missing = fixture(); missing.cashHistory.items.pop(); assert.equal(missing.calculate().reason, 'GROSS_SETTLEMENT_MISMATCH');
  const mismatch = fixture(); mismatch.cashHistory.items.at(-1).delta = 7.5; assert.equal(mismatch.calculate().reason, 'GROSS_SETTLEMENT_MISMATCH');
  const commission = fixture(); commission.cashHistory.items[0].delta = -0.4; assert.equal(commission.calculate().reason, 'COMMISSION_LEDGER_MISMATCH');
  assert.equal(fixture({ sell: 7733 }).calculate().grossPnl, 0);
});
test('contract metadata must match exactly and tick-value arithmetic must agree', () => {
  for (const extra of [{ symbol: 'MESH7' }, { productType: 'Stock' }, { valuePerPoint: null }, { tickValue: 2.5 }]) {
    const f = fixture(); Object.assign(f.args.contracts.contracts[0], extra); assert.equal(f.calculate().reason, 'CONTRACT_VALUE_UNVERIFIED');
  }
});

function monitorFixture({ cashAvailable = true } = {}) {
  const f = fixture(), calls = [], announcements = []; let now = NOW, feeFailure = false;
  const rawFills = f.fills.map(fill => ({ account: NAME, fillId: fill.fillId, orderId: fill.orderId, symbol: fill.symbol, action: fill.action, quantity: fill.quantity, price: fill.price, timestamp: fill.executionTime, commission: fill.commission }));
  const client = { toolCatalog: async () => ['my_portfolio', 'fill_history', 'search_contracts', ...(cashAvailable ? ['cash_history'] : [])].map(name => ({ name })),
    readAccountList: async () => [{ name: NAME }], callTool: async name => {
      calls.push(name);
      if (name === 'my_portfolio') return { account: { name: NAME, currency: 'USD', netLiq: 3200, cashBalance: 3200, openPnL: 0 }, positions: [], workingOrders: [] };
      if (name === 'fill_history') return { items: structuredClone(rawFills) };
      if (name === 'search_contracts') return structuredClone(contracts);
      if (name === 'cash_history') { if (feeFailure) throw new Error('NINJATRADER_RATE_LIMIT_COOLDOWN'); return structuredClone(f.cashHistory); }
      throw new Error('Unexpected tool');
    } };
  const monitor = new NinjaTraderMonitor({ client, environment: 'live', now: () => now, onFill: fill => announcements.push(fill) });
  return { ...f, client, monitor, calls, announcements, rawFills, now: () => now, advance: () => { now += 15000; }, failFees: () => { feeFailure = true; } };
}
test('startup reads cash and contract metadata once; regular polls never repeat fee reporting or old fills', async () => {
  const f = monitorFixture(); await f.monitor.initialize(); assert.equal(f.monitor.snapshot().startupRoundTrips[0].pnl.netPnl, 4.37);
  const before = structuredClone(f.monitor.snapshot().startupRoundTrips);
  f.advance(); await f.monitor.poll(); f.advance(); await f.monitor.poll({ readFills: false });
  assert.equal(f.calls.filter(name => name === 'cash_history').length, 1); assert.equal(f.calls.filter(name => name === 'search_contracts').length, 1);
  assert.deepEqual(f.monitor.snapshot().startupRoundTrips, before); assert.equal(f.announcements.length, 0);
  assert.equal(f.monitor.snapshot().executionEnabled, false); assert.doesNotMatch(JSON.stringify(f.monitor.snapshot()), /PRIVATE-ACCOUNT/);
});
test('missing fee capability or an optional fee-read failure does not break baseline observations', async () => {
  const missing = monitorFixture({ cashAvailable: false }); await missing.monitor.initialize();
  assert.equal(missing.monitor.snapshot().startupRoundTrips[0].pnl.reason, 'CASH_HISTORY_UNAVAILABLE'); assert.equal(missing.calls.length, 2);
  const failed = monitorFixture(); failed.failFees(); await failed.monitor.initialize();
  assert.equal(failed.monitor.snapshot().status, 'OBSERVING'); assert.equal(failed.monitor.snapshot().baselineFillCount, 2);
  assert.equal(failed.monitor.snapshot().startupRoundTrips[0].pnl.reason, 'BROKER_FEE_READ_UNAVAILABLE'); assert.equal(failed.announcements.length, 0);
});
test('another same-day trade skips speculative fee and metadata requests', async () => {
  const f = monitorFixture(); f.rawFills.push({ ...f.rawFills[0], fillId: 3, timestamp: '2026-10-22T04:00:00Z' }, { ...f.rawFills[1], fillId: 4, timestamp: '2026-10-22T04:01:00Z' });
  await f.monitor.initialize(); assert.equal(f.monitor.snapshot().startupRoundTrips[0].pnl.reason, 'FEES_NOT_ATTRIBUTABLE_TO_SINGLE_TRADE');
  assert.deepEqual(f.calls, ['my_portfolio', 'fill_history']);
});
test('the one-time startup block prints gross, all fees and net without announcing historical executions', async () => {
  const f = monitorFixture(), lines = [];
  const state = await runNinjaTraderMonitor({ settings: { environment: 'live', pollMs: 15000, accountSelectors: [], timeZone: 'America/Denver', once: true }, client: f.client, now: f.now, log: line => lines.push(line) });
  assert.match(lines.join('\n'), /Gross P\/L:\s+\$6\.25/); assert.match(lines.join('\n'), /Fees & comm\.:\s+\$1\.88/); assert.match(lines.join('\n'), /Net P\/L:\s+\$4\.37/);
  assert.match(lines.join('\n'), /Reconstructed from isolated posted ledger charges/);
  assert.doesNotMatch(lines.join('\n'), /\| BUY |\| SELL |PRIVATE/); assert.equal(state.executionEnabled, false);
});
