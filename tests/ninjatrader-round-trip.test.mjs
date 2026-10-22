import test from 'node:test';
import assert from 'node:assert/strict';
import { lastNinjaTraderRoundTrip } from '../schwab-bridge/ninjatrader-round-trip.mjs';
import { NinjaTraderMonitor } from '../schwab-bridge/ninjatrader-monitor-state.mjs';
import { runNinjaTraderMonitor } from '../schwab-bridge/ninjatrader-monitor.mjs';
import { createNinjaTraderMonitorApi } from '../schwab-bridge/ninjatrader-monitor-api.mjs';

const account = { accountId: 'opaque-live-account', accountDisplay: '••••1234', environment: 'live' };
const BASE = Date.parse('2026-10-21T14:00:00Z'), SNAPSHOT = '2026-10-22T15:00:00Z';
const fill = (fillId, action, quantity, price, second = fillId, extra = {}) => ({ ...account, symbol: 'MESZ6', fillId, action, quantity, price,
  executionTime: new Date(BASE + second * 1000).toISOString(), ...extra });
const position = (quantity, symbol = 'MESZ6', extra = {}) => ({ ...account, symbol, quantity, ...extra });
const summary = (fills, positions = [], extra = {}) => lastNinjaTraderRoundTrip({ account, fills, positions,
  startDate: '2026-10-21', endDate: '2026-10-23', observedAt: SNAPSHOT, positionSnapshotStartedAt: SNAPSHOT, ...extra });
