import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NinjaTraderOAuthStore, NinjaTraderReadOnlyClient, endpointFor } from '../schwab-bridge/ninjatrader-mcp-client.mjs';
import { validateOAuthCallback } from '../schwab-bridge/ninjatrader-read-only.mjs';

const endpoint = endpointFor('demo');
const issuer = 'https://demo.tradovateapi.com';
function temp(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-auth-')); fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory;
}
function fakeServer({ sse = false, throttle = false, failRefresh = false, required = ['symbols'], pages = false } = {}) {
  const requests = []; let toolCalls = 0;
  const json = (result, id) => new Response(JSON.stringify(id === undefined ? result : { jsonrpc: '2.0', id, result }),
    { headers: { 'Content-Type': 'application/json' } });
  const fetchImpl = async (input, init = {}) => {
    const url = String(input); requests.push({ url, ...init });
    if (url.includes('oauth-protected-resource')) return json({ resource: endpoint, authorization_servers: [issuer], scopes_supported: ['mcp:connect'] });
    if (url.includes('.well-known/')) return json({ issuer, authorization_endpoint: 'https://web.ninjatrader.com/oauth?env=demo', token_endpoint: issuer + '/auth/oauthtoken',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'] });
    if (url.endsWith('/auth/oauthtoken')) {
      if (failRefresh) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'SENSITIVE_TOKEN' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const params = JSON.parse(init.body);
      assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
      assert.equal(params.resource, endpoint); assert.equal(params.grant_type, 'refresh_token');
      assert.equal(params.client_id, 'public-client');
      return json({ access_token: 'ROTATED_ACCESS', refresh_token: 'ROTATED_REFRESH', expires_in: 4800, token_type: 'Bearer' });
    }
    if (init.method === 'GET') return new Response(null, { status: 405 });
    const message = JSON.parse(init.body);
    if (!Object.hasOwn(message, 'id')) return new Response(null, { status: 202 });
    if (message.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id,
      result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'synthetic-NT-test-server', version: '1' } } }),
      { headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'TEST_SESSION' } });
    assert.equal(new Headers(init.headers).get('Mcp-Session-Id'), 'TEST_SESSION');
    assert.ok(new Headers(init.headers).get('MCP-Protocol-Version'));
    if (message.method === 'tools/list') {
      const tool = { name: 'market_snapshot', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', required, properties: { symbols: { type: 'array', items: { type: 'string' } } } } };
      if (pages && !message.params?.cursor) return json({ tools: [{ ...tool, name: 'place_order' }], nextCursor: 'next' }, message.id);
      return json({ tools: [tool, { ...tool, name: 'place_order' }, { ...tool, name: 'my_portfolio' }] }, message.id);
    }
    assert.equal(message.method, 'tools/call'); assert.equal(message.params.name, 'market_snapshot'); toolCalls++;
    if (throttle) return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
    const result = { content: [{ type: 'text', text: JSON.stringify({ quotes: [] }) }] };
    if (!sse) return json(result, message.id);
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'synthetic' } })}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { fetchImpl, requests, get toolCalls() { return toolCalls; } };
}
function provider() { return { endpoint, tokens: () => ({ access_token: 'SECRET_ACCESS', token_type: 'Bearer' }) }; }

