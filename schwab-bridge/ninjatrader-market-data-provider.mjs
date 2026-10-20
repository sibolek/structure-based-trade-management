import { MarketDataProvider, selectSessionBars, tradingDateKey } from './market-data-provider.mjs';
import { resolveMarketSessionProfile, sessionScheduleForDate, marketMinuteOfDay } from './market-session-calendar.mjs';

function fail(code) { throw new Error(code); }
function symbolKey(symbol) {
  if (typeof symbol !== 'string' || !symbol.trim()) fail('NINJATRADER_SYMBOL_REQUIRED');
  return symbol.trim().toUpperCase();
}
function number(value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function timestamp(value, format) {
  const ms = format === 'epoch-ms' ? number(value)
    : format === 'iso' && typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || ms <= 0 || !Number.isFinite(new Date(ms).getTime())) fail('NINJATRADER_TIMESTAMP_INVALID');
  return ms;
}
function pointer(root, value) {
  if (value === '') return root;
  if (typeof value !== 'string' || !value.startsWith('/')) fail('NINJATRADER_BINDING_PATH_INVALID');
  return value.slice(1).split('/').reduce((node, key) => {
    const decoded = key.replace(/~1/g, '/').replace(/~0/g, '~');
    if (['__proto__', 'constructor', 'prototype'].includes(decoded)) fail('NINJATRADER_BINDING_PATH_INVALID');
    return node && Object.hasOwn(node, decoded) ? node[decoded] : undefined;
  }, root);
}
function readNumber(root, binding, key) { return binding[key] === undefined ? null : number(pointer(root, binding[key])); }
function feedEvidence(root, binding) {
  if (binding.dataFeedMode !== undefined) {
    const mode = pointer(root, binding.dataFeedMode);
    return { dataFeedMode: typeof mode === 'string' ? mode : null,
      realtime: mode === 'RealTime' ? true : mode === 'Delayed' ? false : null };
  }
  const value = binding.realtime === undefined ? null : pointer(root, binding.realtime);
  return { dataFeedMode: null, realtime: typeof value === 'boolean' ? value : null };
}
function barVolume(row, binding) {
  if (binding.volumeComponents !== undefined) {
    if (!Array.isArray(binding.volumeComponents) || binding.volumeComponents.length !== 2 || binding.volume !== undefined) fail('NINJATRADER_VOLUME_BINDING_INVALID');
    const values = binding.volumeComponents.map(key => number(pointer(row, key)));
    if (values.some(value => value === null || value < 0 || !Number.isSafeInteger(value))) fail('NINJATRADER_OHLCV_INVALID');
    const sum = values[0] + values[1];
    if (!Number.isSafeInteger(sum)) fail('NINJATRADER_OHLCV_INVALID');
    return sum;
  }
  return readNumber(row, binding, 'volume');
}
function dateInput(value) {
  if (value instanceof Date) value = value.getTime();
  return timestamp(value, typeof value === 'number' ? 'epoch-ms' : 'iso');
}

