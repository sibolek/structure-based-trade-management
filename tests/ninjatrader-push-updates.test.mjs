import test from 'node:test';
import assert from 'node:assert/strict';
import { NinjaTraderReadOnlyClient, endpointFor } from '../schwab-bridge/ninjatrader-mcp-client.mjs';
import { NinjaTraderMonitor } from '../schwab-bridge/ninjatrader-monitor-state.mjs';
import { runNinjaTraderMonitor } from '../schwab-bridge/ninjatrader-monitor.mjs';
const endpoint = endpointFor('demo'), encoder = new TextEncoder();
function subscriptionServer({ supported = true, reject = false, streamUnsupported = false } = {}) {
  const requests = [], streams = []; let nextId = 0;
  const fetchImpl = async (_url, init = {}) => {
    if (init.method === 'GET') {
      if (streamUnsupported) return new Response(null, { status: 405 });
      let controller;
      const body = new ReadableStream({ start(value) { controller = value; } });
      const stream = { controller, signal: init.signal, notify: uri => controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri } })}\n\n`)) };
      init.signal.addEventListener('abort', () => { try { controller.close(); } catch {} }, { once: true }); streams.push(stream);
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    const message = JSON.parse(init.body); requests.push(message);
    if (message.id === undefined) return new Response(null, { status: 202 });
    let result;
    if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, resources: { subscribe: supported } }, serverInfo: { name: 'synthetic', version: '1' } };
    else if (message.method === 'tools/list') result = { tools: [] };
    else if (message.method === 'resources/subscribe') {
      if (reject) return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'PRIVATE_SUBSCRIPTION_ERROR' } }), { headers: { 'Content-Type': 'application/json' } });
      result = {};
    } else if (message.method === 'resources/read') result = { contents: [{ uri: message.params.uri, text: '[]' }] };
    else throw new Error('Unexpected request: ' + message.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }), { headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': String(++nextId) } });
  };
  return { fetchImpl, requests, streams };
}
const provider = { endpoint, tokens: () => ({ access_token: 'SYNTHETIC_TOKEN', token_type: 'Bearer' }) };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('read-only subscriptions deliver only allowlisted notifications, survive 15 seconds and restore after reconnect', async t => {
  const server = subscriptionServer(), received = [];
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider, accountObservation: true, fetchImpl: server.fetchImpl });
  t.after(() => client.close());
  assert.equal(await client.watchAccountUpdates(uri => received.push(uri)), true); await tick();
  assert.deepEqual(server.requests.filter(row => row.method === 'resources/subscribe').map(row => row.params.uri), ['tradovate://orders', 'tradovate://positions']);
  t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.timers.tick(16000);
  assert.equal(server.streams[0].signal.aborted, false);
  server.streams[0].notify('tradovate://orders'); server.streams[0].notify('tradovate://positions'); server.streams[0].notify('tradovate://risk-settings'); await tick();
  assert.deepEqual(received, ['tradovate://orders', 'tradovate://positions']);
  await client.resetConnection(); await client.readOrderList(); await tick();
  assert.equal(server.requests.filter(row => row.method === 'resources/subscribe').length, 4);
  assert.equal(server.streams[0].signal.aborted, true);
  server.streams.at(-1).notify('tradovate://orders'); await tick(); assert.equal(received.length, 3);
  client.stopAccountUpdates(); server.streams.at(-1).notify('tradovate://orders'); await tick(); assert.equal(received.length, 3);
});
test('subscriptions stay denied in market-only mode and cannot target arbitrary resources even in observation mode', async t => {
  let calls = 0;
  const market = new NinjaTraderReadOnlyClient({ oauthProvider: provider, fetchImpl: async () => { calls++; } });
  await assert.rejects(market.watchAccountUpdates(() => {}), /RESOURCE_DENIED/);
  for (const method of ['resources/subscribe', 'resources/unsubscribe']) await assert.rejects(market.fetch(endpoint, { method: 'POST', body: JSON.stringify({ method, params: { uri: 'tradovate://orders' } }) }), /RPC_DENIED/);
  assert.equal(calls, 0);
  const server = subscriptionServer(), observer = new NinjaTraderReadOnlyClient({ oauthProvider: provider, accountObservation: true, fetchImpl: server.fetchImpl }); t.after(() => observer.close());
  for (const method of ['resources/subscribe', 'resources/unsubscribe']) for (const uri of ['tradovate://account-list', 'tradovate://risk-settings', 'https://attacker.example'])
    await assert.rejects(observer.fetch(endpoint, { method: 'POST', body: JSON.stringify({ method, params: { uri } }) }), /RPC_DENIED/);
  assert.equal(server.requests.length, 0);
});
test('unsupported or rejected subscriptions fall back without preventing reads or retrying every call', async t => {
  for (const options of [{ supported: false }, { reject: true }, { streamUnsupported: true }]) {
    const server = subscriptionServer(options), client = new NinjaTraderReadOnlyClient({ oauthProvider: provider, accountObservation: true, fetchImpl: server.fetchImpl }); t.after(() => client.close());
    assert.equal(await client.watchAccountUpdates(() => {}), false);
    await client.readOrderList(); await client.readPositionList();
    assert.equal(server.requests.filter(row => row.method === 'resources/subscribe').length, options.reject ? 1 : 0);
  }
});
test('a dead update stream leaves reads available and reconnects at most once per minute', async t => {
  let clock = 100000;
  const server = subscriptionServer(), client = new NinjaTraderReadOnlyClient({ oauthProvider: provider, accountObservation: true, fetchImpl: server.fetchImpl, now: () => clock }); t.after(() => client.close());
  await client.watchAccountUpdates(() => {}); await tick();
  server.streams[0].controller.error(new Error('PRIVATE_STREAM_ERROR')); await tick();
  await client.readOrderList(); assert.equal(server.requests.filter(row => row.method === 'resources/subscribe').length, 2);
  clock += 60001; await client.readOrderList();
  assert.equal(server.requests.filter(row => row.method === 'resources/subscribe').length, 4);
});

const NAME = 'SYNTHETIC-1234', START = Date.parse('2026-10-20T13:00:00Z');
function monitorFixture() {
  let clock = START, update;
  const calls = [], raw = { orders: [{ id: 42, symbol: 'MESZ6', action: 'Buy', orderType: 'Stop', quantity: 1, ordStatus: 'Working', stopPrice: 7740 }], fills: [] };
  const client = { toolCatalog: async () => ['my_portfolio', 'fill_history', 'order_history'].map(name => ({ name })), readAccountList: async () => [{ name: NAME }],
    watchAccountUpdates: async listener => { update = listener; return true; }, stopAccountUpdates: () => { update = null; },
    callTool: async name => {
      calls.push({ name, at: clock - START }); if (raw.error) throw new Error(raw.error);
      if (name === 'my_portfolio') return { account: { name: NAME }, positions: [], workingOrders: structuredClone(raw.orders) };
      if (name === 'order_history') return { items: [{ account: NAME, orderId: 42, symbol: 'MESZ6', action: 'Buy', quantity: 1, filledQty: 0, ordStatus: 'Canceled' }] };
      return { items: structuredClone(raw.fills) };
    } };
  return { client, calls, raw, now: () => clock, setTime: value => { clock = START + value; }, advance: ms => { clock += ms; }, update: () => update?.('tradovate://orders') };
}
test('push snapshots confirm cancellations without extra fill queries, then regular polling emits fills once', async () => {
  const f = monitorFixture(), fills = [], monitor = new NinjaTraderMonitor({ client: f.client, environment: 'live', now: f.now, onFill: fill => fills.push(fill) });
  await monitor.initialize(); const baseline = monitor.snapshot().lastFillSuccessfulAt;
  f.setTime(2000); f.raw.orders = []; f.raw.fills.push({ account: NAME, fillId: 1, orderId: 43, symbol: 'MESZ6', action: 'Sell', quantity: 1, price: 7745, timestamp: new Date(START + 1000).toISOString() });
  await monitor.poll({ readFills: false });
  assert.equal(monitor.snapshot().orderEvents[0].status, 'Cancelled'); assert.equal(monitor.snapshot().orderEvents[0].positionQuantity, 0);
  assert.equal(monitor.snapshot().lastFillSuccessfulAt, baseline); assert.equal(fills.length, 0); assert.equal(f.calls.filter(row => row.name === 'fill_history').length, 1);
  f.setTime(15000); await monitor.poll(); await monitor.poll(); assert.equal(fills.length, 1);
  assert.notEqual(monitor.snapshot().lastFillSuccessfulAt, baseline);
});
const settings = { environment: 'live', pollMs: 15000, accountSelectors: [], timeZone: 'America/Denver' };
const createApi = () => ({ start: async () => 'http://127.0.0.1:8789', stop: async () => {} });
test('notifications wake the runner before 15s, coalesce bursts and cannot postpone regular fill polls', async () => {
  const f = monitorFixture(), controller = new AbortController(), messages = []; let waits = 0;
  await runNinjaTraderMonitor({ settings, client: f.client, signal: controller.signal, now: f.now, createApi, log: row => messages.push(row),
    wait: async delay => {
      waits++;
      if (waits === 1 || waits === 2) { f.setTime(waits === 1 ? 2000 : 3000); f.raw.orders = []; for (let i = 0; i < 20; i++) f.update(); throw new DOMException('Aborted', 'AbortError'); }
      f.advance(delay); if (f.now() >= START + 30000) controller.abort();
    } });
  assert.deepEqual(f.calls.filter(row => row.name === 'my_portfolio').map(row => row.at), [0, 2000, 7000, 15000]);
  assert.deepEqual(f.calls.filter(row => row.name === 'fill_history').map(row => row.at), [0, 15000]);
  assert.equal(messages.filter(row => row.includes('NINJATRADER ORDER CANCELLED')).length, 1);
});
test('notifications cannot bypass a rate-limit cooldown; recovery performs a full fill poll', async () => {
  const f = monitorFixture(), controller = new AbortController(); let waits = 0;
  await runNinjaTraderMonitor({ settings, client: f.client, signal: controller.signal, now: f.now, createApi, log: () => {},
    wait: async delay => {
      waits++;
      if (waits <= 2) { f.setTime(waits === 1 ? 2000 : 3000); f.raw.error = 'NINJATRADER_RATE_LIMIT_COOLDOWN'; f.update(); throw new DOMException('Aborted', 'AbortError'); }
      if (waits === 3) { assert.equal(delay, 59000); delete f.raw.error; f.advance(delay); } else controller.abort();
    } });
  assert.deepEqual(f.calls.filter(row => row.name === 'my_portfolio').map(row => row.at), [0, 2000, 62000]);
  assert.deepEqual(f.calls.filter(row => row.name === 'fill_history').map(row => row.at), [0, 62000]);
});
