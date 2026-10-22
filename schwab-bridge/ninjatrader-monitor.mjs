import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { NinjaTraderOAuthStore, NinjaTraderReadOnlyClient } from './ninjatrader-mcp-client.mjs';
import { NinjaTraderMarketDataProvider } from './ninjatrader-market-data-provider.mjs';
import { NinjaTraderMonitor, monitorError } from './ninjatrader-monitor-state.mjs';
import { createNinjaTraderMonitorApi } from './ninjatrader-monitor-api.mjs';
import { createNinjaTraderActionLogger, formatNinjaTraderActionFill } from './ninjatrader-action-log.mjs';

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
  return formatNinjaTraderActionFill(fill, timeZone);
}
function startupRoundTripFields(summary, timeZone = 'America/Denver') {
  if (!summary || summary.status !== 'AVAILABLE') {
    const reason = summary?.reason === 'AMBIGUOUS_FILL_SEQUENCE' ? 'Unavailable: ambiguous fill sequence'
      : summary?.reason === 'POSITION_AND_FILL_TIMING_OVERLAP' ? 'Unavailable: fills overlap the position snapshot'
      : summary?.status === 'UNAVAILABLE' ? 'Unavailable: incomplete entry history' : 'No complete trade found in recent history';
    return [['Last trade', reason]];
  }
  const trade = summary.trade;
  const dateTime = value => new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour12: false,
    hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZoneName: 'short' }).format(new Date(value));
  const points = new Intl.NumberFormat('en-US', { maximumFractionDigits: 8, signDisplay: 'exceptZero' }).format(trade.grossPointsPerContract);
  const pnl = summary.pnl;
  const unavailableNet = pnl?.reason === 'FEES_NOT_ATTRIBUTABLE_TO_SINGLE_TRADE' ? 'Unavailable: fees not linked to this trade'
    : pnl?.reason === 'COMMISSION_NOT_ASSESSED' || pnl?.reason === 'FEE_COMPONENTS_INCOMPLETE' ? 'Unavailable: fees not fully assessed'
    : pnl?.reason === 'CASH_HISTORY_UNAVAILABLE' ? 'Unavailable: broker fee history unavailable' : 'Unavailable: fee/contract data unverified';
  const cashFields = pnl?.status === 'AVAILABLE' ? [['Gross P/L', money(pnl.grossPnl, pnl.currency)], ['Fees & comm.', money(pnl.fees, pnl.currency)],
    ['Net P/L', money(pnl.netPnl, pnl.currency)], ['P/L basis', 'Reconstructed from isolated posted ledger charges']]
    : [['Net P/L', unavailableNet]];
  return [['Last trade', `${trade.symbol} · ${trade.direction} (reconstructed)`], ['Closed qty', `${trade.quantity} contract(s) · peak ${trade.peakQuantity}`],
    ['Entry avg', priceText(trade.entryAverage)], ['Opened', dateTime(trade.openedAt)], ['Exit avg', priceText(trade.exitAverage)], ['Closed', dateTime(trade.closedAt)],
    ['Gross move', `${points} points/contract; before fees`], ...cashFields, ['History window', `${summary.startDate} through ${summary.endDate} (UTC request dates)`]];
}
function snapshotLogRows(state, { timeZone = 'America/Denver' } = {}) {
  const rows = [];
  const add = (key, line, removal = null) => rows.push({ key, line, removal });
  const unknownOrders = state.accounts.filter(account => account.workingOrdersStatus !== 'CURRENT').length;
  const unconfirmedCount = (state.unconfirmedOrders || []).length;
  const orderSummary = unconfirmedCount ? `${state.workingOrders.filter(order => !order.stale).length} current; ${unconfirmedCount} status unconfirmed` : unknownOrders ? `unavailable for ${unknownOrders} account(s)` : state.workingOrders.filter(order => !order.stale).length;
  add('status', block('NINJATRADER MONITOR STATUS', [
    ['Environment', state.environment.toUpperCase()], ['Status', state.status], ['Accounts', state.accounts.length],
    ['Open positions', state.positions.length], ['Working orders', orderSummary], ['Snapshot', state.stale ? 'STALE' : (unknownOrders || unconfirmedCount) ? 'current; orders unconfirmed' : 'current'],
  ]));
  for (const account of state.accounts) add(JSON.stringify(['account', account.accountId]),
    block('NINJATRADER ACCOUNT SNAPSHOT', [['Account', account.accountDisplay], ['Current equity', money(account.netLiquidation, account.currency)],
      ['Open P&L', money(account.openPnl, account.currency)], ['Order snapshot', account.workingOrdersStatus === 'CURRENT' ? 'current' : 'unavailable']]),
    block('ACCOUNT NO LONGER REPORTED', [['Account', account.accountDisplay]]));
  for (const position of state.positions) add(JSON.stringify(['position', position.accountId, position.symbol]),
    block('NINJATRADER POSITION', [['Account', position.accountDisplay], ['Symbol', position.symbol], ['Position', `${position.side} ${Math.abs(position.quantity)}`],
      ['Position avg', priceText(position.averagePrice)], ['Mark price', priceText(position.currentPrice)], ['Data feed', position.dataFeedMode || 'timeliness unknown']]),
    current => current.status === 'OBSERVING' && current.stale === false && current.accounts.some(account => account.accountId === position.accountId)
      ? block('NINJATRADER POSITION FLAT', [['Account', position.accountDisplay], ['Symbol', position.symbol], ['Position', 'FLAT'], ['Confirmation', 'Broker position snapshot']])
      : block('POSITION NO LONGER REPORTED', [['Account', position.accountDisplay], ['Symbol', position.symbol]]));
  for (const order of [...state.workingOrders, ...(state.unconfirmedOrders || [])]) {
    const unconfirmed = order.stale || state.stale;
    add(JSON.stringify(['order', order.accountId, order.orderId]),
      block(unconfirmed ? 'NINJATRADER ORDER — STATUS UNCONFIRMED' : 'NINJATRADER WORKING ORDER', [
        ['Account', order.accountDisplay], ['Symbol', order.symbol], ['Instruction', order.action], ['Quantity', order.quantity],
        ['Order type', order.orderType], ['Stop price', priceText(order.stopPrice)],
        ['Limit price', order.limitPrice == null && ['Stop', 'Market', 'MIT', 'TrailingStop'].includes(order.orderType) ? 'Not applicable' : priceText(order.limitPrice)],
        ['Order status', unconfirmed ? 'Unconfirmed' : order.status],
        ...(unconfirmed ? [['Last status', order.status], ['Last observed', displayTime(order.observedAt, timeZone)]] : []),
        ['Time in force', order.timeInForce], ['Order ID', order.orderId],
      ]), block('WORKING ORDER NO LONGER REPORTED', [['Account', order.accountDisplay], ['Symbol', order.symbol], ['Order ID', order.orderId]]));
  }
  for (const event of state.orderEvents || []) {
    if (state.workingOrders.some(order => order.accountId === event.accountId && order.orderId === event.orderId)) continue;
    const position = event.positionQuantity === 0 ? 'FLAT' : event.positionQuantity > 0 ? `LONG ${event.positionQuantity}` : event.positionQuantity < 0 ? `SHORT ${Math.abs(event.positionQuantity)}` : 'unconfirmed';
    add(JSON.stringify(['order', event.accountId, event.orderId]), block(`NINJATRADER ORDER ${event.status.toUpperCase()}`, [
      ['Account', event.accountDisplay], ['Symbol', event.symbol], ['Instruction', event.action], ['Quantity', event.quantity],
      ['Order type', event.orderType], ['Stop price', priceText(event.stopPrice)],
      ['Limit price', event.limitPrice == null && ['Stop', 'Market', 'MIT', 'TrailingStop'].includes(event.orderType) ? 'Not applicable' : priceText(event.limitPrice)],
      ['Order ID', event.orderId], ['Order status', event.status], ['Filled quantity', event.filledQuantity],
      ...(event.parentOrderId != null ? [['Parent order', event.parentOrderId]] : []),
      ...(event.ocoOrderId != null ? [['OCO order', event.ocoOrderId]] : []),
      ['Position', position], ['Confirmation', 'Broker order record'], ['Observed', displayTime(event.observedAt, timeZone)],
      ...(event.orderDetailsSource === 'LAST_OBSERVED_WORKING_ORDER' ? [['Details source', 'Last observed working order'], ['Details as of', displayTime(event.orderDetailsObservedAt, timeZone)]] : []),
    ]));
  }
  return rows;
}
export function logSnapshot(state, log, options) { for (const row of snapshotLogRows(state, options)) log(row.line); }
export function createMonitorChangeLogger(log, options) {
  let previous = new Map();
  return state => {
    const next = new Map(snapshotLogRows(state, options).map(row => [row.key, row]));
    for (const [key, row] of next) if (previous.get(key)?.line !== row.line) log(row.line);
    for (const [key, row] of previous) if (!next.has(key) && row.removal) log(typeof row.removal === 'function' ? row.removal(state) : row.removal);
    previous = next;
  };
}
export async function runNinjaTraderMonitor({ settings, client, signal, log = console.log, createApi = createNinjaTraderMonitorApi, wait = pause, now = Date.now } = {}) {
  const logActions = createNinjaTraderActionLogger(log, { timeZone: settings.timeZone });
  const monitor = new NinjaTraderMonitor({ client, environment: settings.environment, pollMs: settings.pollMs, now,
    accountSelectors: settings.accountSelectors, onFill: logActions.fill });
  if (settings.check || settings.refreshCheck) {
    if (settings.refreshCheck) await client.refreshAuthorization();
    const tools = await client.toolCatalog();
    const available = ['my_portfolio', 'fill_history'].every(name => tools.some(tool => tool.name === name));
    if (!available) throw new Error('NINJATRADER_MONITOR_READ_PERMISSIONS_REQUIRED');
    if (settings.refreshCheck) log('✓ NinjaTrader token refresh verified; rotated credentials saved privately without browser sign-in.');
    log('Required read-only portfolio/fill tools are available. Account-list read permission is checked at monitor startup.'); return;
  }
  let api, wakeWait = null, pendingUpdate = false;
  const onUpdate = () => { if (!pendingUpdate) { pendingUpdate = true; wakeWait?.abort(); } };
  try {
    await monitor.initialize();
    const initial = monitor.snapshot();
    log(`NINJATRADER ${settings.environment.toUpperCase()} | OBSERVING · read-only | ${initial.accounts.length} account(s), ${initial.positions.length} open position(s), ${initial.workingOrders.filter(order => !order.stale).length} working order(s) | ${initial.baselineFillCount} prior fill(s) suppressed | poll ${settings.pollMs} ms | ${settings.timeZone}`);
    for (const account of initial.accounts) log(block('NINJATRADER ACCOUNT SUMMARY (STARTUP)', [
      ['Account', account.accountDisplay], ['Current equity', money(account.netLiquidation, account.currency)],
      ['Cash balance', money(account.cashBalance, account.currency)], ['Open P&L', money(account.openPnl, account.currency)],
      ...startupRoundTripFields(initial.startupRoundTrips.find(summary => summary.accountId === account.accountId), settings.timeZone),
    ]));
    logActions(initial);
    if (settings.once || signal?.aborted) return monitor.snapshot();
    const marketDataProvider = settings.marketConfig ? new NinjaTraderMarketDataProvider({ client, config: settings.marketConfig }) : null;
    api = createApi({ monitor, marketDataProvider, config: settings.marketConfig, port: settings.port, allowedOrigin: settings.allowedOrigin });
    const origin = await api.start();
    log(`✓ Local UI API: ${origin}/api/state (read-only, loopback only)`);
    log(`✓ Market-data relay: ${marketDataProvider ? 'available; use EXECUTIONOS_NINJATRADER_MONITOR_URL=' + origin : 'not configured'}`);
    log('Press Ctrl+C to stop.');
    let subscribed = false;
    try { subscribed = await client.watchAccountUpdates?.(onUpdate) || false; } catch { /* Preserve polling if setup is unavailable. */ }
    log(subscribed ? '✓ Order/position push subscriptions accepted; polling remains enabled' : '✓ Order/position push unavailable; using polling');
    let failures = 0, lastErrorCode = null, nextRegularRead = now() + settings.pollMs, nextFastRead = now() + 1000, retryAt = 0;
    while (!signal?.aborted) {
      const due = Math.min(nextRegularRead, pendingUpdate ? Math.max(nextFastRead, retryAt) : Infinity);
      const delay = Math.max(0, due - now());
      if (delay > 0) {
        wakeWait = new AbortController();
        try { await wait(delay, undefined, { signal: signal ? AbortSignal.any([signal, wakeWait.signal]) : wakeWait.signal }); }
        catch (error) { if (!signal?.aborted && !wakeWait.signal.aborted) throw error; }
        finally { wakeWait = null; }
      }
      if (signal?.aborted) break;
      const started = now(), regular = started >= nextRegularRead;
      if (!regular && !(pendingUpdate && started >= nextFastRead && started >= retryAt)) continue;
      pendingUpdate = false; nextFastRead = started + 5000;
      try {
        // Push refreshes skip fill history; they cannot consume its per-minute
        // budget or postpone the separately scheduled regular fill poll.
        await monitor.poll({ readFills: regular || failures > 0 });
        logActions(monitor.snapshot());
        if (failures) log('NINJATRADER MONITOR RECOVERED | observations current');
        failures = 0; lastErrorCode = null; retryAt = 0;
        if (regular) nextRegularRead = started + settings.pollMs;
      } catch (error) {
        failures++;
        const code = monitorError(error);
        const backoff = /RATE_LIMIT|TOOL_ERROR/.test(code) ? 60000 : Math.min(60000, settings.pollMs * 2 ** Math.min(failures, 5));
        retryAt = now() + backoff; nextRegularRead = retryAt;
        if (code !== lastErrorCode) log(`NINJATRADER MONITOR WARNING | ${code} | observations stale | retry in ${backoff / 1000}s`);
        lastErrorCode = code;
        if (/TOOL_REQUEST_FAILED|CONNECT_FAILED|SESSION_RECONNECT_REQUIRED/.test(code)) await client.resetConnection?.();
      }
    }
    return monitor.snapshot();
  } finally { client.stopAccountUpdates?.(); wakeWait?.abort(); monitor.stop(); await api?.stop(); }
}