test('complete long and short cycles retain direction, source prices, quantities and exact times', () => {
  const long = summary([fill(1, 'Buy', 1, 7771.75), fill(2, 'Sell', 1, 7774.25)]);
  assert.equal(long.status, 'AVAILABLE'); assert.equal(long.trade.symbol, 'MESZ6'); assert.equal(long.trade.direction, 'LONG');
  assert.equal(long.trade.quantity, 1); assert.equal(long.trade.entryAverage, 7771.75); assert.equal(long.trade.exitAverage, 7774.25);
  assert.equal(long.trade.grossPointsPerContract, 2.5); assert.equal(long.trade.openedAt, fill(1).executionTime); assert.equal(long.trade.closedAt, fill(2).executionTime);
  const short = summary([fill(1, 'Sell', 2, 100), fill(2, 'Buy', 2, 98.25)]);
  assert.equal(short.trade.direction, 'SHORT'); assert.equal(short.trade.quantity, 2); assert.equal(short.trade.grossPointsPerContract, 1.75);
  assert.equal(Object.hasOwn(short.trade, 'netPnl'), false); assert.equal(Object.hasOwn(short.trade, 'grossDollarPnl'), false);
});
test('scale-in, partial exits and re-adds use all contracts and weighted averages, not peak quantity', () => {
  const result = summary([fill(1, 'Buy', 1, 100), fill(2, 'Buy', 2, 103), fill(3, 'Sell', 1, 105), fill(4, 'Buy', 1, 102), fill(5, 'Sell', 3, 104)]);
  assert.equal(result.trade.quantity, 4); assert.equal(result.trade.peakQuantity, 3);
  assert.equal(result.trade.entryAverage, 102); assert.equal(result.trade.exitAverage, 104.25); assert.equal(result.trade.grossPointsPerContract, 2.25);
});
test('the latest completed cycle is selected while a newer position remains open', () => {
  const result = summary([fill(5, 'Buy', 1, 110), fill(4, 'Buy', 1, 105), fill(2, 'Sell', 1, 102), fill(1, 'Buy', 1, 100), fill(3, 'Sell', 1, 106)], [position(1)]);
  assert.equal(result.trade.direction, 'SHORT'); assert.equal(result.trade.entryAverage, 106); assert.equal(result.trade.exitAverage, 105);
  assert.equal(result.trade.closedAt, fill(4).executionTime);
});
test('a reversal splits closing and opening quantities at the actual reversal fill', () => {
  const rows = [fill(1, 'Buy', 1, 100), fill(2, 'Sell', 3, 105)];
  const first = summary(rows, [position(-2)]);
  assert.equal(first.trade.direction, 'LONG'); assert.equal(first.trade.quantity, 1); assert.equal(first.trade.exitAverage, 105);
  const second = summary([...rows, fill(3, 'Buy', 2, 103)]);
  assert.equal(second.trade.direction, 'SHORT'); assert.equal(second.trade.quantity, 2); assert.equal(second.trade.entryAverage, 105);
  assert.equal(second.trade.openedAt, fill(2).executionTime); assert.equal(second.trade.grossPointsPerContract, 2);
});
test('a carry-in closing fill never becomes an invented short or long trade', () => {
  assert.equal(summary([fill(1, 'Sell', 1, 100)]).reason, 'LATEST_CLOSING_ACTIVITY_HAS_INCOMPLETE_ENTRY_HISTORY');
  assert.equal(summary([fill(1, 'Buy', 1, 100)]).status, 'UNAVAILABLE');
  const result = summary([fill(1, 'Sell', 1, 100), fill(2, 'Buy', 2, 101), fill(3, 'Sell', 2, 104)]);
  assert.equal(result.status, 'AVAILABLE'); assert.equal(result.trade.direction, 'LONG'); assert.equal(result.trade.quantity, 2);
});
test('newer incomplete closing activity prevents presenting an older known trade as the latest', () => {
  const result = summary([fill(1, 'Buy', 1, 100), fill(2, 'Sell', 1, 101), fill(3, 'Buy', 1, 200, 3, { symbol: 'MESH7' })]);
  assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.trade, null);
});
test('no fills or only an open position produce an explicit bounded not-found result', () => {
  assert.equal(summary([]).reason, 'NO_COMPLETE_ROUND_TRIP_IN_RECENT_HISTORY');
  const open = summary([fill(1, 'Buy', 1, 100)], [position(1)]); assert.equal(open.status, 'NOT_FOUND'); assert.equal(open.trade, null);
});
test('accounts, environments and exact contract months cannot be paired together', () => {
  const rows = [fill(1, 'Buy', 1, 100), fill(2, 'Sell', 1, 101),
    fill(3, 'Sell', 1, 500, 3, { accountId: 'other' }), fill(4, 'Buy', 1, 400, 4, { environment: 'demo' })];
  assert.equal(summary(rows).trade.grossPointsPerContract, 1);
  const contracts = summary([fill(1, 'Buy', 1, 100), fill(2, 'Sell', 1, 200, 2, { symbol: 'MESH7' })], [position(1), position(-1, 'MESH7')]);
  assert.equal(contracts.status, 'NOT_FOUND');
});
test('same-side simultaneous partial fills combine by weight without assuming fill-ID chronology', () => {
  const result = summary([fill(7, 'Buy', 1, 100, 1), fill(1, 'Buy', 1, 102, 1), fill(2, 'Sell', 2, 104, 2)]);
  assert.equal(result.trade.entryAverage, 101); assert.equal(result.trade.quantity, 2); assert.equal(result.trade.grossPointsPerContract, 3);
});
test('opposing simultaneous fills, tied cross-instrument exits and ambiguous reversal allocation are unavailable', () => {
  for (const rows of [
    [fill(1, 'Buy', 1, 100, 1), fill(2, 'Sell', 1, 101, 1)],
    [fill(1, 'Buy', 1, 100, 1), fill(2, 'Sell', 1, 101, 2), fill(3, 'Buy', 1, 200, 1, { symbol: 'MESH7' }), fill(4, 'Sell', 1, 201, 2, { symbol: 'MESH7' })],
    [fill(1, 'Buy', 1, 100, 1), fill(2, 'Sell', 1, 101, 2), fill(3, 'Sell', 2, 102, 2)],
  ]) assert.equal(summary(rows, rows.length === 3 ? [position(-2)] : []).reason, 'AMBIGUOUS_FILL_SEQUENCE');
});
test('a fill overlapping the earlier position read does not create a false round trip', () => {
  const rows = [fill(1, 'Buy', 1, 100, 1), fill(2, 'Sell', 1, 101, 2), fill(3, 'Buy', 1, 102, 3)];
  const result = summary(rows, [], { positionSnapshotStartedAt: new Date(BASE + 2500).toISOString() });
  assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.reason, 'POSITION_AND_FILL_TIMING_OVERLAP'); assert.equal(result.trade, null);
  assert.equal(summary(rows, [], { positionSnapshotStartedAt: rows.at(-1).executionTime }).status, 'UNAVAILABLE');
});
test('nonfinite totals and unsafe quantities cannot produce a numerical trade result', () => {
  const result = summary([fill(1, 'Buy', 2, Number.MAX_VALUE), fill(2, 'Sell', 2, Number.MAX_VALUE)]);
  assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.trade, null);
});

