import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { NinjaTraderMonitor, normalizeMonitorAccountList, normalizeMonitorPortfolio, normalizeMonitorFills, normalizeMonitorWorkingOrders } from '../schwab-bridge/ninjatrader-monitor-state.mjs';
import { createNinjaTraderMonitorApi } from '../schwab-bridge/ninjatrader-monitor-api.mjs';
import { NinjaTraderMonitorProvider } from '../schwab-bridge/ninjatrader-monitor-provider.mjs';
import { createConfiguredMarketDataProviders } from '../schwab-bridge/market-data-provider-factory.mjs';
import { monitorConfig, runNinjaTraderMonitor, logSnapshot, createMonitorChangeLogger, formatNinjaTraderFill, monitorFailureHint } from '../schwab-bridge/ninjatrader-monitor.mjs';
import { config } from './fixtures/ninjatrader/config.mjs';

const START = Date.parse('2026-10-19T22:00:00Z'), NAME = 'PRIVATE-ACCOUNT-123456';
function fill(fillId = 1, extra = {}) { return { account: NAME, fillId, orderId: 10, symbol: 'MESZ6', action: 'Buy', quantity: 1, price: 6000,
  timestamp: new Date(START - 60000).toISOString(), commission: 0.5, ...extra }; }
function fixture() {
  let clock = START;
  const raw = { accounts: [{ name: NAME, active: true }], portfolio: { account: { name: NAME, currency: 'USD', netLiq: 10000, cashBalance: 10000, openPnL: 0 }, positions: [], workingOrders: [] }, fills: { items: [fill()] } };
  const calls = [], notifications = [];
  const client = { toolCatalog: async () => [{ name: 'my_portfolio' }, { name: 'fill_history' }], readAccountList: async () => structuredClone(raw.accounts),
    callTool: async (name, args) => { calls.push({ name, args }); if (raw.error) throw new Error(raw.error); return structuredClone(name === 'my_portfolio' ? raw.portfolio : raw.fills); } };
  const monitor = new NinjaTraderMonitor({ client, environment: 'live', now: () => clock, onFill: row => notifications.push(row) });
  return { monitor, client, raw, calls, notifications, advance: (ms = 5000) => { clock += ms; } };
}
test('bootstrap suppresses prior fills, masks account names, and publishes no trading/coverage authority', async () => {
  const { monitor, calls, notifications } = fixture(); const state = await monitor.initialize();
  assert.equal(state.status, 'OBSERVING'); assert.equal(state.baselineFillCount, 1); assert.equal(state.executions.length, 0);
  assert.equal(state.readOnly, true); assert.equal(state.executionEnabled, false); assert.equal(state.executionOwnershipVerified, false);
  assert.equal(state.continuousFillCoverageVerified, false); assert.equal(state.source, 'NINJATRADER');
  assert.equal(state.accounts[0].accountDisplay, '••••3456'); assert.ok(!JSON.stringify(state).includes(NAME)); assert.equal(notifications.length, 0);
  assert.deepEqual(calls.map(row => row.name), ['my_portfolio', 'fill_history']);
  assert.ok(calls[0].args.fields.includes('positions[]')); assert.ok(calls[0].args.fields.includes('workingOrders[]')); assert.equal(calls[1].args.format, 'objects');
  assert.equal(calls[1].args.startDate, '2026-10-18'); assert.equal(calls[1].args.endDate, '2026-10-20');
});
test('new fills are reported once; broker snapshots, not replayed fills, determine positions', async () => {
  const f = fixture(); await f.monitor.initialize(); f.advance();
  f.raw.fills.items.push(fill(2, { action: 'Sell', timestamp: new Date(START).toISOString() }));
  f.raw.portfolio.positions = [{ symbol: 'MESZ6', netPos: -1, netPrice: 6000, currentPrice: 6001, openPnL: -5, dataFeedMode: 'Delayed' }];
  await f.monitor.poll(); await f.monitor.poll();
  const state = f.monitor.snapshot(); assert.equal(f.notifications.length, 1); assert.equal(state.executions[0].fillId, 2);
  assert.equal(state.positions[0].quantity, -1); assert.equal(state.positions[0].side, 'SHORT'); assert.equal(state.positions[0].realtime, false);
  f.raw.portfolio.positions = []; await f.monitor.poll(); assert.equal(f.monitor.snapshot().positions.length, 0);
});
test('failed cycles retain previous observations as stale and do not advance deduplication', async () => {
  const f = fixture(); await f.monitor.initialize(); const before = f.monitor.snapshot().lastSuccessfulAt;
  f.advance(); f.raw.error = 'PRIVATE_VENDOR_ERROR_WITH_ACCOUNT';
  await assert.rejects(f.monitor.poll()); assert.equal(f.monitor.snapshot().status, 'DEGRADED'); assert.equal(f.monitor.snapshot().stale, true);
  assert.equal(f.monitor.snapshot().lastSuccessfulAt, before); assert.equal(f.monitor.snapshot().lastError, 'NINJATRADER_MONITOR_READ_FAILED');
  delete f.raw.error; f.raw.fills.items.push(fill(2)); await f.monitor.poll(); assert.equal(f.notifications.length, 1); assert.equal(f.monitor.snapshot().stale, false);
  f.advance(16000); assert.equal(f.monitor.snapshot().stale, true);
});
test('a corrected fill id fails closed rather than silently replaying a different execution', async () => {
  const f = fixture(); await f.monitor.initialize(); f.raw.fills.items[0].price = 6001;
  await assert.rejects(f.monitor.poll(), /CORRECTION_REQUIRES_REBASELINE/); assert.equal(f.notifications.length, 0);
});
test('a commission update does not create a new fill or fault its execution identity', async () => {
  const f = fixture(); await f.monitor.initialize(); f.raw.fills.items[0].commission = 1.25;
  await f.monitor.poll(); assert.equal(f.monitor.snapshot().status, 'OBSERVING'); assert.equal(f.notifications.length, 0);
});
test('missing portfolio arrays, wrong accounts, malformed fills and large histories are refused', () => {
  const account = { name: NAME }, time = new Date(START).toISOString();
  assert.throws(() => normalizeMonitorPortfolio({ account: { name: NAME } }, account, 'live', time), /SCHEMA_MISMATCH/);
  assert.throws(() => normalizeMonitorPortfolio({ account: { name: 'OTHER' }, positions: [] }, account, 'live', time), /SCHEMA_MISMATCH/);
  for (const update of [{ account: 'OTHER' }, { timestamp: undefined }, { timestamp: '2026-10-19T15:00:00' }, { quantity: -1 }, { action: 'BUY' }])
    assert.throws(() => normalizeMonitorFills({ items: [fill(1, update)] }, account, 'live'), /NINJATRADER_/);
  assert.throws(() => normalizeMonitorFills({ items: [fill(), fill()] }, account, 'live'), /FILL_INVALID/);
  assert.throws(() => normalizeMonitorFills({ items: Array(5000).fill(fill()) }, account, 'live'), /FILL_HISTORY_UNVERIFIED/);
});
test('permission and account-selection failures are explicit; missing accounts never imply flat', async () => {
  const f = fixture(); f.client.toolCatalog = async () => [{ name: 'market_snapshot' }];
  await assert.rejects(f.monitor.initialize(), /READ_PERMISSIONS_REQUIRED/);
  assert.throws(() => normalizeMonitorAccountList({}, 'live'), /SCHEMA_MISMATCH/);
  assert.throws(() => normalizeMonitorAccountList([{ name: NAME }, { name: NAME }], 'live'), /SCHEMA_MISMATCH/);
  const g = fixture(); g.raw.accounts = []; await assert.rejects(g.monitor.initialize(), /SELECT_ONE_TO_TEN/);
  const h = fixture(); const selected = new NinjaTraderMonitor({ client: h.client, environment: 'live', accountSelectors: ['UNKNOWN'] });
  await assert.rejects(selected.initialize(), /ACCOUNT_SELECTION_INVALID/);
  const live = normalizeMonitorAccountList([{ name: NAME }], 'live')[0], demo = normalizeMonitorAccountList([{ name: NAME }], 'demo')[0];
  assert.notEqual(live.accountId, demo.accountId);
});
test('omitted portfolio positions require an independent successful empty positions resource', async () => {
  const f = fixture(); delete f.raw.portfolio.positions;
  await assert.rejects(f.monitor.initialize(), /POSITION_SNAPSHOT_INCOMPLETE/);
  const g = fixture(); delete g.raw.portfolio.positions;
  g.client.readPositionList = async () => [];
  const state = await g.monitor.initialize(); assert.deepEqual(state.positions, []); assert.equal(state.status, 'OBSERVING');
  const h = fixture(); delete h.raw.portfolio.positions;
  h.client.readPositionList = async () => [{ account: NAME, symbol: 'MESZ6' }];
  await assert.rejects(h.monitor.initialize(), /POSITION_SNAPSHOT_INCOMPLETE/);
});
test('late failure on a second account publishes neither a partial snapshot nor partially seen fills', async () => {
  const f = fixture(); const second = 'PRIVATE-SECOND-7890';
  f.raw.accounts.push({ name: second }); let broken = true;
  f.client.callTool = async (name, args) => {
    if (args.account === second && broken) throw new Error('NINJATRADER_TOOL_ERROR');
    if (name === 'my_portfolio') return { account: { name: args.account, currency: 'USD' }, positions: [] };
    return { items: [fill(args.account === NAME ? 1 : 2, { account: args.account })] };
  };
  await assert.rejects(f.monitor.initialize()); assert.equal(f.monitor.snapshot().accounts.length, 0);
  assert.equal(f.monitor.snapshot().baselineCompletedAt, null); broken = false;
  await f.monitor.poll(); assert.equal(f.monitor.snapshot().baselineFillCount, 2); assert.equal(f.notifications.length, 0);
});
test('concurrent polls are rejected instead of overlapping or double-reporting fills', async () => {
  const f = fixture(); await f.monitor.initialize();
  const original = f.client.callTool; let release;
  f.client.callTool = async (...args) => { await new Promise(resolve => { release = resolve; }); f.client.callTool = original; return original(...args); };
  const running = f.monitor.poll(); await Promise.resolve();
  await assert.rejects(f.monitor.poll(), /POLL_IN_PROGRESS/); release(); await running;
});
test('monitor config validates intervals, timezone, environment and command flags; once mode does not start an API', async () => {
  for (const env of [{ EXECUTIONOS_NINJATRADER_POLL_MS: '1' }, { EXECUTIONOS_NINJATRADER_MONITOR_PORT: '8789.5' }, { EXECUTIONOS_NINJATRADER_TIME_ZONE: 'Invalid' }])
    assert.throws(() => monitorConfig(env, []), /NINJATRADER_/);
  assert.throws(() => monitorConfig({}, ['--write']), /ARGUMENT_INVALID/);
  const f = fixture(), messages = [];
  const settings = { environment: 'live', pollMs: 5000, accountSelectors: [], once: true, timeZone: 'America/Denver' };
  const state = await runNinjaTraderMonitor({ settings, client: f.client, log: message => messages.push(message), createApi: () => { throw new Error('must not run'); } });
  assert.equal(state.baselineFillCount, 1); assert.ok(!messages.join('\n').includes(NAME));
});

