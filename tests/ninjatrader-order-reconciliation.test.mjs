import test from 'node:test';
import assert from 'node:assert/strict';
import { logSnapshot, createMonitorChangeLogger } from '../schwab-bridge/ninjatrader-monitor.mjs';
const identity = { accountId: 'synthetic-account', accountDisplay: '••••1234' };
const observedAt = '2026-10-20T12:45:00Z';
function snapshot() { return { environment: 'live', status: 'OBSERVING', stale: false,
  accounts: [{ ...identity, currency: 'USD', netLiquidation: 10000, openPnl: 0, workingOrdersStatus: 'CURRENT' }], positions: [], orderEvents: [],
  workingOrders: [{ ...identity, orderId: 42, symbol: 'MESZ6', action: 'Buy', orderType: 'Stop', quantity: 1, stopPrice: 7742.25,
    limitPrice: null, status: 'Working', timeInForce: 'Day', observedAt, stale: false }] }; }
function render(state) { const messages = []; logSnapshot(state, row => messages.push(row)); return messages.join('\n'); }
test('last-known order snapshot is explicitly unconfirmed rather than still presented as working', () => {
  const state = snapshot(); state.workingOrders[0].stale = true; state.accounts[0].workingOrdersStatus = 'UNAVAILABLE';
  const text = render(state);
  assert.match(text, /NINJATRADER ORDER — STATUS UNCONFIRMED/);
  assert.match(text, /Order status:\s+Unconfirmed/); assert.match(text, /Last status:\s+Working/);
  assert.match(text, /Last observed:\s+06:45:00\.000 MDT/);
  assert.doesNotMatch(text, /NINJATRADER WORKING ORDER/); assert.match(text, /current; orders unconfirmed/);
});
test('confirmed cancellation replaces the working-order block and includes independently observed flat state', () => {
  const state = snapshot(), messages = [], logChanges = createMonitorChangeLogger(row => messages.push(row));
  logChanges(state); messages.length = 0; state.workingOrders = [];
  state.orderEvents = [{ ...identity, orderId: 42, symbol: 'MESZ6', status: 'Cancelled', positionQuantity: 0, observedAt }];
  logChanges(state);
  assert.match(messages.join('\n'), /NINJATRADER ORDER CANCELLED/);
  assert.match(messages.join('\n'), /Order status:\s+Cancelled/); assert.match(messages.join('\n'), /Position:\s+FLAT/);
  assert.doesNotMatch(messages.join('\n'), /NO LONGER REPORTED|STATUS UNCONFIRMED/);
  messages.length = 0; logChanges(structuredClone(state)); assert.deepEqual(messages, []);
});
test('cancellation never implies flat when broker positions remain open', () => {
  const state = snapshot(); state.workingOrders = [];
  state.orderEvents = [{ ...identity, orderId: 42, symbol: 'MESZ6', status: 'Cancelled', positionQuantity: -1, observedAt }];
  const text = render(state); assert.match(text, /Position:\s+SHORT 1/); assert.doesNotMatch(text, /Position:\s+FLAT/);
});
test('pending cancellation is not presented as confirmed cancellation', () => {
  const state = snapshot(); state.workingOrders[0].status = 'PendingCancel';
  const text = render(state); assert.match(text, /Order status:\s+PendingCancel/); assert.doesNotMatch(text, /ORDER CANCELLED/);
});

