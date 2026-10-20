import { MarketDataProvider } from './market-data-provider.mjs';
import { ninjaProfileHash } from './ninjatrader-monitor-api.mjs';
import { NinjaTraderMarketDataProvider } from './ninjatrader-market-data-provider.mjs';

export class NinjaTraderMonitorProvider extends MarketDataProvider {
  constructor({ baseUrl, config, fetchImpl = fetch } = {}) {
    super({ source: 'NINJATRADER' });
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('NINJATRADER_MONITOR_URL_MUST_BE_LOOPBACK');
    this.baseUrl = url.origin; this.config = structuredClone(config); this.fetch = fetchImpl; this.hash = ninjaProfileHash(config);
    this.mapping = new NinjaTraderMarketDataProvider({ client: { callTool() {} }, config });
  }
  supportsSymbol(symbol) { return this.mapping.supportsSymbol(symbol); }
  async #read(kind, symbol, options = {}) {
    const normalized = String(symbol || '').trim().toUpperCase();
    if (!this.supportsSymbol(normalized)) throw new Error('NINJATRADER_EXACT_CONTRACT_MAPPING_REQUIRED');
    const url = new URL(`${this.baseUrl}/api/market-data/${kind}`); url.searchParams.set('symbol', normalized);
    for (const [key, value] of Object.entries(options)) if (value !== undefined) url.searchParams.set(key,
      ['startDate', 'endDate'].includes(key) ? new Date(value).toISOString() : String(value));
    let response, payload;
    try { response = await this.fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(60000) }); payload = await response.json(); }
    catch { throw new Error('NINJATRADER_MONITOR_UNAVAILABLE'); }
    if (!response.ok) throw new Error(/^NINJATRADER_[A-Z0-9_]+$/.test(payload?.error) ? payload.error : 'NINJATRADER_MONITOR_REQUEST_FAILED');
    if (payload.schema !== 'executionos.ninjatrader.marketdata.v1' || payload.environment !== this.config.environment
        || payload.profileHash !== this.hash || payload.kind !== kind || payload.executionEnabled !== false) throw new Error('NINJATRADER_MONITOR_PROFILE_MISMATCH');
    const rows = kind === 'quote' ? [payload.data] : payload.data;
    if (!Array.isArray(rows) || rows.some(row => row?.source !== 'NINJATRADER' || row?.symbol !== normalized
        || row.environment !== this.config.environment || row.providerSymbol !== this.config.instruments[normalized].contract)) throw new Error('NINJATRADER_MONITOR_DATA_MISMATCH');
    return payload.data;
  }
  getQuote(symbol) { return this.#read('quote', symbol); }
  getMinuteBars(symbol, options) { return this.#read('minute', symbol, options); }
  getDailyBars(symbol, options) { return this.#read('daily', symbol, options); }
}