function relayFixture(t) {
  const monitor = { snapshot: () => ({ source: 'NINJATRADER', environment: 'demo', status: 'OBSERVING', stale: false, readOnly: true, executionEnabled: false, accounts: [], positions: [], executions: [] }) };
  const quote = { source: 'NINJATRADER', environment: 'demo', symbol: '/MESZ26', providerSymbol: 'MESZ6', bid: 1, quoteTime: '2026-10-19T00:00:00Z', receivedAt: '2026-10-19T00:00:00Z' };
  const provider = { getQuote: async () => quote, getMinuteBars: async () => [], getDailyBars: async () => [] };
  const api = createNinjaTraderMonitorApi({ monitor, marketDataProvider: provider, config, port: 0 });
  t.after(() => api.stop()); return { api, monitor, quote, provider };
}
test('local API publishes read-only state and rejects write methods, foreign browser origins and rebinding hosts', async t => {
  const f = relayFixture(t), base = await f.api.start();
  assert.equal((await fetch(base + '/api/state')).status, 200); assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/api/state', { method: 'POST' })).status, 405);
  const cross = await fetch(base + '/api/state', { headers: { Origin: 'https://attacker.example' } });
  assert.equal(cross.status, 403); assert.equal(cross.headers.get('access-control-allow-origin'), null);
  const spoofed = await new Promise((resolve, reject) => {
    const request = http.get(base + '/api/state', { headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(spoofed, 403);
  f.monitor.snapshot = () => ({ source: 'NINJATRADER', environment: 'demo', status: 'DEGRADED', stale: true });
  assert.equal((await fetch(base + '/health')).status, 503);
});
test('market relay preserves original quote receipt time, validates profile/environment and admits no arbitrary RPC', async t => {
  const f = relayFixture(t), baseUrl = await f.api.start(), relay = new NinjaTraderMonitorProvider({ baseUrl, config });
  assert.deepEqual(await relay.getQuote('/MESZ26'), f.quote);
  assert.deepEqual(await relay.getMinuteBars('/MESZ26', { startDate: START, endDate: START + 60000 }), []);
  assert.equal((await fetch(baseUrl + '/api/tools/call')).status, 404);
  assert.equal((await fetch(baseUrl + '/api/market-data/quote?symbol=/MESZ26&tool=place_order')).status, 502);
  const wrong = structuredClone(config); wrong.environment = 'live';
  const mixed = new NinjaTraderMonitorProvider({ baseUrl, config: wrong }); await assert.rejects(mixed.getQuote('/MESZ26'), /PROFILE_MISMATCH/);
  assert.throws(() => new NinjaTraderMonitorProvider({ baseUrl: 'https://attacker.example', config }), /URL_MUST_BE_LOOPBACK/);
});
test('PRETRADE relay mode uses no OAuth directory, preserves Schwab routing and still blocks NinjaTrader permission quotes', async t => {
  const f = relayFixture(t), base = await f.api.start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-relay-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify(config));
  const result = await createConfiguredMarketDataProviders({ env: { EXECUTIONOS_NINJATRADER_CONFIG: file, EXECUTIONOS_NINJATRADER_MONITOR_URL: base },
    requestJson: async () => ({ NVDA: { quote: { bidPrice: 10 } } }) });
  assert.equal((await result.marketDataProvider.getQuote('/MESZ26')).source, 'NINJATRADER');
  assert.equal((await result.marketDataProvider.getQuote('NVDA')).source, 'SCHWAB');
  await assert.rejects(result.permissionMarketDataProvider.getQuote('/MESZ26'), /DATA_ONLY_PERMISSION_DISABLED/);
  await result.close();
});

function stopOrder(extra = {}) { return { id: 42, symbol: 'MESZ6', action: 'Sell', orderType: 'Stop', quantity: 1,
  ordStatus: 'Working', stopPrice: 5990, timeInForce: 'GTC', bracket: { parentId: 10, ocoId: 43 }, ...extra }; }
test('new stop, changed stop, and removed working order appear without fills or extra RPC', async () => {
  const f = fixture(); await f.monitor.initialize(); f.advance(); const before = f.calls.length;
  f.raw.portfolio.workingOrders = [stopOrder()]; await f.monitor.poll();
  let state = f.monitor.snapshot(), order = state.workingOrders[0];
  assert.equal(f.calls.length - before, 2); assert.equal(f.notifications.length, 0); assert.equal(state.executions.length, 0);
  assert.equal(order.orderId, 42); assert.equal(order.stopPrice, 5990); assert.equal(order.parentOrderId, 10); assert.equal(order.ocoOrderId, 43);
  assert.equal(order.symbol, 'MESZ6'); assert.equal(order.orderType, 'Stop'); assert.equal(order.stale, false);
  assert.equal(state.accounts[0].workingOrdersStatus, 'CURRENT'); assert.ok(!JSON.stringify(state).includes(NAME));
  const logs = []; logSnapshot(state, row => logs.push(row));
  assert.match(logs.join('\n'), /Working orders:\s+1/); assert.match(logs.join('\n'), /WORKING ORDER[\s\S]*Instruction:\s+Sell[\s\S]*Quantity:\s+1[\s\S]*Order type:\s+Stop[\s\S]*Stop price:\s+5990/);
  f.advance(); f.raw.portfolio.workingOrders[0].stopPrice = 5995; await f.monitor.poll();
  assert.equal(f.monitor.snapshot().workingOrders[0].stopPrice, 5995);
  f.raw.portfolio.workingOrders = []; await f.monitor.poll(); state = f.monitor.snapshot();
  assert.deepEqual(state.workingOrders, []); assert.equal(state.accounts[0].workingOrdersStatus, 'CURRENT');
  assert.equal(state.executions.length, 0); // Disappearance alone does not prove a cancellation or fill.
});
test('omitted orders retain prior values as stale instead of falsely reporting zero orders', async () => {
  const f = fixture(); f.raw.portfolio.workingOrders = [stopOrder()]; await f.monitor.initialize();
  const before = f.monitor.snapshot().workingOrders[0].observedAt; f.advance(); delete f.raw.portfolio.workingOrders;
  await f.monitor.poll(); let state = f.monitor.snapshot();
  assert.equal(state.status, 'OBSERVING'); assert.equal(state.accounts[0].workingOrdersStatus, 'UNAVAILABLE');
  assert.equal(state.accounts[0].workingOrdersObservedAt, before); assert.equal(state.workingOrders[0].stale, true);
  assert.equal(state.workingOrders[0].observedAt, before);
  const logs = []; logSnapshot(state, row => logs.push(row));
  assert.match(logs.join('\n'), /Working orders:\s+unavailable/); assert.match(logs.join('\n'), /ORDER — STATUS UNCONFIRMED/);
  f.raw.portfolio.workingOrders = []; await f.monitor.poll(); state = f.monitor.snapshot();
  assert.deepEqual(state.workingOrders, []); assert.equal(state.accounts[0].workingOrdersStatus, 'CURRENT');
  const g = fixture(); delete g.raw.portfolio.workingOrders; await g.monitor.initialize();
  assert.equal(g.monitor.snapshot().accounts[0].workingOrdersStatus, 'UNAVAILABLE'); assert.equal(g.monitor.snapshot().accounts[0].workingOrdersObservedAt, null);
});
test('invalid working orders fail the full cycle without advancing fill deduplication', async () => {
  for (const rows of [null, {}, [stopOrder(), stopOrder()], [stopOrder({ quantity: 0 })], [stopOrder({ stopPrice: '5990' })], [stopOrder({ action: 'BUY' })], [stopOrder({ id: null })]]) {
    const f = fixture(); await f.monitor.initialize(); const before = f.monitor.snapshot().lastSuccessfulAt;
    f.advance(); f.raw.fills.items.push(fill(2)); f.raw.portfolio.workingOrders = rows;
    await assert.rejects(f.monitor.poll(), /WORKING_ORDERS_INVALID/);
    assert.equal(f.monitor.snapshot().stale, true); assert.equal(f.monitor.snapshot().lastSuccessfulAt, before);
    assert.equal(f.notifications.length, 0); assert.deepEqual(f.monitor.snapshot().workingOrders, []);
    f.raw.portfolio.workingOrders = []; await f.monitor.poll(); assert.equal(f.notifications.length, 1);
  }
});
test('stop-limit prices are retained without interpreting bracket offsets as active protective orders', () => {
  const rows = normalizeMonitorWorkingOrders({ workingOrders: [stopOrder({ orderType: 'StopLimit', price: 5989.75, brackets: [{ stopLossDelta: -10 }] })] }, { name: NAME }, 'live', new Date(START).toISOString());
  assert.equal(rows[0].limitPrice, 5989.75); assert.equal(rows[0].stopPrice, 5990); assert.equal(rows[0].source, 'NINJATRADER');
  assert.equal(rows[0].brackets, undefined);
});
test('local state API publishes working stops with masked accounts and no write authority', async t => {
  const f = fixture(); f.raw.portfolio.workingOrders = [stopOrder()]; await f.monitor.initialize();
  const api = createNinjaTraderMonitorApi({ monitor: f.monitor, port: 0 }); t.after(() => api.stop()); const base = await api.start();
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.workingOrders[0].stopPrice, 5990); assert.equal(state.readOnly, true); assert.equal(state.executionEnabled, false);
  assert.ok(!JSON.stringify(state).includes(NAME)); assert.equal((await fetch(base + '/api/state', { method: 'POST' })).status, 405);
});

test('change logger ignores poll timestamps/reordering and does not repeat an order when account P&L changes', async () => {
  const f = fixture(); f.raw.portfolio.workingOrders = [stopOrder(), stopOrder({ id: 43 })];
  await f.monitor.initialize(); const messages = [], logChanges = createMonitorChangeLogger(row => messages.push(row));
  logChanges(f.monitor.snapshot()); messages.length = 0;
  f.advance(); f.raw.portfolio.workingOrders.reverse(); await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.deepEqual(messages, []);
  f.advance(); f.raw.portfolio.account.openPnL = 5; await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.equal(messages.length, 1); assert.match(messages[0], /Open P&L:\s+\$5\.00/); assert.doesNotMatch(messages[0], /WORKING ORDER/);
  messages.length = 0; f.raw.portfolio.workingOrders[0].stopPrice = 5995;
  await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.equal(messages.length, 1); assert.match(messages[0], /Stop price:\s+5995[\s\S]*Order ID:\s+43/);
});
test('change logger retains disappeared orders as unconfirmed and keeps coverage changes visible', async () => {
  const f = fixture(); f.raw.portfolio.workingOrders = [stopOrder()]; await f.monitor.initialize();
  const messages = [], logChanges = createMonitorChangeLogger(row => messages.push(row)); logChanges(f.monitor.snapshot()); messages.length = 0;
  f.raw.portfolio.workingOrders = [stopOrder({ id: 43 })]; await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.equal(messages.length, 3); assert.match(messages.join('\n'), /ORDER — STATUS UNCONFIRMED[\s\S]*Order ID:\s+42/);
  assert.doesNotMatch(messages.join('\n'), /cancelled|filled/i);
  messages.length = 0; delete f.raw.portfolio.workingOrders; await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.match(messages.join('\n'), /Working orders:\s+0 current; 1 status unconfirmed/); assert.match(messages.join('\n'), /ORDER — STATUS UNCONFIRMED/);
  messages.length = 0; f.advance(); await f.monitor.poll(); logChanges(f.monitor.snapshot()); assert.deepEqual(messages, []);
  f.raw.portfolio.workingOrders = []; await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.match(messages.join('\n'), /Working orders:\s+0 current; 2 status unconfirmed/); assert.doesNotMatch(messages.join('\n'), /NO LONGER REPORTED|ORDER CANCELLED/);
  assert.equal(f.monitor.snapshot().unconfirmedOrders.length, 2);
});
test('runner has no unchanged heartbeat, suppresses repeated errors, reports recovery and still emits new fills once', async () => {
  const f = fixture(), messages = [], controller = new AbortController(); let iteration = 0, clock = START;
  f.raw.portfolio.workingOrders = [stopOrder()];
  const settings = { environment: 'live', pollMs: 5000, accountSelectors: [], timeZone: 'America/Denver' };
  let stopped = false;
  await runNinjaTraderMonitor({ settings, client: f.client, signal: controller.signal, log: row => messages.push(row), now: () => clock,
    createApi: () => ({ start: async () => 'http://127.0.0.1:8789', stop: async () => { stopped = true; } }),
    wait: async () => {
      iteration++; clock += 66000;
      if (iteration === 2 || iteration === 3) f.raw.error = 'NINJATRADER_RATE_LIMIT_COOLDOWN';
      else delete f.raw.error;
      if (iteration === 5) f.raw.fills.items.push(fill(2));
      if (iteration === 7) controller.abort();
    } });
  assert.equal(stopped, true);
  assert.equal(messages.filter(row => row.startsWith('\nNINJATRADER MONITOR STATUS')).length, 3); // startup, degraded, recovery
  assert.equal(messages.filter(row => row.includes('⚠ Monitor poll failed: NINJATRADER_RATE_LIMIT_COOLDOWN')).length, 1);
  assert.equal(messages.filter(row => row.startsWith('\nNEW NINJATRADER EXECUTION')).length, 1);
  assert.equal(messages.filter(row => /NINJATRADER (WORKING ORDER|ORDER — STATUS UNCONFIRMED)/.test(row)).length, 3); // initial, stale, recovered
  assert.ok(!messages.some(row => /last successful read/.test(row)));
});

test('Schwab-style order blocks align labels and distinguish stop-market N/A from missing limit prices', async () => {
  const f = fixture(); f.raw.portfolio.account.netLiq = 3180.459999999359; f.raw.portfolio.workingOrders = [stopOrder()];
  await f.monitor.initialize(); const messages = []; logSnapshot(f.monitor.snapshot(), row => messages.push(row));
  assert.equal(messages.find(row => row.includes('NINJATRADER WORKING ORDER')), `
NINJATRADER WORKING ORDER
----------------------------------------
Account:        ••••3456
Symbol:         MESZ6
Instruction:    Sell
Quantity:       1
Order type:     Stop
Stop price:     5990
Limit price:    Not applicable
Order status:   Working
Time in force:  GTC
Order ID:       42
----------------------------------------`);
  assert.match(messages.join('\n'), /Current equity: \$3,180\.46/);
  assert.ok(!messages.join('\n').includes('3180.459999'));
  f.raw.portfolio.workingOrders[0].orderType = 'StopLimit'; await f.monitor.poll();
  const after = []; logSnapshot(f.monitor.snapshot(), row => after.push(row)); assert.match(after.join('\n'), /Limit price:\s+—/);
  f.raw.portfolio.account.netLiq = null; f.raw.portfolio.account.openPnL = null; await f.monitor.poll();
  const missing = []; logSnapshot(f.monitor.snapshot(), row => missing.push(row)); assert.match(missing.join('\n'), /Current equity: —/); assert.match(missing.join('\n'), /Open P&L:\s+—/);
});
test('Schwab-style execution block shows source facts and millisecond Mountain timestamps without inferred transitions', () => {
  const text = formatNinjaTraderFill({ accountDisplay: '••••3456', environment: 'live', symbol: 'MESZ6', action: 'Sell', quantity: 1,
    price: 5990.25, orderId: 42, fillId: 2, executionTime: '2026-10-19T22:00:00.123Z', detectedAt: '2026-10-19T22:00:00.456Z' });
  assert.ok(text.startsWith('\nNEW NINJATRADER EXECUTION\n----------------------------------------\n'));
  assert.match(text, /Instruction:\s+Sell/); assert.match(text, /Fill price:\s+5990\.25/);
  assert.match(text, /Broker fill:\s+16:00:00\.123 MDT/); assert.match(text, /Detected:\s+16:00:00\.456 MDT/);
  assert.match(text, /Observed delay: 333 ms/);
  assert.doesNotMatch(text, /Position effect|State event|Transition|ARMED|max risk|PRIVATE/);
  const skew = formatNinjaTraderFill({ executionTime: '2026-10-19T22:00:01Z', detectedAt: '2026-10-19T22:00:00Z' });
  assert.match(skew, /-1000 ms \(local\/API clock skew\)/);
});
test('currency display noise remains quiet and does not round the API account values', async () => {
  const f = fixture(); await f.monitor.initialize(); const messages = [], logChanges = createMonitorChangeLogger(row => messages.push(row));
  logChanges(f.monitor.snapshot()); messages.length = 0;
  f.raw.portfolio.account.netLiq = 10000.0000000001; await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.deepEqual(messages, []); assert.equal(f.monitor.snapshot().accounts[0].netLiquidation, 10000.0000000001);
  f.raw.portfolio.account.netLiq = 10000.01; await f.monitor.poll(); logChanges(f.monitor.snapshot());
  assert.equal(messages.length, 1); assert.match(messages[0], /\$10,000\.01/);
});

test('refresh-check rotates credentials and verifies authenticated read tools without account polling or a listener', async () => {
  const f = fixture(), messages = []; let refreshes = 0;
  f.client.refreshAuthorization = async () => { refreshes++; };
  const settings = { environment: 'live', pollMs: 5000, accountSelectors: [], refreshCheck: true, timeZone: 'America/Denver' };
  await runNinjaTraderMonitor({ settings, client: f.client, log: row => messages.push(row), createApi: () => { throw new Error('must not start'); } });
  assert.equal(refreshes, 1); assert.deepEqual(f.calls, []); assert.match(messages.join('\n'), /token refresh verified/);
  assert.equal(monitorConfig({}, ['--refresh-check']).refreshCheck, true);
});
test('temporary refresh failures no longer instruct browser authorization; real rejection is explicit', () => {
  const transient = monitorFailureHint(new Error('NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE'));
  assert.match(transient, /without running browser authorization/); assert.doesNotMatch(transient, /npm run ninjascript:auth/);
  assert.match(monitorFailureHint(new Error('NINJATRADER_REFRESH_TOKEN_REJECTED_REAUTHORIZE_REQUIRED')), /npm run ninjascript:auth/);
  assert.equal(monitorFailureHint(new Error('NINJATRADER_RATE_LIMIT_COOLDOWN')), null);
});
