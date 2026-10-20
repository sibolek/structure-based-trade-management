import fs from 'node:fs';
import path from 'node:path';
import { SchwabMarketDataProvider } from './schwab-market-data-provider.mjs';
import { NinjaTraderMarketDataProvider } from './ninjatrader-market-data-provider.mjs';
import { NinjaTraderMonitorProvider } from './ninjatrader-monitor-provider.mjs';

// The data route is opt-in and exact-symbol scoped. Permission/risk consumers
// cannot use a NinjaTrader quote against a Schwab account snapshot.
export async function createConfiguredMarketDataProviders({ requestJson, env = process.env, now = Date.now, ninjaClient } = {}) {
  const schwab = new SchwabMarketDataProvider({ requestJson, now });
  const configPath = env.EXECUTIONOS_NINJATRADER_CONFIG;
  if (!configPath) return { marketDataProvider: schwab, permissionMarketDataProvider: schwab, close: async () => {} };
  if (!path.isAbsolute(configPath)) throw new Error('NINJATRADER_CONFIG_PATH_MUST_BE_ABSOLUTE');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let oauth, client = ninjaClient;
  try {
    const relay = env.EXECUTIONOS_NINJATRADER_MONITOR_URL && !client
      ? new NinjaTraderMonitorProvider({ baseUrl: env.EXECUTIONOS_NINJATRADER_MONITOR_URL, config }) : null;
    if (!client && !relay) {
      const { NinjaTraderOAuthStore, NinjaTraderReadOnlyClient } = await import('./ninjatrader-mcp-client.mjs');
      const directory = env.EXECUTIONOS_NINJATRADER_AUTH_DIR;
      oauth = new NinjaTraderOAuthStore({ directory, environment: config.environment });
      client = new NinjaTraderReadOnlyClient({ environment: config.environment, oauthProvider: oauth, now });
    }
    const ninja = relay || new NinjaTraderMarketDataProvider({ client, config, now });
    const route = symbol => ninja.supportsSymbol(symbol) ? ninja : schwab;
    const marketDataProvider = Object.freeze({ source: 'SCHWAB_WITH_NINJATRADER_READ_ONLY',
      getQuote: (symbol, options) => route(symbol).getQuote(symbol, options),
      getMinuteBars: (symbol, options) => route(symbol).getMinuteBars(symbol, options),
      getDailyBars: (symbol, options) => route(symbol).getDailyBars(symbol, options) });
    const permissionMarketDataProvider = Object.freeze({ ...marketDataProvider, getQuote: async (symbol, options) => {
      if (ninja.supportsSymbol(symbol)) throw new Error('NINJATRADER_DATA_ONLY_PERMISSION_DISABLED');
      return schwab.getQuote(symbol, options);
    } });
    return { marketDataProvider, permissionMarketDataProvider, releaseAuthLock: () => oauth?.close(),
      close: async () => { try { await client?.close?.(); } finally { oauth?.close(); } } };
  } catch (error) { oauth?.close(); throw error; }
}
