import http from 'node:http';
import crypto from 'node:crypto';
import { monitorError } from './ninjatrader-monitor-state.mjs';

export function ninjaProfileHash(config) {
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  return crypto.createHash('sha256').update(JSON.stringify(stable(config))).digest('hex');
}
export function createNinjaTraderMonitorApi({ monitor, marketDataProvider = null, config = null, port = 8789, allowedOrigin = null } = {}) {
  if (!monitor || typeof monitor.snapshot !== 'function' || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error('NINJATRADER_MONITOR_API_CONFIG_INVALID');
  if (allowedOrigin) {
    const origin = new URL(allowedOrigin);
    if (!['http:', 'https:'].includes(origin.protocol) || !['127.0.0.1', 'localhost'].includes(origin.hostname) || origin.origin !== allowedOrigin) throw new Error('NINJATRADER_MONITOR_ORIGIN_INVALID');
  }
  let activeReads = 0;
  const server = http.createServer(async (request, response) => {
    const boundPort = server.address()?.port;
    const ownOrigin = `http://127.0.0.1:${boundPort}`;
    const origin = request.headers.origin;
    const send = (status, value) => { response.writeHead(status); response.end(JSON.stringify(value)); };
    response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Vary', 'Origin');
    if (request.headers.host !== `127.0.0.1:${boundPort}` && request.headers.host !== `localhost:${boundPort}`) return send(403, { error: 'NINJATRADER_MONITOR_HOST_REJECTED' });
    if (origin && origin !== ownOrigin && origin !== `http://localhost:${boundPort}` && origin !== allowedOrigin) return send(403, { error: 'NINJATRADER_MONITOR_ORIGIN_REJECTED' });
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') { response.setHeader('Access-Control-Allow-Methods', 'GET'); return send(204, null); }
    if (request.method !== 'GET') return send(405, { error: 'NINJATRADER_MONITOR_READ_ONLY' });
    if (!request.url || request.url.length > 4096) return send(400, { error: 'NINJATRADER_MONITOR_REQUEST_INVALID' });
    const url = new URL(request.url, ownOrigin);
    if (url.pathname === '/health') {
      const state = monitor.snapshot(); return send(state.stale ? 503 : 200, { source: state.source, environment: state.environment,
        status: state.status, stale: state.stale, lastSuccessfulAt: state.lastSuccessfulAt, lastError: state.lastError,
        readOnly: true, executionEnabled: false, marketDataProxyAvailable: Boolean(marketDataProvider) });
    }
    if (url.pathname === '/api/state') return send(200, monitor.snapshot());
    const kind = { '/api/market-data/quote': 'quote', '/api/market-data/minute': 'minute', '/api/market-data/daily': 'daily' }[url.pathname];
    if (!kind) return send(404, { error: 'not found' });
    if (!marketDataProvider || !config) return send(503, { error: 'NINJATRADER_MONITOR_MARKET_CONFIG_REQUIRED' });
    if (activeReads >= 4) return send(429, { error: 'NINJATRADER_MONITOR_BUSY' });
    activeReads++;
    try {
      const symbol = url.searchParams.get('symbol');
      const permitted = kind === 'quote' ? ['symbol'] : kind === 'minute' ? ['symbol', 'startDate', 'endDate', 'extendedHours']
        : ['symbol', 'startDate', 'endDate', 'periodType', 'period'];
      if ([...url.searchParams.keys()].some(key => !permitted.includes(key) || url.searchParams.getAll(key).length !== 1)) throw new Error('NINJATRADER_MONITOR_REQUEST_INVALID');
      let data;
      if (kind === 'quote') data = await marketDataProvider.getQuote(symbol);
      else {
        const options = {};
        for (const key of ['startDate', 'endDate']) if (url.searchParams.has(key)) options[key] = url.searchParams.get(key);
        if (kind === 'minute') {
          const extended = url.searchParams.get('extendedHours');
          if (extended !== null && !['true', 'false'].includes(extended)) throw new Error('NINJATRADER_SESSION_INVALID');
          options.extendedHours = extended !== 'false'; data = await marketDataProvider.getMinuteBars(symbol, options);
        } else {
          if (url.searchParams.has('period')) options.period = Number(url.searchParams.get('period'));
          if (url.searchParams.has('periodType')) options.periodType = url.searchParams.get('periodType');
          data = await marketDataProvider.getDailyBars(symbol, options);
        }
      }
      return send(200, { schema: 'executionos.ninjatrader.marketdata.v1', environment: config.environment,
        profileHash: ninjaProfileHash(config), kind, data, readOnly: true, executionEnabled: false });
    } catch (error) { return send(502, { error: monitorError(error) }); }
    finally { activeReads--; }
  });
  return { server, async start() {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    return `http://127.0.0.1:${server.address().port}`;
  }, async stop() { server.closeIdleConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); } };
}