export function createNinjaTraderAuthLogger(log = console.log, timeZone = 'America/Denver') {
  let lastFailure = null;
  return event => {
    if (event.stage === 'STARTED') return;
    const key = JSON.stringify([event.outcomeCode, event.httpStatus, event.oauthError, event.serverHint]);
    if (event.stage === 'FAILED' && key === lastFailure) return;
    lastFailure = event.stage === 'FAILED' ? key : null;
    const details = event.stage === 'SUCCEEDED'
      ? `token rotated: ${event.rotated ? 'yes' : 'no replacement returned'} | access expires: ${displayTime(event.accessExpiresAt, timeZone)}`
      : `OAuth error: ${event.oauthError ?? '—'} | Server hint: ${event.serverHint ?? '—'} | result: ${event.outcomeCode}`;
    log(`${displayTime(event.at, timeZone)} | NINJATRADER TOKEN RENEWAL ${event.stage} | ${event.trigger} | HTTP ${event.httpStatus ?? '—'} | ${details}`);
  };
}
export async function main(args = process.argv.slice(2), env = process.env) {
  const settings = monitorConfig(env, args), controller = new AbortController();
  const stop = () => controller.abort();
  const store = new NinjaTraderOAuthStore({ directory: settings.directory, environment: settings.environment });
  const client = new NinjaTraderReadOnlyClient({ environment: settings.environment, oauthProvider: store, accountObservation: true, onAuthEvent: createNinjaTraderAuthLogger(console.log, settings.timeZone) });
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
