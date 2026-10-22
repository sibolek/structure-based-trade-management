import test from 'node:test';
import assert from 'node:assert/strict';
import { createNinjaTraderActionLogger, formatNinjaTraderActionFill } from '../schwab-bridge/ninjatrader-action-log.mjs';
import { runNinjaTraderMonitor } from '../schwab-bridge/ninjatrader-monitor.mjs';

const TIME = '2026-10-21T14:44:22.006Z', ID = 'account-opaque';
const order = (extra = {}) => ({ environment: 'live', accountId: ID, accountDisplay: '••••1234', orderId: 42, symbol: 'MESZ6',
  action: 'Sell', quantity: 1, orderType: 'Stop', stopPrice: 7774.25, limitPrice: null, timeInForce: 'Day', status: 'Working', observedAt: TIME, ...extra });
const state = (extra = {}) => ({ environment: 'live', status: 'OBSERVING', stale: false, accounts: [{ accountId: ID, workingOrdersStatus: 'CURRENT' }],
  positions: [], executions: [], workingOrders: [], unconfirmedOrders: [], orderEvents: [], ...extra });
function fixture(initial = state()) {
  const lines = [], observe = createNinjaTraderActionLogger(line => lines.push(line)); observe(initial);
  return { lines, observe };
}
test('initial orders and history are baselined, and equity, marks, positions and timestamps stay silent', () => {
  const f = fixture(state({ workingOrders: [order()], orderEvents: [order({ orderId: 40, status: 'Cancelled' })] }));
  f.observe(state({ workingOrders: [order({ observedAt: '2026-10-21T14:45:00Z', status: 'PartFilled' })], orderEvents: [order({ orderId: 40, status: 'Cancelled' })],
    accounts: [{ accountId: ID, workingOrdersStatus: 'CURRENT', netLiquidation: 3000, openPnl: 20 }],
    positions: [{ accountId: ID, symbol: 'MESZ6', quantity: 1, currentPrice: 7775 }] }));
  f.observe(state({ workingOrders: [order()], orderEvents: [order({ orderId: 40, status: 'Cancelled' })] }));
  assert.deepEqual(f.lines, []);
});
test('stop appears once, actual terms change once, row reordering and status progression do not replay', () => {
  const f = fixture();
  f.observe(state({ workingOrders: [order({ status: 'PendingNew' }), order({ orderId: 43 })] }));
  f.observe(state({ workingOrders: [order({ orderId: 43 }), order()] }));
  f.observe(state({ workingOrders: [order({ stopPrice: 7774.5 }), order({ orderId: 43 })] }));
  f.observe(state({ workingOrders: [order({ orderId: 43 }), order({ stopPrice: 7774.5 })] }));
  assert.equal(f.lines.length, 3);
  assert.equal(f.lines.filter(line => line.includes('ORDER WORKING')).length, 2);
  assert.match(f.lines[2], /ORDER UPDATED.*stop 7774\.5.*order 42/);
  assert.ok(f.lines.every(line => !/[\r\n]/.test(line)));
});
test('type, side, quantity, limit and duration are meaningful changes', () => {
  const f = fixture(state({ workingOrders: [order()] })); let current = order();
  for (const extra of [{ quantity: 2 }, { action: 'Buy' }, { orderType: 'StopLimit', limitPrice: 7774 }, { limitPrice: 7773.75 }, { timeInForce: 'GTC' }]) {
    current = { ...current, ...extra }; f.observe(state({ workingOrders: [current] }));
  }
  assert.equal(f.lines.length, 5); assert.ok(f.lines.every(line => line.includes('ORDER UPDATED')));
  assert.match(f.lines.at(-1), /GTC/);
});
test('stop-market omits an irrelevant limit while stop-limit keeps missing limit explicit', () => {
  const f = fixture(); f.observe(state({ workingOrders: [order()] }));
  assert.doesNotMatch(f.lines[0], /limit|unavailable/i);
  f.observe(state({ workingOrders: [order({ orderType: 'StopLimit' })] }));
  assert.match(f.lines[1], /stop 7774\.25 · limit —/);
});
test('unconfirmed disappearance and stale polls cannot announce cancellation or replay the restored order', () => {
  const f = fixture(state({ workingOrders: [order()] }));
  const unavailable = state({ unconfirmedOrders: [order({ stale: true })] });
  f.observe(unavailable); f.observe(unavailable);
  f.observe(state({ status: 'DEGRADED', stale: true }));
  f.observe(state({ workingOrders: [order()] })); f.observe(state({ workingOrders: [order()] }));
  assert.equal(f.lines.length, 2); assert.match(f.lines[0], /COVERAGE UNCONFIRMED/); assert.match(f.lines[1], /COVERAGE RECOVERED/);
  assert.doesNotMatch(f.lines.join('\n'), /ORDER CANCELLED|ORDER WORKING|ORDER UPDATED/);
});
test('confirmed cancellation prints once while flat and distinct cancellations are retained', () => {
  const f = fixture(state({ workingOrders: [order(), order({ orderId: 43 })] }));
  const events = [order({ status: 'Cancelled', positionQuantity: 0, orderDetailsSource: 'LAST_OBSERVED_WORKING_ORDER' }), order({ orderId: 43, status: 'Cancelled' })];
  f.observe(state({ orderEvents: events }));
  f.observe(state({ orderEvents: events.slice().reverse().map(event => ({ ...event, observedAt: '2026-10-21T14:50:00Z' })) }));
  assert.equal(f.lines.length, 2); assert.ok(f.lines.every(line => line.includes('ORDER CANCELLED')));
  assert.match(f.lines.find(line => line.includes('order 42')), /last working terms/);
  assert.doesNotMatch(f.lines.join('\n'), /POSITION FLAT|ACCOUNT SNAPSHOT/);
});
test('push Filled confirmation waits silently for the fill callback and never generates a duplicate filled line', () => {
  const f = fixture(state({ workingOrders: [order()] })), event = order({ status: 'Filled', positionQuantity: 0 });
  f.observe(state({ orderEvents: [event] })); assert.deepEqual(f.lines, []);
  f.observe.fill(order({ fillId: 99, price: 7774.25, executionTime: TIME }));
  f.observe(state({ orderEvents: [event] })); f.observe(state({ orderEvents: [event] }));
  assert.equal(f.lines.length, 1); assert.match(f.lines[0], /SELL 1 MESZ6 @ 7774\.25.*fill 99/);
});
test('partial fills each print; a working row seen with a fill does not add an order announcement', () => {
  const f = fixture();
  f.observe.fill(order({ fillId: 90, price: 7774.25, executionTime: TIME }));
  f.observe(state({ workingOrders: [order({ quantity: 2, status: 'PartFilled' })] }));
  f.observe.fill(order({ fillId: 91, price: 7774.5, executionTime: TIME }));
  f.observe(state({ orderEvents: [order({ status: 'Filled' })] }));
  assert.equal(f.lines.length, 2); assert.ok(f.lines.every(line => line.includes('| SELL 1 MESZ6 @')));
});
test('order identities include account and environment, and terminal history eviction adds no removal line', () => {
  const first = order({ status: 'Rejected' }), second = order({ accountId: 'other', accountDisplay: '••••9876', status: 'Expired' });
  const f = fixture(); f.observe(state({ orderEvents: [first, second] })); f.observe(state());
  f.observe(state({ workingOrders: [order({ environment: 'demo' }), order({ accountId: 'other' })] }));
  assert.equal(f.lines.length, 4); assert.match(f.lines.join('\n'), /ORDER REJECTED/); assert.match(f.lines.join('\n'), /ORDER EXPIRED/);
});
test('formatting keeps a single physical line, source precision and configured timezone', () => {
  const fill = order({ action: 'Buy\n\u001b[31m', fillId: 5, price: 7771.125, executionTime: TIME });
  const line = formatNinjaTraderActionFill(fill, 'UTC');
  assert.match(line, /14:44:22\.006 UTC/); assert.match(line, /7771\.125/); assert.doesNotMatch(line, /[\r\n\u001b]/);
  const detected = formatNinjaTraderActionFill({ ...fill, executionTime: null, detectedAt: TIME });
  assert.match(detected, /08:44:22\.006 MDT.*\(detected\)/);
});

