import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { NinjaTraderOAuthStore, NinjaTraderReadOnlyClient, endpointFor } from './ninjatrader-mcp-client.mjs';
import { NinjaTraderMarketDataProvider } from './ninjatrader-market-data-provider.mjs';
import { assessQuoteEvidence, CURRENT_LIVE_QUOTE_EVIDENCE_POLICY } from './market-data-provider.mjs';

export function validateOAuthCallback(rawUrl, expectedState) {
  const url = new URL(rawUrl, 'http://127.0.0.1:8791');
  if (url.pathname !== '/callback' || url.searchParams.get('state') !== expectedState
      || url.searchParams.has('error') || !url.searchParams.get('code')
      || url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('code').length !== 1) throw new Error('NINJATRADER_OAUTH_CALLBACK_REJECTED');
  return url.searchParams.get('code');
}

async function authorize(store, client, monitorMode = false) {
  // Explicit auth always starts a fresh consent flow. Existing tokens stay on
  // disk until successful replacement, including if authorization is cancelled.
  store.tokens = () => undefined;
  let resolveCode, rejectCode;
  const receivedCode = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.headers.host !== '127.0.0.1:8791') { response.writeHead(400).end('Invalid callback'); return; }
    try {
      const code = validateOAuthCallback(request.url, store.state());
      response.setHeader('Content-Type', 'text/plain'); response.setHeader('Cache-Control', 'no-store');
      response.end('NinjaTrader authorization received. Return to ExecutionOS.'); resolveCode(code);
    } catch { response.writeHead(400).end('Invalid callback'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8791, '127.0.0.1', resolve); });
  const timeout = setTimeout(() => rejectCode(new Error('NINJATRADER_AUTHORIZATION_TIMED_OUT')), 180000);
  // Avoid an unhandled rejection while discovery is in flight.
  receivedCode.catch(() => {});
  try {
    const result = await auth(store, { serverUrl: store.endpoint, fetchFn: client.fetch });
    if (result !== 'REDIRECT') throw new Error('NINJATRADER_AUTHORIZATION_FLOW_INVALID');
    const code = await receivedCode;
    await auth(store, { serverUrl: store.endpoint, authorizationCode: code, fetchFn: client.fetch });
    console.log(monitorMode
      ? 'NinjaTrader OAuth saved privately. Monitor needs Accounting:Read, Positions:Read, Orders:Read, Prices:Read and ContractLibrary:Read; no FullAccess permissions.'
      : 'NinjaTrader OAuth saved privately. Consent must grant only Prices:Read and ContractLibrary:Read.');
  } finally { clearTimeout(timeout); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  const [command, ...values] = args;
  if (!['auth', 'discover', 'describe', 'search', 'snapshot', 'probe'].includes(command)) throw new Error('Usage: ninjatrader-read-only.mjs auth|discover|describe TOPIC|search TEXT|snapshot CONTRACT|probe SYMBOL');
  const monitorMode = command === 'auth' && values.includes('--monitor');
  if (command === 'auth' && (values.length > 1 || values.some(value => value !== '--monitor'))) throw new Error('NINJATRADER_AUTH_ARGUMENT_INVALID');
  const environment = env.EXECUTIONOS_NINJATRADER_ENV || 'demo';
  endpointFor(environment);
  const store = new NinjaTraderOAuthStore({ directory: env.EXECUTIONOS_NINJATRADER_AUTH_DIR, environment,
    onAuthorize: command === 'auth' ? url => console.log(`Open in your desktop browser and approve ${monitorMode ? 'View Account, View Positions, View Orders, Market Data and View Contracts only; keep every Trade/Manage permission off' : 'market-data read access only'}:\n${url}`) : undefined });
  const client = new NinjaTraderReadOnlyClient({ environment, oauthProvider: store });
  try {
    if (command === 'auth') return await authorize(store, client, monitorMode);
    let result;
    if (command === 'discover') result = { environment, endpoint: store.endpoint, tools: await client.toolCatalog() };
    if (command === 'describe') result = await client.callTool('describe', { topic: values[0] || 'index' });
    if (command === 'search') result = await client.callTool('search_contracts', { text: values.join(' ') });
    if (command === 'snapshot') result = await client.callTool('market_snapshot', { symbols: [values[0]] });
    if (command === 'probe') {
      if (!env.EXECUTIONOS_NINJATRADER_CONFIG || !path.isAbsolute(env.EXECUTIONOS_NINJATRADER_CONFIG)) throw new Error('NINJATRADER_CONFIG_PATH_MUST_BE_ABSOLUTE');
      const config = JSON.parse(fs.readFileSync(env.EXECUTIONOS_NINJATRADER_CONFIG, 'utf8'));
      if (config.environment !== environment) throw new Error('NINJATRADER_ENVIRONMENT_MISMATCH');
      const provider = new NinjaTraderMarketDataProvider({ client, config });
      const quote = await provider.getQuote(values[0]);
      const evidence = assessQuoteEvidence(quote, { nowMs: Date.now(), ...CURRENT_LIVE_QUOTE_EVIDENCE_POLICY });
      const endDate = Math.floor(Date.now() / 60000) * 60000;
      const minuteBars = await provider.getMinuteBars(values[0], { startDate: endDate - 3600000, endDate });
      const dailyBars = await provider.getDailyBars(values[0]);
      result = { environment, quote, quoteEvidence: evidence, minuteBarCount: minuteBars.length,
        firstMinute: minuteBars[0]?.time, lastMinute: minuteBars.at(-1)?.time, dailyBarCount: dailyBars.length,
        executionEnabled: false, liveIntegrationVerified: false };
      if (!evidence.valid || !minuteBars.length || !dailyBars.length) process.exitCode = 2;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { await client.close(); store.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Vendor/SDK errors can contain sensitive response bodies or tokens.
  const code = /^NINJATRADER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'NINJATRADER_COMMAND_FAILED';
  console.error(code); process.exitCode = 1;
});