for (const sse of [false, true]) test(`SDK handles ${sse ? 'SSE' : 'JSON'} responses, initialization/session headers and paged tool discovery`, async t => {
  const server = fakeServer({ sse, pages: true });
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider(), fetchImpl: server.fetchImpl }); t.after(() => client.close());
  assert.deepEqual((await client.toolCatalog()).map(tool => tool.name), ['market_snapshot']);
  assert.deepEqual(await client.callTool('market_snapshot', { symbols: ['MESZ6'] }), { quotes: [] });
  assert.equal(server.toolCalls, 1);
  assert.ok(server.requests.every(request => new URL(request.url).origin === new URL(endpoint).origin));
});
test('hard allowlist denies orders, account reads, alerts, risk writes and arbitrary RPC before network', async () => {
  let calls = 0;
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider(), fetchImpl: async () => { calls++; throw new Error('must not run'); } });
  for (const tool of ['place_order', 'modify_order', 'cancel_order', 'close_position', 'update_risk_settings', 'create_alert', 'my_portfolio', 'user_profile', 'order_history']) {
    await assert.rejects(client.callTool(tool, {}), /TOOL_DENIED/);
    await assert.rejects(client.fetch(endpoint, { method: 'POST', body: JSON.stringify({ method: 'tools/call', params: { name: tool } }) }), /RPC_DENIED/);
  }
  await assert.rejects(client.fetch(endpoint, { method: 'POST', body: JSON.stringify({ method: 'resources/read' }) }), /RPC_DENIED/);
  assert.equal(calls, 0);
});
test('rejects foreign origins, HTTP, invalid environments and environment mixing before any credentials leave', async () => {
  let calls = 0; const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider(), fetchImpl: async () => { calls++; } });
  for (const url of ['https://attacker.example/token', 'http://mcp-demo.tradovateapi.com/mcp', 'https://mcp-live.tradovateapi.com/mcp'])
    await assert.rejects(client.fetch(url), /ORIGIN_REJECTED/);
  assert.equal(calls, 0);
  assert.throws(() => endpointFor('__proto__'), /ENVIRONMENT_INVALID/);
  assert.throws(() => new NinjaTraderReadOnlyClient({ environment: 'live', oauthProvider: provider() }), /ENVIRONMENT_MISMATCH/);
});
test('validates live input schema rather than sending incompatible beta arguments', async t => {
  const server = fakeServer({ required: ['newRequiredField'] });
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider(), fetchImpl: server.fetchImpl }); t.after(() => client.close());
  await assert.rejects(client.callTool('market_snapshot', { symbols: ['MESZ6'] }), /INPUT_SCHEMA_MISMATCH/);
  assert.equal(server.toolCalls, 0);
});
test('429 honors cooldown with no retry storm and no response/token disclosure', async t => {
  const server = fakeServer({ throttle: true }); let clock = 100000;
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider(), fetchImpl: server.fetchImpl, now: () => clock }); t.after(() => client.close());
  await assert.rejects(client.callTool('market_snapshot', { symbols: ['MESZ6'] }), /RATE_LIMIT_COOLDOWN/);
  clock += 61000;
  await assert.rejects(client.callTool('market_snapshot', { symbols: ['MESZ6'] }), /RATE_LIMIT_COOLDOWN/);
  assert.equal(server.toolCalls, 1);
});
test('OAuth store is private, atomic, environment-bound and exclusively locked', async t => {
  const directory = temp(t); const store = new NinjaTraderOAuthStore({ directory });
  t.after(() => store.close());
  store.saveClientInformation({ client_id: 'public-client', issuer });
  store.saveTokens({ access_token: 'A', refresh_token: 'R', token_type: 'Bearer', expires_in: 4800, issuer });
  const file = path.join(directory, 'demo.json'); const before = fs.readFileSync(file, 'utf8');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(before).resource, endpoint);
  assert.throws(() => new NinjaTraderOAuthStore({ directory }), /STORE_LOCKED/);
  assert.throws(() => store.saveTokens({ error: 'invalid_grant' }), /TOKEN_RESPONSE_INVALID/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  await assert.rejects(store.validateResourceURL(endpoint, endpointFor('live')), /RESOURCE_MISMATCH/);
});
test('OAuth refuses symlinks and readable token files', t => {
  const directory = temp(t); const linked = path.join(directory, 'linked'); fs.symlinkSync(directory, linked);
  assert.throws(() => new NinjaTraderOAuthStore({ directory: linked }), /DIRECTORY_NOT_PRIVATE/);
  const file = path.join(directory, 'demo.json'); fs.writeFileSync(file, '{}', { mode: 0o644 });
  assert.throws(() => new NinjaTraderOAuthStore({ directory }), /FILE_NOT_PRIVATE/);
  assert.equal(fs.existsSync(path.join(directory, 'demo.lock')), false);
});
test('an unwritable OAuth directory is distinguished from a live process lock', t => {
  const directory = temp(t); fs.chmodSync(directory, 0o500);
  try { assert.throws(() => new NinjaTraderOAuthStore({ directory }), /AUTH_STORE_NOT_WRITABLE/); }
  finally { fs.chmodSync(directory, 0o700); }
});
test('OAuth refresh sends the MCP audience and persists rotated tokens', async t => {
  const directory = temp(t), store = new NinjaTraderOAuthStore({ directory });
  store.saveClientInformation({ client_id: 'public-client', issuer });
  store.saveTokens({ access_token: 'OLD', refresh_token: 'OLD_REFRESH', token_type: 'Bearer', expires_in: 1, issuer });
  const server = fakeServer(); const client = new NinjaTraderReadOnlyClient({ oauthProvider: store, fetchImpl: server.fetchImpl });
  t.after(async () => { await client.close(); store.close(); });
  await client.toolCatalog();
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'demo.json'), 'utf8'));
  assert.equal(saved.tokens.refresh_token, 'ROTATED_REFRESH'); assert.equal(saved.tokens.access_token, 'ROTATED_ACCESS');
  assert.equal(server.requests.filter(request => request.url.endsWith('/auth/oauthtoken')).length, 1);
});
test('failed refresh preserves saved credentials and reports a sanitized error', async t => {
  const directory = temp(t), store = new NinjaTraderOAuthStore({ directory });
  store.saveClientInformation({ client_id: 'public-client', issuer });
  store.saveTokens({ access_token: 'OLD', refresh_token: 'OLD_REFRESH', token_type: 'Bearer', expires_in: 1, issuer });
  const file = path.join(directory, 'demo.json'), before = fs.readFileSync(file, 'utf8');
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: store, fetchImpl: fakeServer({ failRefresh: true }).fetchImpl });
  t.after(async () => { await client.close(); store.close(); });
  await assert.rejects(client.toolCatalog(), error => /^NINJATRADER_[A-Z0-9_]+$/.test(error.message) && !error.message.includes('SENSITIVE_TOKEN'));
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});
test('OAuth callback requires exact path, state and a single code', () => {
  assert.equal(validateOAuthCallback('/callback?state=valid&code=CODE', 'valid'), 'CODE');
  for (const url of ['/callback?state=wrong&code=CODE', '/callback?state=valid', '/other?state=valid&code=CODE',
    '/callback?state=valid&code=CODE&error=denied', '/callback?state=valid&code=A&code=B'])
    assert.throws(() => validateOAuthCallback(url, 'valid'), /CALLBACK_REJECTED/);
});
test('browser authorization uses the separately discovered official consent origin and exact environment', t => {
  const directory = temp(t); let selected;
  const store = new NinjaTraderOAuthStore({ directory, onAuthorize: url => { selected = url; } }); t.after(() => store.close());
  const url = new URL('https://web.ninjatrader.com/oauth?env=demo&state=TEST');
  store.redirectToAuthorization(url); assert.equal(selected, url);
  for (const wrong of ['https://attacker.example/oauth?env=demo', 'https://web.ninjatrader.com/oauth?env=live',
    'https://web.ninjatrader.com/other?env=demo', 'https://web.ninjatrader.com/oauth?env=demo&env=live'])
    assert.throws(() => store.redirectToAuthorization(new URL(wrong)), /AUTH_ORIGIN_REJECTED/);
});
test('default market-data clients cannot read account/position resources', async () => {
  let calls = 0; const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider(), fetchImpl: async () => { calls++; } });
  await assert.rejects(client.readAccountList(), /RESOURCE_DENIED/);
  await assert.rejects(client.readPositionList(), /RESOURCE_DENIED/); await assert.rejects(client.readOrderList(), /RESOURCE_DENIED/); assert.equal(calls, 0);
});
test('explicit monitor capability permits only portfolio/fill tools and two fixed observation resources', async t => {
  const requests = [];
  const fetchImpl = async (input, init = {}) => {
    if (init.method === 'GET') return new Response(null, { status: 405 });
    const m = JSON.parse(init.body); requests.push(m);
    if (!Object.hasOwn(m, 'id')) return new Response(null, { status: 202 });
    let result;
    if (m.method === 'initialize') result = { protocolVersion: m.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'synthetic-monitor', version: '1' } };
    else if (m.method === 'tools/list') result = { tools: ['my_portfolio', 'fill_history', 'order_history', 'place_order', 'cancel_order', 'risk_settings'].map(name => ({ name, inputSchema: { type: 'object' }, annotations: { readOnlyHint: !['place_order', 'cancel_order'].includes(name) } })) };
    else if (m.method === 'resources/read') result = { contents: [{ uri: m.params.uri, mimeType: 'application/json', text: '[]' }] };
    else if (m.method === 'tools/call') result = { content: [{ type: 'text', text: '{"ok":true}' }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }), { headers: { 'Content-Type': 'application/json' } });
  };
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: provider(), fetchImpl, accountObservation: true }); t.after(() => client.close());
  assert.deepEqual((await client.toolCatalog()).map(tool => tool.name), ['my_portfolio', 'fill_history', 'order_history']);
  assert.deepEqual(await client.readAccountList(), []); assert.deepEqual(await client.readPositionList(), []); assert.deepEqual(await client.readOrderList(), []);
  assert.deepEqual(await client.callTool('my_portfolio', { account: 'synthetic' }), { ok: true });
  const before = requests.length;
  for (const name of ['place_order', 'modify_order', 'cancel_order', 'close_position', 'update_risk_settings', 'create_alert', 'risk_settings'])
    await assert.rejects(client.callTool(name, {}), /TOOL_DENIED/);
  await assert.rejects(client.fetch(endpoint, { method: 'POST', body: JSON.stringify({ method: 'resources/read', params: { uri: 'tradovate://risk-settings' } }) }), /RPC_DENIED/);
  assert.equal(requests.length, before);
});