function runnerFixture() {
  let now = Date.parse('2026-10-21T14:40:00Z');
  const name = 'PRIVATE-ACCOUNT-1234', raw = { orders: [], positions: [], fills: [], history: [] }, calls = [];
  const fill = (fillId, extra = {}) => ({ account: name, fillId, orderId: 10, symbol: 'MESZ6', action: 'Buy', quantity: 1, price: 7771.75, timestamp: new Date(now).toISOString(), ...extra });
  const client = { toolCatalog: async () => ['my_portfolio', 'fill_history', 'order_history'].map(name => ({ name })),
    readAccountList: async () => [{ name }], callTool: async tool => {
      calls.push(tool);
      if (tool === 'my_portfolio') return structuredClone({ account: { name, currency: 'USD', netLiq: 3174.79, openPnL: 12.5 }, positions: raw.positions, workingOrders: raw.orders });
      return { items: structuredClone(tool === 'fill_history' ? raw.fills : raw.history) };
    } };
  return { raw, client, fill, calls, now: () => now, advance: () => { now += 15000; } };
}
const settings = { environment: 'live', pollMs: 15000, accountSelectors: [], timeZone: 'America/Denver' };
const createApi = () => ({ start: async () => 'http://127.0.0.1:8789', stop: async () => {} });
test('runner lifecycle emits exactly BUY, working stop and SELL, preserving API observations', async () => {
  const f = runnerFixture(), lines = [], controller = new AbortController(); let iteration = 0;
  const result = await runNinjaTraderMonitor({ settings, client: f.client, signal: controller.signal, now: f.now, createApi, log: line => lines.push(line), wait: async () => {
    iteration++; f.advance();
    if (iteration === 1) { f.raw.fills.push(f.fill(1)); f.raw.positions = [{ symbol: 'MESZ6', netPos: 1, netPrice: 7771.75, currentPrice: 7772 }]; }
    if (iteration === 2) f.raw.orders = [{ id: 42, symbol: 'MESZ6', action: 'Sell', orderType: 'Stop', quantity: 1, ordStatus: 'Working', stopPrice: 7774.25 }];
    if (iteration === 3) f.raw.positions[0].currentPrice = 7774;
    if (iteration === 4) { f.raw.fills.push(f.fill(2, { orderId: 42, action: 'Sell', price: 7774.25 })); f.raw.orders = []; f.raw.positions = [];
      f.raw.history = [{ account: 'PRIVATE-ACCOUNT-1234', orderId: 42, symbol: 'MESZ6', action: 'Sell', quantity: 1, filledQty: 1, ordStatus: 'Filled' }]; }
    if (iteration === 6) controller.abort();
  } });
  const actions = lines.filter(line => /\| (BUY|SELL|ORDER) /.test(line));
  assert.equal(actions.length, 3, lines.join('\n')); assert.match(actions[0], /BUY 1 MESZ6 @ 7771\.75/);
  assert.match(actions[1], /ORDER WORKING.*stop 7774\.25/); assert.match(actions[2], /SELL 1 MESZ6 @ 7774\.25/);
  assert.doesNotMatch(lines.join('\n'), /ACCOUNT SNAPSHOT|POSITION FLAT|ORDER FILLED|PRIVATE/);
  assert.equal(lines.filter(line => line.includes('NINJATRADER ACCOUNT SUMMARY (STARTUP)')).length, 1);
  assert.ok(lines.filter(line => !line.includes('NINJATRADER ACCOUNT SUMMARY (STARTUP)')).every(line => !/[\r\n]/.test(line)));
  assert.equal(result.executions.length, 2); assert.equal(result.orderEvents[0].status, 'Filled'); assert.equal(result.positions.length, 0);
  assert.equal(result.accounts[0].openPnl, 12.5); assert.equal(result.executionEnabled, false);
});
test('runner prints every fill in a batch larger than the API history and does not replay any on the next poll', async () => {
  const f = runnerFixture(), lines = [], controller = new AbortController(); let iteration = 0;
  const result = await runNinjaTraderMonitor({ settings, client: f.client, signal: controller.signal, now: f.now, createApi, log: line => lines.push(line), wait: async () => {
    iteration++; f.advance();
    if (iteration === 1) f.raw.fills = Array.from({ length: 125 }, (_, index) => f.fill(index + 1));
    if (iteration === 3) controller.abort();
  } });
  const fills = lines.filter(line => line.includes('| fill ')); assert.equal(fills.length, 125);
  assert.equal(new Set(fills.map(line => line.split('| fill ')[1])).size, 125);
  assert.equal(result.executions.length, 100); assert.equal(result.executionEnabled, false);
});
