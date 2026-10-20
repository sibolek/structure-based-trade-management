import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { NinjaTraderOAuthStore, NinjaTraderReadOnlyClient } from './ninjatrader-mcp-client.mjs';
import { NinjaTraderMarketDataProvider } from './ninjatrader-market-data-provider.mjs';
import { NinjaTraderMonitor, monitorError } from './ninjatrader-monitor-state.mjs';
import { createNinjaTraderMonitorApi } from './ninjatrader-monitor-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function monitorConfig(env = process.env, args = process.argv.slice(2)) {
  if (args.some(value => !['--once', '--check', '--refresh-check'].includes(value)) || args.length > 1) throw new Error('NINJATRADER_MONITOR_ARGUMENT_INVALID');
  const environment = env.EXECUTIONOS_NINJATRADER_ENV || 'demo';
  if (!['demo', 'live'].includes(environment)) throw new Error('NINJATRADER_ENVIRONMENT_INVALID');
  const pollMs = Number(env.EXECUTIONOS_NINJATRADER_POLL_MS || 5000), port = Number(env.EXECUTIONOS_NINJATRADER_MONITOR_PORT || 8789);
  const timeZone = env.EXECUTIONOS_NINJATRADER_TIME_ZONE || 'America/Denver';
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); } catch { throw new Error('NINJATRADER_MONITOR_TIME_ZONE_INVALID'); }
  if (!Number.isFinite(pollMs) || pollMs < 2000 || pollMs > 60000 || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('NINJATRADER_MONITOR_CONFIG_INVALID');
  const configPath = env.EXECUTIONOS_NINJATRADER_CONFIG || (environment === 'live' ? path.join(ROOT, 'docs/ninjatrader-market-data.live-verified.json') : null);
  const marketConfig = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
  if (marketConfig && marketConfig.environment !== environment) throw new Error('NINJATRADER_ENVIRONMENT_MISMATCH');
  return { environment, pollMs, port, timeZone, marketConfig,
    directory: env.EXECUTIONOS_NINJATRADER_AUTH_DIR || path.join(ROOT, '.executionos-ninjatrader-auth'),
    accountSelectors: (env.EXECUTIONOS_NINJATRADER_MONITOR_ACCOUNTS || '').split(',').map(item => item.trim()).filter(Boolean),
    allowedOrigin: env.EXECUTIONOS_NINJATRADER_MONITOR_ORIGIN || null, once: args.includes('--once'), check: args.includes('--check'), refreshCheck: args.includes('--refresh-check') };
}
const RULE = '----------------------------------------';
const priceText = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
function money(value, currency) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  if (!/^[A-Z]{3}$/.test(currency || '')) return `${priceText(value)} (currency unavailable)`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function block(title, fields) {
  return ['\n' + title, RULE, ...fields.map(([label, value]) => `${(label + ':').padEnd(16)}${value ?? '—'}`), RULE].join('\n');
}
function displayTime(value, timeZone) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'short' }).format(new Date(value));
}
export function formatNinjaTraderFill(fill, timeZone = 'America/Denver') {
  const executionMs = Date.parse(fill.executionTime || ''), detectedMs = Date.parse(fill.detectedAt || '');
  const latencyMs = detectedMs - executionMs;
  const delay = !Number.isFinite(latencyMs) ? 'unavailable' : `${latencyMs} ms${latencyMs < 0 ? ' (local/API clock skew)' : ''}`;
  return block('NEW NINJATRADER EXECUTION', [
    ['Account', fill.accountDisplay], ['Environment', fill.environment?.toUpperCase()], ['Symbol', fill.symbol],
    ['Instruction', fill.action], ['Quantity', fill.quantity], ['Fill price', priceText(fill.price)],
    ['Order ID', fill.orderId], ['Fill ID', fill.fillId], ['Broker fill', displayTime(fill.executionTime, timeZone)],
    ['Detected', displayTime(fill.detectedAt, timeZone)], ['Observed delay', delay],
  ]);
}
function snapshotLogRows(state) {
  const rows = [];
  const add = (key, line, removal = null) => rows.push({ key, line, removal });
  const unknownOrders = state.accounts.filter(account => account.workingOrdersStatus !== 'CURRENT').length;
  const orderSummary = unknownOrders ? `unavailable for ${unknownOrders} account(s)` : state.workingOrders.filter(order => !order.stale).length;
  add('status', block('NINJATRADER MONITOR STATUS', [
    ['Environment', state.environment.toUpperCase()], ['Status', state.status], ['Accounts', state.accounts.length],
    ['Open positions', state.positions.length], ['Working orders', orderSummary], ['Snapshot', state.stale ? 'STALE' : 'current'],
  ]));
  for (const account of state.accounts) add(JSON.stringify(['account', account.accountId]),
    block('NINJATRADER ACCOUNT SNAPSHOT', [['Account', account.accountDisplay], ['Current equity', money(account.netLiquidation, account.currency)],
      ['Open P&L', money(account.openPnl, account.currency)], ['Order snapshot', account.workingOrdersStatus === 'CURRENT' ? 'current' : 'unavailable']]),
    block('ACCOUNT NO LONGER REPORTED', [['Account', account.accountDisplay]]));
  for (const position of state.positions) add(JSON.stringify(['position', position.accountId, position.symbol]),
    block('NINJATRADER POSITION', [['Account', position.accountDisplay], ['Symbol', position.symbol], ['Position', `${position.side} ${Math.abs(position.quantity)}`],
      ['Position avg', priceText(position.averagePrice)], ['Mark price', priceText(position.currentPrice)], ['Data feed', position.dataFeedMode || 'timeliness unknown']]),
    block('POSITION NO LONGER REPORTED', [['Account', position.accountDisplay], ['Symbol', position.symbol]]));
  for (const order of state.workingOrders) add(JSON.stringify(['order', order.accountId, order.orderId]),
    block(`NINJATRADER WORKING ORDER${order.stale || state.stale ? ' (STALE)' : ''}`, [
      ['Account', order.accountDisplay], ['Symbol', order.symbol], ['Instruction', order.action], ['Quantity', order.quantity],
      ['Order type', order.orderType], ['Stop price', priceText(order.stopPrice)],
      ['Limit price', order.limitPrice == null && ['Stop', 'Market', 'MIT', 'TrailingStop'].includes(order.orderType) ? 'Not applicable' : priceText(order.limitPrice)],
      ['Order status', order.status], ['Time in force', order.timeInForce], ['Order ID', order.orderId],
    ]), block('WORKING ORDER NO LONGER REPORTED', [['Account', order.accountDisplay], ['Symbol', order.symbol], ['Order ID', order.orderId]]));
  return rows;
}
export function logSnapshot(state, log) { for (const row of snapshotLogRows(state)) log(row.line); }
export function createMonitorChangeLogger(log) {
  let previous = new Map();
  return state => {
    const next = new Map(snapshotLogRows(state).map(row => [row.key, row]));
    for (const [key, row] of next) if (previous.get(key)?.line !== row.line) log(row.line);
    for (const [key, row] of previous) if (!next.has(key) && row.removal) log(row.removal);
    previous = next;
  };
}
export async function runNinjaTraderMonitor({ settings, client, signal, log = console.log, createApi = createNinjaTraderMonitorApi, wait = pause, now = Date.now } = {}) {
  const monitor = new NinjaTraderMonitor({ client, environment: settings.environment, pollMs: settings.pollMs,
    accountSelectors: settings.accountSelectors, onFill: fill => log(formatNinjaTraderFill(fill, settings.timeZone)) });
  if (settings.check || settings.refreshCheck) {
    if (settings.refreshCheck) await client.refreshAuthorization();
    const tools = await client.toolCatalog();
    const available = ['my_portfolio', 'fill_history'].every(name => tools.some(tool => tool.name === name));
    if (!available) throw new Error('NINJATRADER_MONITOR_READ_PERMISSIONS_REQUIRED');
    if (settings.refreshCheck) log('✓ NinjaTrader token refresh verified; rotated credentials saved privately without browser sign-in.');
    log('Required read-only portfolio/fill tools are available. Account-list read permission is checked at monitor startup.'); return;
  }
  const logChanges = createMonitorChangeLogger(log);
  let api;
  try {
    await monitor.initialize();
    const initial = monitor.snapshot();
    log('\nEXECUTIONOS / NINJATRADER FILL MONITOR\n');
    log(`✓ NinjaTrader authenticated (${settings.environment.toUpperCase()})`);
    log(`✓ ${initial.accounts.length} authorized account(s)`);
    log(`✓ Poll interval: ${settings.pollMs} ms`);
    log('✓ Read-only: this monitor does not place, replace, or cancel orders');
    log(`✓ Console time zone: ${settings.timeZone}`);
    logChanges(initial);
    log(`✓ Baseline complete (${initial.baselineFillCount} existing fill(s) ignored)`);
    log('✓ MONITOR OBSERVING — new NinjaTrader execution fills will print below');
    if (settings.once || signal?.aborted) return monitor.snapshot();
    const marketDataProvider = settings.marketConfig ? new NinjaTraderMarketDataProvider({ client, config: settings.marketConfig }) : null;
    api = createApi({ monitor, marketDataProvider, config: settings.marketConfig, port: settings.port, allowedOrigin: settings.allowedOrigin });
    const origin = await api.start();
    log(`✓ Local UI API: ${origin}/api/state (read-only, loopback only)`);
    log(`✓ Market-data relay: ${marketDataProvider ? 'available; use EXECUTIONOS_NINJATRADER_MONITOR_URL=' + origin : 'not configured'}`);
    log('Press Ctrl+C to stop.\n');
    let failures = 0, delay = settings.pollMs, lastErrorCode = null;
    while (!signal?.aborted) {
      try { await wait(delay, undefined, { signal }); } catch (error) { if (signal?.aborted) break; throw error; }
      if (signal?.aborted) break;
      const started = now();
      try {
        await monitor.poll();
        logChanges(monitor.snapshot());
        failures = 0; lastErrorCode = null;
        delay = Math.max(0, settings.pollMs - (now() - started));
      } catch (error) {
        failures++;
        const code = monitorError(error);
        delay = /RATE_LIMIT|TOOL_ERROR/.test(code) ? 60000 : Math.min(60000, settings.pollMs * 2 ** Math.min(failures, 5));
        logChanges(monitor.snapshot());
        if (code !== lastErrorCode) log(`\n⚠ Monitor poll failed: ${code}\nPrevious observations marked stale. Retrying in ${delay} ms...\n`);
        lastErrorCode = code;
        if (/TOOL_REQUEST_FAILED|CONNECT_FAILED|SESSION_RECONNECT_REQUIRED/.test(code)) await client.resetConnection?.();
      }
    }
    return monitor.snapshot();
  } finally { monitor.stop(); await api?.stop(); }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const settings = monitorConfig(env, args), controller = new AbortController();
  const stop = () => controller.abort();
  const store = new NinjaTraderOAuthStore({ directory: settings.directory, environment: settings.environment });
  const client = new NinjaTraderReadOnlyClient({ environment: settings.environment, oauthProvider: store, accountObservation: true });
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const event of signals) process.on(event, stop);
  const release = () => store.close(); process.once('exit', release);
  try { return await runNinjaTraderMonitor({ settings, client, signal: controller.signal }); }
  finally {
    for (const event of signals) process.removeListener(event, stop); process.removeListener('exit', release);
    try { await client.close(); } finally { store.close(); }
  }
}
export function monitorFailureHint(error) {
  const code = monitorError(error);
  if (/TOKEN_REFRESH_TEMPORARILY_UNAVAILABLE/.test(code)) return 'Token refresh is temporarily unavailable; saved credentials are preserved. Retry the monitor without running browser authorization.';
  if (/REAUTHORIZE_REQUIRED|AUTHORIZATION_REQUIRED/.test(code)) return 'Browser authorization is required: run npm run ninjascript:auth with the existing read-only permissions, then restart the monitor.';
  if (/READ_PERMISSIONS|CHECK_READ_PERMISSIONS/.test(code)) return 'Read access is missing. Run npm run ninjascript:auth and grant View Account, View Positions, View Orders, Market Data and View Contracts only. Keep all trading/manage permissions off.';
  return null;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(monitorError(error));
  const hint = monitorFailureHint(error); if (hint) console.error(hint);
  process.exitCode = 1;
});