function refreshFixture(t, extra = {}) {
  let clock = Date.now(); const directory = temp(t), store = new NinjaTraderOAuthStore({ directory, now: () => clock });
  store.saveClientInformation({ client_id: 'public-client', issuer });
  store.saveTokens({ access_token: 'OLD', refresh_token: 'OLD_REFRESH', token_type: 'Bearer', expires_in: 4800, issuer });
  const server = fakeServer(extra); let mode = 'ok', tokenCalls = 0, redirects = 0;
  store.onAuthorize = () => { redirects++; };
  const fetchImpl = async (input, init) => {
    if (String(input).endsWith('/auth/oauthtoken')) {
      tokenCalls++;
      if (mode === 'network') throw new TypeError('PRIVATE_TOKEN');
      if (mode === 'invalid200') return new Response(JSON.stringify({ error: 'invalid_token', error_description: 'PRIVATE_TOKEN' }), { headers: { 'Content-Type': 'application/json' } });
      if (mode === 'busy') return new Response('PRIVATE_TOKEN', { status: 503 });
      if (mode === 'rate') return new Response('{}', { status: 429, headers: { 'Retry-After': '45' } });
      if (mode === 'malformed') return new Response('{', { headers: { 'Content-Type': 'application/json' } });
      if (mode === 'no-rotation') return new Response(JSON.stringify({ access_token: 'NEW', token_type: 'Bearer', expires_in: 4800 }), { headers: { 'Content-Type': 'application/json' } });
    }
    return server.fetchImpl(input, init);
  };
  const client = new NinjaTraderReadOnlyClient({ oauthProvider: store, fetchImpl, now: () => clock });
  t.after(async () => { await client.close(); store.close(); });
  return { store, client, server, setMode: next => { mode = next; }, advance: ms => { clock += ms; },
    saved: () => fs.readFileSync(path.join(directory, 'demo.json'), 'utf8'), counts: () => ({ tokenCalls, redirects }) };
}
test('proactive refresh runs five minutes before expiry and sends the rotated bearer token on SDK requests', async t => {
  const f = refreshFixture(t); f.advance(75 * 60000); await f.client.toolCatalog();
  assert.equal(f.counts().tokenCalls, 1); assert.equal(f.counts().redirects, 0);
  assert.equal(f.store.tokens().refresh_token, 'ROTATED_REFRESH');
  const initialized = f.server.requests.find(row => row.method === 'POST' && String(row.body).includes('"initialize"'));
  assert.equal(new Headers(initialized.headers).get('Authorization'), 'Bearer ROTATED_ACCESS');
});
test('HTTP 200 OAuth rejection is precise, noninteractive, cached and preserves saved credentials', async t => {
  const f = refreshFixture(t); const before = f.saved(); f.setMode('invalid200');
  await assert.rejects(f.client.refreshAuthorization(), /^Error: NINJATRADER_REFRESH_TOKEN_REJECTED_REAUTHORIZE_REQUIRED$/);
  await assert.rejects(f.client.refreshAuthorization(), /REFRESH_TOKEN_REJECTED/);
  assert.equal(f.counts().tokenCalls, 1); assert.equal(f.counts().redirects, 0); assert.equal(f.saved(), before);
  assert.ok(!f.server.requests.some(row => /register|authorize/.test(row.url)));
});
test('transient refresh failure retains a valid access token, then retries without browser consent', async t => {
  const f = refreshFixture(t); const before = f.saved(); f.advance(75 * 60000); f.setMode('network');
  await f.client.toolCatalog(); assert.equal(f.store.tokens().access_token, 'OLD'); assert.equal(f.saved(), before);
  await f.client.callTool('market_snapshot', { symbols: ['MESZ6'] }); assert.equal(f.counts().tokenCalls, 1);
  f.advance(16000); f.setMode('ok'); await f.client.callTool('market_snapshot', { symbols: ['MESZ6'] });
  assert.equal(f.store.tokens().access_token, 'ROTATED_ACCESS'); assert.equal(f.counts().tokenCalls, 2); assert.equal(f.counts().redirects, 0);
});
test('expired access plus temporary refresh outage blocks reads without claiming reauthorization is required', async t => {
  for (const mode of ['network', 'busy', 'malformed']) {
    const f = refreshFixture(t); const before = f.saved(); f.advance(81 * 60000); f.setMode(mode);
    await assert.rejects(f.client.toolCatalog(), /^Error: NINJATRADER_TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE$/);
    assert.equal(f.saved(), before); assert.equal(f.counts().redirects, 0);
    assert.ok(!f.server.requests.some(row => row.method === 'POST' && String(row.body).includes('"initialize"')));
  }
});
test('refresh Retry-After is honored and retries are bounded', async t => {
  const f = refreshFixture(t); f.setMode('rate');
  await assert.rejects(f.client.refreshAuthorization(), /TEMPORARILY_UNAVAILABLE/); f.advance(30000);
  await assert.rejects(f.client.refreshAuthorization(), /TEMPORARILY_UNAVAILABLE/); assert.equal(f.counts().tokenCalls, 1);
  f.advance(16000); f.setMode('ok'); await f.client.refreshAuthorization(); assert.equal(f.counts().tokenCalls, 2);
});
test('market-data cooldown does not block a credential refresh', async t => {
  const f = refreshFixture(t, { throttle: true }); await f.client.toolCatalog();
  await assert.rejects(f.client.callTool('market_snapshot', { symbols: ['MESZ6'] }), /RATE_LIMIT_COOLDOWN/);
  await f.client.refreshAuthorization(); assert.equal(f.counts().tokenCalls, 1); assert.equal(f.store.tokens().access_token, 'ROTATED_ACCESS');
  await assert.rejects(f.client.callTool('market_snapshot', { symbols: ['MESZ6'] }), /RATE_LIMIT_COOLDOWN/);
  assert.equal(f.server.toolCalls, 1);
});
test('refresh preserves the prior refresh token if no replacement is returned', async t => {
  const f = refreshFixture(t); f.setMode('no-rotation'); await f.client.refreshAuthorization();
  assert.equal(f.store.tokens().access_token, 'NEW'); assert.equal(f.store.tokens().refresh_token, 'OLD_REFRESH');
});
test('foreign discovery issuer is refused before any refresh credential is sent', async t => {
  const f = refreshFixture(t); const fetchOriginal = f.client.fetch; let tokenCalls = 0;
  f.client.fetch = async (input, init) => {
    if (String(input).includes('oauth-protected-resource')) return new Response(JSON.stringify({ resource: endpoint, authorization_servers: ['https://attacker.example'] }), { headers: { 'Content-Type': 'application/json' } });
    if (String(input).endsWith('/auth/oauthtoken')) tokenCalls++;
    return fetchOriginal(input, init);
  };
  await assert.rejects(f.client.refreshAuthorization(), /REFRESH_CONFIGURATION_REJECTED|ORIGIN_REJECTED|TEMPORARILY_UNAVAILABLE/);
  assert.equal(tokenCalls, 0); assert.equal(f.counts().tokenCalls, 0);
});