import { NinjaTraderMonitor, normalizeMonitorTerminalOrders } from '../schwab-bridge/ninjatrader-monitor-state.mjs';
const NAME = 'SYNTHETIC-1234', START = Date.parse(observedAt);
function lifecycleFixture({ historyAvailable = true } = {}) {
  let clock = START;
  const working = { id: 42, symbol: 'MESZ6', action: 'Buy', orderType: 'Stop', quantity: 1, stopPrice: 7742.25, ordStatus: 'Working', timeInForce: 'Day' };
  const raw = { portfolio: { account: { name: NAME, currency: 'USD', netLiq: 10000 }, positions: [], workingOrders: [working] }, orders: [],
    history: { items: [{ account: NAME, orderId: 42, symbol: 'MESZ6', action: 'Buy', quantity: 1, filledQty: 0, ordStatus: 'Canceled', timestamp: observedAt }] }, fills: { items: [] } };
  const calls = [], fills = [];
  const client = { toolCatalog: async () => ['my_portfolio', 'fill_history', ...(historyAvailable ? ['order_history'] : [])].map(name => ({ name })),
    readAccountList: async () => [{ name: NAME, active: true }], readOrderList: async () => structuredClone(raw.orders),
    callTool: async (name, args) => { calls.push({ name, args }); if (name === 'fill_history' && raw.fillError) throw new Error(raw.fillError); return structuredClone(name === 'my_portfolio' ? raw.portfolio : name === 'order_history' ? raw.history : raw.fills); } };
  const monitor = new NinjaTraderMonitor({ client, environment: 'live', now: () => clock, onFill: fill => fills.push(fill) });
  return { monitor, raw, calls, fills, advance: (ms = 15001) => { clock += ms; } };
}
test('real schema: omitted empty orders reconcile Canceled and independently confirmed flat without creating a fill', async () => {
  const f = lifecycleFixture(); await f.monitor.initialize(); assert.equal(f.calls.filter(row => row.name === 'order_history').length, 0);
  f.advance(); delete f.raw.portfolio.workingOrders; await f.monitor.poll();
  const state = f.monitor.snapshot(); assert.deepEqual(state.workingOrders, []); assert.deepEqual(state.unconfirmedOrders, []);
  assert.equal(state.accounts[0].workingOrdersStatus, 'CURRENT'); assert.equal(state.orderEvents[0].status, 'Cancelled');
  assert.equal(state.orderEvents[0].brokerStatus, 'Canceled'); assert.equal(state.orderEvents[0].positionQuantity, 0);
  assert.equal(state.positions.length, 0); assert.equal(f.fills.length, 0); assert.equal(state.executions.length, 0);
  f.advance(); await f.monitor.poll(); assert.equal(f.monitor.snapshot().orderEvents.length, 1);
  assert.equal(f.calls.filter(row => row.name === 'order_history').length, 1);
  assert.match(render(state), /ORDER CANCELLED/); assert.match(render(state), /Position:\s+FLAT/);
});
test('a cancellation with a broker-confirmed remaining position does not flatten it', async () => {
  const f = lifecycleFixture(); await f.monitor.initialize(); f.advance(); f.raw.portfolio.workingOrders = [];
  f.raw.portfolio.positions = [{ symbol: 'MESZ6', netPos: -1, netPrice: 7745 }];
  await f.monitor.poll(); const state = f.monitor.snapshot();
  assert.equal(state.positions[0].quantity, -1); assert.equal(state.orderEvents[0].positionQuantity, -1);
  assert.match(render(state), /Position:\s+SHORT 1/); assert.doesNotMatch(render(state), /Position:\s+FLAT/);
});
test('pending cancellation remains unconfirmed, retries at most every 15 seconds, then reports a terminal record once', async () => {
  const f = lifecycleFixture(); await f.monitor.initialize(); f.advance(); f.raw.portfolio.workingOrders = [];
  f.raw.history.items[0].ordStatus = 'PendingCancel'; await f.monitor.poll();
  assert.equal(f.monitor.snapshot().orderEvents.length, 0); assert.equal(f.monitor.snapshot().unconfirmedOrders.length, 1);
  const loggerMessages = [], changes = createMonitorChangeLogger(row => loggerMessages.push(row)); changes(f.monitor.snapshot()); loggerMessages.length = 0;
  f.raw.history.items[0].ordStatus = 'Canceled'; await f.monitor.poll();
  assert.equal(f.calls.filter(row => row.name === 'order_history').length, 1); changes(f.monitor.snapshot()); assert.deepEqual(loggerMessages, []);
  f.advance(); await f.monitor.poll(); changes(f.monitor.snapshot());
  assert.equal(f.calls.filter(row => row.name === 'order_history').length, 2);
  assert.equal(f.monitor.snapshot().orderEvents.length, 1); assert.equal(f.monitor.snapshot().unconfirmedOrders.length, 0);
  assert.match(loggerMessages.join('\n'), /ORDER CANCELLED/); assert.doesNotMatch(loggerMessages.join('\n'), /NO LONGER REPORTED/);
});
test('missing order history rows or unavailable tool never prove a cancellation', async () => {
  for (const historyAvailable of [true, false]) {
    const f = lifecycleFixture({ historyAvailable }); await f.monitor.initialize(); f.advance(); f.raw.portfolio.workingOrders = []; f.raw.history.items = [];
    await f.monitor.poll(); const state = f.monitor.snapshot();
    assert.equal(state.orderEvents.length, 0); assert.equal(state.workingOrders.length, 0); assert.equal(state.unconfirmedOrders.length, 1);
    assert.match(render(state), /STATUS UNCONFIRMED/); assert.doesNotMatch(render(state), /ORDER CANCELLED/);
  }
});
test('ambiguous Completed is reported as Completed rather than inferred cancellation or fill', async () => {
  const f = lifecycleFixture(); await f.monitor.initialize(); f.advance(); f.raw.portfolio.workingOrders = []; f.raw.history.items[0].ordStatus = 'Completed';
  await f.monitor.poll(); assert.equal(f.monitor.snapshot().orderEvents[0].status, 'Completed');
  assert.doesNotMatch(render(f.monitor.snapshot()), /ORDER CANCELLED/); assert.equal(f.monitor.snapshot().executions.length, 0);
});
test('history identity conflicts and malformed payloads fail without partially publishing cancellation or new fills', async () => {
  for (const patch of [{ account: 'OTHER' }, { symbol: 'OTHER' }, { action: 'Sell' }, { quantity: 0 }, { filledQty: 2 }, { timestamp: 'not-time' }]) {
    const f = lifecycleFixture(); await f.monitor.initialize(); const before = f.monitor.snapshot().lastSuccessfulAt;
    f.advance(); f.raw.portfolio.workingOrders = []; Object.assign(f.raw.history.items[0], patch);
    await assert.rejects(f.monitor.poll(), /ORDER_IDENTITY_MISMATCH|ORDER_HISTORY_UNVERIFIED|TIMESTAMP_INVALID/);
    assert.equal(f.monitor.snapshot().lastSuccessfulAt, before); assert.equal(f.monitor.snapshot().orderEvents.length, 0);
    assert.equal(f.monitor.snapshot().stale, true);
  }
});
test('structured status is required; free text and duplicate/saturated records cannot confirm cancellation', () => {
  const account = { name: NAME }, tracked = [{ orderId: 42, symbol: 'MESZ6', action: 'Buy' }];
  const row = { account: NAME, orderId: 42, symbol: 'MESZ6', action: 'Buy', quantity: 1, filledQty: 0, ordStatus: 'PendingCancel', text: 'Canceled by user' };
  assert.deepEqual(normalizeMonitorTerminalOrders({ items: [row] }, account, 'live', tracked), []);
  assert.deepEqual(normalizeMonitorTerminalOrders({ items: [{ ...row, ordStatus: 'constructor' }] }, account, 'live', tracked), []);
  assert.throws(() => normalizeMonitorTerminalOrders({ items: [row, row] }, account, 'live', tracked), /IDENTITY_MISMATCH/);
  assert.throws(() => normalizeMonitorTerminalOrders({ items: Array(5000).fill(row) }, account, 'live', tracked), /HISTORY_UNVERIFIED/);
});