// Output mappings are supplied only after authenticated tools/list + describe
// discovery. The beta's public catalog does not publish its output schemas.
// There are deliberately no guessed quote/candle paths or symbol rollovers.
export class NinjaTraderMarketDataProvider extends MarketDataProvider {
  #client; #config; #instruments;
  constructor({ client, config, now = Date.now } = {}) {
    super({ source: 'NINJATRADER' });
    if (typeof client?.callTool !== 'function') fail('NINJATRADER_CLIENT_REQUIRED');
    if (!config || config.version !== 1 || !['demo', 'live'].includes(config.environment)) fail('NINJATRADER_CONFIG_INVALID');
    if (config.bindingStatus !== 'VERIFIED_FROM_AUTHENTICATED_DISCOVERY') fail('NINJATRADER_OUTPUT_BINDING_REQUIRED');
    if (!config.bindings?.quote || !config.bindings?.minute || !config.bindings?.daily) fail('NINJATRADER_OUTPUT_BINDING_REQUIRED');
    if (client.endpoint && client.endpoint !== `https://mcp-${config.environment}.tradovateapi.com/mcp`) fail('NINJATRADER_ENVIRONMENT_MISMATCH');
    this.#client = client; this.#config = structuredClone(config); this.now = now;
    this.#instruments = new Map();
    for (const [key, instrument] of Object.entries(config.instruments || {})) {
      const symbol = symbolKey(key);
      // Require exact contract month and year. Root and continuous aliases would
      // silently change the instrument when the front month rolls.
      if (!/^\/[A-Z0-9]+[FGHJKMNQUVXZ]\d{2}$/.test(symbol)
          || !/^[A-Z0-9]+[FGHJKMNQUVXZ]\d{1,2}$/.test(instrument.contract || '')
          || !['America/Chicago', 'America/New_York'].includes(instrument.exchangeTimeZone)) fail('NINJATRADER_EXACT_CONTRACT_MAPPING_REQUIRED');
      const internal = symbol.match(/^\/([A-Z0-9]+)([FGHJKMNQUVXZ])(\d{2})$/);
      const external = instrument.contract.match(/^([A-Z0-9]+)([FGHJKMNQUVXZ])(\d{1,2})$/);
      if (internal[1] !== external[1] || internal[2] !== external[2] || !internal[3].endsWith(external[3])) fail('NINJATRADER_CONTRACT_MAPPING_MISMATCH');
      if (this.#instruments.has(symbol)) fail('NINJATRADER_DUPLICATE_MAPPING');
      this.#instruments.set(symbol, structuredClone(instrument));
    }
    if (!this.#instruments.size) fail('NINJATRADER_EXACT_CONTRACT_MAPPING_REQUIRED');
    for (const kind of ['minute', 'daily']) {
      const b = this.#config.bindings[kind];
      if (!['iso', 'epoch-ms'].includes(b.timestampFormat)
          || !(kind === 'daily' ? ['start', 'trade-date'] : ['start', 'end']).includes(b.timestampAnchor)
          || !Number.isInteger(b.maxCount) || b.maxCount < 2 || b.maxCount > 10000) fail('NINJATRADER_HISTORY_BINDING_INVALID');
    }
  }
  supportsSymbol(symbol) { return this.#instruments.has(symbolKey(symbol)); }
  #instrument(symbol) {
    const key = symbolKey(symbol); const instrument = this.#instruments.get(key);
    if (!instrument) fail('NINJATRADER_EXACT_CONTRACT_MAPPING_REQUIRED');
    return { symbol: key, ...instrument };
  }
  async getQuote(symbol) {
    const instrument = this.#instrument(symbol); const binding = this.#config.bindings.quote;
    const payload = await this.#client.callTool('market_snapshot', { symbols: [instrument.contract] });
    const rows = pointer(payload, binding.rows);
    if (!Array.isArray(rows)) fail('NINJATRADER_QUOTE_SCHEMA_MISMATCH');
    const matches = rows.filter(row => pointer(row, binding.symbol) === instrument.contract);
    if (matches.length !== 1) fail('NINJATRADER_QUOTE_CONTRACT_MISMATCH');
    const row = matches[0];
    const bid = readNumber(row, binding, 'bid'), ask = readNumber(row, binding, 'ask'), last = readNumber(row, binding, 'last');
    if ([bid, ask, last].every(value => value === null) || (bid !== null && ask !== null && bid > ask)) fail('NINJATRADER_QUOTE_PRICE_INVALID');
    const quoteTime = new Date(timestamp(pointer(row, binding.quoteTime), binding.timestampFormat)).toISOString();
    if (binding.error !== undefined && pointer(row, binding.error)) fail('NINJATRADER_QUOTE_DATA_UNAVAILABLE');
    const evidence = feedEvidence(row, binding);
    return { symbol: instrument.symbol, source: this.source, environment: this.#config.environment,
      providerSymbol: instrument.contract, assetMainType: 'FUTURE', bid, ask, last,
      mark: bid !== null && ask !== null ? (bid + ask) / 2 : null,
      quoteTime, tradeTime: null, asOf: quoteTime, receivedAt: new Date(this.now()).toISOString(),
      ...evidence,
      tick: readNumber(row, binding, 'tick'), tickAmount: readNumber(row, binding, 'tickAmount'),
      futureMultiplier: readNumber(row, binding, 'futureMultiplier'),
      exchangeTimeZone: instrument.exchangeTimeZone, executionEligible: false };
  }
  async getMinuteBars(symbol, { startDate, endDate, extendedHours = true } = {}) {
    if (startDate === undefined || endDate === undefined) fail('NINJATRADER_HISTORY_WINDOW_REQUIRED');
    if (typeof extendedHours !== 'boolean') fail('NINJATRADER_SESSION_INVALID');
    const bars = await this.#history(symbol, 'minute', startDate, endDate);
    if (extendedHours) return bars;
    const profile = resolveMarketSessionProfile({ symbol, assetMainType: 'FUTURE' });
    const rth = selectSessionBars(bars, { session: 'RTH' });
    return rth.filter(bar => {
      const date = tradingDateKey(bar.timestamp);
      const schedule = sessionScheduleForDate(date, { profile });
      if (schedule.status === 'UNVERIFIED') fail('NINJATRADER_SESSION_CALENDAR_UNVERIFIED');
      const minute = marketMinuteOfDay(bar.timestamp);
      return schedule.status !== 'CLOSED' && minute >= schedule.openMinute && minute < schedule.closeMinute;
    });
  }
  async getDailyBars(symbol, { periodType = 'year', period = 1, startDate, endDate } = {}) {
    const end = endDate === undefined ? this.now() : dateInput(endDate);
    if (!['day', 'month', 'year'].includes(periodType) || !Number.isInteger(period) || period < 1) fail('NINJATRADER_DAILY_PERIOD_INVALID');
    const start = startDate === undefined ? end - ({ day: 1, month: 31, year: 366 }[periodType] * period * 86400000) : dateInput(startDate);
    return this.#history(symbol, 'daily', start, end);
  }
  async #history(symbol, kind, startDate, endDate) {
    const instrument = this.#instrument(symbol), b = this.#config.bindings[kind];
    const start = dateInput(startDate), end = dateInput(endDate);
    const interval = kind === 'minute' ? 60000 : 86400000;
    if (end <= start || Math.ceil((end - start) / interval) + 1 >= b.maxCount) fail('NINJATRADER_HISTORY_WINDOW_TOO_LARGE');
    const payload = await this.#client.callTool('market_history', { symbol: instrument.contract,
      barType: kind === 'minute' ? 'Minute' : 'Daily', barSize: 1, from: new Date(start).toISOString(),
      to: new Date(end + (kind === 'minute' && b.timestampAnchor === 'end' ? interval : 0)).toISOString(),
    });
    if (pointer(payload, b.symbol) !== instrument.contract) fail('NINJATRADER_HISTORY_CONTRACT_MISMATCH');
    if (payload.barType !== (kind === 'minute' ? 'Minute' : 'Daily') || payload.barSize !== 1) fail('NINJATRADER_HISTORY_AGGREGATION_MISMATCH');
    const evidence = feedEvidence(payload, b);
    const rows = pointer(payload, b.rows);
    if (!Array.isArray(rows) || rows.length >= b.maxCount) fail('NINJATRADER_HISTORY_TRUNCATED_OR_SCHEMA_MISMATCH');
    const seen = new Set();
    return rows.map(row => {
      const rawTime = timestamp(pointer(row, b.timestamp), b.timestampFormat);
      const time = rawTime - (kind === 'minute' && b.timestampAnchor === 'end' ? interval : 0);
      if ((kind === 'minute' && time % interval !== 0) || seen.has(time)) fail('NINJATRADER_BAR_TIMESTAMP_INVALID_OR_DUPLICATE');
      if (kind === 'daily' && b.timestampAnchor === 'trade-date' && time % 86400000 !== 0) fail('NINJATRADER_DAILY_TRADE_DATE_INVALID');
      seen.add(time);
      const values = Object.fromEntries(['open', 'high', 'low', 'close'].map(key => [key, readNumber(row, b, key)]));
      values.volume = barVolume(row, b);
      if (Object.values(values).some(value => value === null) || values.volume < 0
          || values.low > Math.min(values.open, values.close) || values.high < Math.max(values.open, values.close)
          || values.low > values.high) fail('NINJATRADER_OHLCV_INVALID');
      return { symbol: instrument.symbol, providerSymbol: instrument.contract, timeframe: kind === 'minute' ? '1m' : '1d',
        source: this.source, environment: this.#config.environment, timestamp: time, time: new Date(time).toISOString(), ...values,
        ...evidence,
        ...(kind === 'daily' && b.timestampAnchor === 'trade-date' ? {
          timestampSemantics: 'TRADING_DATE_LABEL', sessionTradingDate: new Date(time).toISOString().slice(0, 10),
        } : {}),
        exchangeTimeZone: instrument.exchangeTimeZone };
    }).filter(bar => bar.timestamp >= start && bar.timestamp < end).sort((a, b) => a.timestamp - b.timestamp);
  }
}