test('an SDK 401 never opens authorization; reconnect refreshes credentials under the same owner', async t => {
  let rejected = false;
  const directory = temp(t), store = new NinjaTraderOAuthStore({ directory });
  store.saveClientInformation({ client_id: 'public-client', issuer });
  store.saveTokens({ access_token: 'OLD', refresh_token: 'OLD_REFRESH', token_type: 'Bearer', expires_in: 4800, issuer });
  let redirects = 0; store.onAuthorize = () => { redirects++; };
  const server = fakeServer(); const client = new NinjaTraderReadOnlyClient({ oauthProvider: store, fetchImpl: async (input, init) => {
    if (init?.method === 'POST' && String(input) === endpoint && JSON.parse(init.body).method === 'tools/call' && !rejected) {
      rejected = true; return new Response('', { status: 401 });
    }
    return server.fetchImpl(input, init);
  } });
  t.after(async () => { await client.close(); store.close(); });
  await assert.rejects(client.callTool('market_snapshot', { symbols: ['MESZ6'] }), /SESSION_RECONNECT_REQUIRED/);
  assert.equal(redirects, 0); await client.resetConnection();
  await client.callTool('market_snapshot', { symbols: ['MESZ6'] });
  assert.equal(store.tokens().access_token, 'ROTATED_ACCESS'); assert.equal(redirects, 0);
  assert.equal(server.requests.filter(row => row.url.endsWith('/auth/oauthtoken')).length, 1);
});

test('a failed save after rotation fails closed and does not retry the now-consumed old refresh token', async t => {
  const f = refreshFixture(t); const before = f.saved(); f.store.saveTokens = () => { throw new Error('PRIVATE_PATH'); };
  await assert.rejects(f.client.refreshAuthorization(), /^Error: NINJATRADER_AUTH_STORE_WRITE_FAILED$/);
  await assert.rejects(f.client.refreshAuthorization(), /AUTH_STORE_WRITE_FAILED/);
  assert.equal(f.saved(), before); assert.equal(f.counts().tokenCalls, 1); assert.equal(f.counts().redirects, 0);
});