test('a later failed fill read cannot publish or lose a cancellation from a partial cycle', async () => {
  const f = lifecycleFixture(); await f.monitor.initialize(); const before = f.monitor.snapshot().lastSuccessfulAt;
  f.advance(); f.raw.portfolio.workingOrders = []; f.raw.fillError = 'NINJATRADER_TOOL_REQUEST_FAILED';
  await assert.rejects(f.monitor.poll(), /TOOL_REQUEST_FAILED/);
  assert.equal(f.monitor.snapshot().lastSuccessfulAt, before); assert.equal(f.monitor.snapshot().orderEvents.length, 0);
  assert.equal(f.monitor.snapshot().workingOrders.length, 1);
  delete f.raw.fillError; await f.monitor.poll();
  assert.equal(f.monitor.snapshot().orderEvents.length, 0); assert.equal(f.monitor.snapshot().unconfirmedOrders.length, 1);
  f.advance(); await f.monitor.poll();
  assert.equal(f.monitor.snapshot().orderEvents.length, 1); assert.equal(f.monitor.snapshot().unconfirmedOrders.length, 0);
  f.advance(); await f.monitor.poll(); assert.equal(f.monitor.snapshot().orderEvents.length, 1);
});
test('a nonempty unbound resource cannot prove zero working orders, even after this order is confirmed canceled', async () => {
  const f = lifecycleFixture(); await f.monitor.initialize(); f.advance(); delete f.raw.portfolio.workingOrders;
  f.raw.orders = [{ id: 99, accountId: 123 }]; await f.monitor.poll(); const state = f.monitor.snapshot();
  assert.equal(state.orderEvents[0].status, 'Cancelled'); assert.equal(state.accounts[0].workingOrdersStatus, 'UNAVAILABLE');
  assert.match(render(state), /Working orders:\s+unavailable/);
});