const NAME = 'PRIVATE-ACCOUNT-1234', NOW = Date.parse(SNAPSHOT);
function fixture() {
  let now = NOW;
  const raw = { positions: [], fills: [
    { account: NAME, fillId: 1, orderId: 10, symbol: 'MESZ6', action: 'Buy', quantity: 1, price: 7771.75, timestamp: '2026-10-21T14:44:22.006Z' },
    { account: NAME, fillId: 2, orderId: 11, symbol: 'MESZ6', action: 'Sell', quantity: 1, price: 7774.25, timestamp: '2026-10-21T14:47:52.351Z' },
  ] }, calls = [], announcements = [];
  const client = { toolCatalog: async () => ['my_portfolio', 'fill_history'].map(name => ({ name })), readAccountList: async () => [{ name: NAME }],
    callTool: async (name, args) => {
      calls.push({ name, args }); if (raw.error) throw new Error('NINJATRADER_TOOL_ERROR');
      return structuredClone(name === 'my_portfolio' ? { account: { name: NAME, currency: 'USD', netLiq: 3200, cashBalance: 3200, openPnL: 0 }, positions: raw.positions, workingOrders: [] } : { items: raw.fills });
    } };
  const monitor = new NinjaTraderMonitor({ client, environment: 'live', now: () => now, onFill: fill => announcements.push(fill) });
  return { raw, client, monitor, calls, announcements, now: () => now, advance: () => { now += 15000; } };
}
test('baseline computes the startup trade atomically without announcing old fills or adding reads', async () => {
  const f = fixture(); const state = await f.monitor.initialize();
  assert.equal(state.startupRoundTrips.length, 1); assert.equal(state.startupRoundTrips[0].trade.grossPointsPerContract, 2.5);
  assert.equal(state.startupRoundTrips[0].startDate, '2026-10-21'); assert.equal(state.startupRoundTrips[0].endDate, '2026-10-23');
  assert.equal(state.baselineFillCount, 2); assert.equal(state.executions.length, 0); assert.equal(f.announcements.length, 0);
  assert.deepEqual(f.calls.map(call => call.name), ['my_portfolio', 'fill_history']); assert.doesNotMatch(JSON.stringify(state), /PRIVATE-ACCOUNT/);
  const initial = structuredClone(state.startupRoundTrips);
  f.raw.fills.push({ ...f.raw.fills[0], fillId: 3, orderId: 12, timestamp: '2026-10-22T14:59:00Z' });
  f.raw.positions = [{ symbol: 'MESZ6', netPos: 1, netPrice: 7771.75 }]; f.advance(); await f.monitor.poll();
  assert.deepEqual(f.monitor.snapshot().startupRoundTrips, initial); assert.equal(f.announcements.length, 1);
});
test('failed baselines do not publish historical trades; failed polls preserve the successful summary', async () => {
  const f = fixture(); f.raw.error = true; await assert.rejects(f.monitor.initialize());
  assert.deepEqual(f.monitor.snapshot().startupRoundTrips, []); delete f.raw.error; await f.monitor.poll();
  const before = f.monitor.snapshot().startupRoundTrips; f.raw.error = true; await assert.rejects(f.monitor.poll());
  assert.deepEqual(f.monitor.snapshot().startupRoundTrips, before); assert.equal(f.monitor.snapshot().stale, true);
});
test('startup prints the historical trade once with dated Mountain times; subsequent polls keep action-only output', async () => {
  const f = fixture(), lines = [], controller = new AbortController(); let waits = 0;
  const state = await runNinjaTraderMonitor({ settings: { environment: 'live', pollMs: 15000, accountSelectors: [], timeZone: 'America/Denver' },
    client: f.client, signal: controller.signal, now: f.now, log: line => lines.push(line),
    createApi: () => ({ start: async () => 'http://127.0.0.1:8789', stop: async () => {} }), wait: async () => {
      waits++; f.advance(); if (waits === 3) controller.abort();
    } });
  const summaries = lines.filter(line => line.includes('ACCOUNT SUMMARY (STARTUP)')); assert.equal(summaries.length, 1);
  assert.match(summaries[0], /Last trade:\s+MESZ6 · LONG \(reconstructed\)/);
  assert.match(summaries[0], /Closed qty:\s+1 contract\(s\) · peak 1/);
  assert.match(summaries[0], /Entry avg:\s+7771\.75/); assert.match(summaries[0], /Exit avg:\s+7774\.25/);
  assert.match(summaries[0], /10\/21\/2026, 08:44:22\.006 MDT/); assert.match(summaries[0], /10\/21\/2026, 08:47:52\.351 MDT/);
  assert.match(summaries[0], /Gross move:\s+\+2\.5 points\/contract; before fees/);
  assert.doesNotMatch(lines.join('\n'), /\| BUY |\| SELL |NEW NINJATRADER EXECUTION|PRIVATE/);
  assert.equal(state.executionEnabled, false);
});
test('incomplete startup trade is explained and remains available as metadata through the read-only API', async t => {
  const f = fixture(); f.raw.fills.shift(); await f.monitor.initialize();
  const lines = [];
  await runNinjaTraderMonitor({ settings: { environment: 'live', pollMs: 15000, accountSelectors: [], once: true }, client: f.client, now: f.now, log: line => lines.push(line) });
  assert.match(lines.join('\n'), /Last trade:\s+Unavailable: incomplete entry history/);
  const api = createNinjaTraderMonitorApi({ monitor: f.monitor, port: 0 }); t.after(() => api.stop()); const url = await api.start();
  const response = await fetch(url + '/api/state'); const state = await response.json();
  assert.equal(response.status, 200); assert.equal(state.startupRoundTrips[0].status, 'UNAVAILABLE'); assert.equal(state.startupRoundTrips[0].trade, null);
  assert.equal(state.executionEnabled, false); assert.doesNotMatch(JSON.stringify(state), /PRIVATE-ACCOUNT/);
});