test('closing fill stays distinct from canceled stop and limit orders, retaining their observed bracket context', async () => {
  const f = lifecycleFixture();
  f.raw.portfolio.positions = [{ symbol: 'MESZ6', netPos: 1, netPrice: 7745 }];
  f.raw.portfolio.workingOrders = [
    { id: 42, symbol: 'MESZ6', action: 'Sell', orderType: 'Stop', quantity: 1, stopPrice: 7740, ordStatus: 'Working', timeInForce: 'Day', bracket: { parentId: 10, ocoId: 43 } },
    { id: 43, symbol: 'MESZ6', action: 'Sell', orderType: 'Limit', quantity: 1, price: 7750, ordStatus: 'Working', timeInForce: 'Day', bracket: { parentId: 10, ocoId: 42 } },
  ];
  await f.monitor.initialize(); const messages = [], changes = createMonitorChangeLogger(row => messages.push(row)); changes(f.monitor.snapshot()); messages.length = 0;
  f.advance(); f.raw.portfolio.positions = []; f.raw.portfolio.workingOrders = [];
  f.raw.history.items = [42, 43, 44].map(orderId => ({ account: NAME, orderId, symbol: 'MESZ6', action: 'Sell', quantity: 1, filledQty: orderId === 44 ? 1 : 0, ordStatus: orderId === 44 ? 'Filled' : 'Canceled' }));
  f.raw.fills.items = [{ account: NAME, orderId: 44, fillId: 50, symbol: 'MESZ6', action: 'Sell', quantity: 1, price: 7745, timestamp: observedAt }];
  await f.monitor.poll(); const state = f.monitor.snapshot(); changes(state);
  const stop = state.orderEvents.find(event => event.orderId === 42), limit = state.orderEvents.find(event => event.orderId === 43);
  assert.equal(stop.orderType, 'Stop'); assert.equal(stop.stopPrice, 7740); assert.equal(stop.parentOrderId, 10); assert.equal(stop.ocoOrderId, 43);
  assert.equal(limit.orderType, 'Limit'); assert.equal(limit.limitPrice, 7750); assert.equal(limit.parentOrderId, 10);
  assert.equal(f.fills.length, 1); assert.equal(f.fills[0].orderId, 44); assert.equal(state.orderEvents.length, 2); assert.ok(!state.orderEvents.some(event => event.orderId === 44));
  const text = messages.join('\n'); assert.match(text, /Order type:\s+Stop/); assert.match(text, /Order type:\s+Limit/); assert.match(text, /NINJATRADER POSITION FLAT/);
  assert.doesNotMatch(text, /POSITION NO LONGER REPORTED|automatically|user canceled/i);
  messages.length = 0; f.advance(); await f.monitor.poll(); changes(f.monitor.snapshot()); assert.deepEqual(messages, []);
});
test('position removal becomes FLAT only for a current broker snapshot of the same accessible account', () => {
  for (const verified of [true, false]) {
    const state = snapshot(), messages = [], changes = createMonitorChangeLogger(row => messages.push(row));
    state.positions = [{ ...identity, symbol: 'MESZ6', side: 'LONG', quantity: 1 }]; changes(state); messages.length = 0;
    state.positions = []; if (!verified) state.accounts = [];
    changes(state); const text = messages.join('\n');
    if (verified) { assert.match(text, /NINJATRADER POSITION FLAT/); assert.match(text, /Confirmation:\s+Broker position snapshot/); }
    else { assert.match(text, /POSITION NO LONGER REPORTED/); assert.doesNotMatch(text, /POSITION FLAT/); }
  }
});
test('a filled observed closing order is reported FILLED even when history includes unrelated cancellations', async () => {
  const f = lifecycleFixture(); f.raw.portfolio.positions = [{ symbol: 'MESZ6', netPos: 1, netPrice: 7745 }];
  f.raw.portfolio.workingOrders = [{ id: 44, symbol: 'MESZ6', action: 'Sell', quantity: 1, orderType: 'Market', ordStatus: 'PendingNew' }];
  await f.monitor.initialize(); f.advance(); f.raw.portfolio.positions = []; f.raw.portfolio.workingOrders = [];
  f.raw.history.items = [42, 43, 44].map(orderId => ({ account: NAME, orderId, symbol: 'MESZ6', action: 'Sell', quantity: 1, filledQty: orderId === 44 ? 1 : 0, ordStatus: orderId === 44 ? 'Filled' : 'Canceled' }));
  f.raw.fills.items = [{ account: NAME, orderId: 44, fillId: 50, symbol: 'MESZ6', action: 'Sell', quantity: 1, price: 7745, timestamp: observedAt }];
  await f.monitor.poll(); const state = f.monitor.snapshot();
  assert.equal(state.orderEvents.length, 1); assert.equal(state.orderEvents[0].orderId, 44); assert.equal(state.orderEvents[0].status, 'Filled'); assert.equal(state.orderEvents[0].filledQuantity, 1);
  assert.match(render(state), /NINJATRADER ORDER FILLED/); assert.doesNotMatch(render(state), /ORDER CANCELLED/);
});
test('stale position removals cannot be labeled flat even if the account remains present', () => {
  const state = snapshot(), messages = [], changes = createMonitorChangeLogger(row => messages.push(row));
  state.positions = [{ ...identity, symbol: 'MESZ6', side: 'LONG', quantity: 1 }]; changes(state); messages.length = 0;
  state.positions = []; state.stale = true; state.status = 'DEGRADED'; changes(state);
  assert.match(messages.join('\n'), /POSITION NO LONGER REPORTED/); assert.doesNotMatch(messages.join('\n'), /POSITION FLAT/);
});
