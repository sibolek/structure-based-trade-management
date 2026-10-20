import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NinjaTraderMarketDataProvider } from '../schwab-bridge/ninjatrader-market-data-provider.mjs';
import { createConfiguredMarketDataProviders } from '../schwab-bridge/market-data-provider-factory.mjs';
import { assessQuoteEvidence, CURRENT_LIVE_QUOTE_EVIDENCE_POLICY } from '../schwab-bridge/ninjatrader-quote-evidence.mjs';
import { config, now, quotePayload, candle } from './fixtures/ninjatrader/config.mjs';

function fixture(payload = quotePayload, cfg = config) {
  const calls = [];
  const client = { callTool: async (name, args) => {
    calls.push({ name, args });
    return name === 'market_history' ? { barType: args.barType, barSize: 1, ...structuredClone(payload) } : structuredClone(payload);
  } };
  return { provider: new NinjaTraderMarketDataProvider({ client, config: cfg, now: () => now }), calls };
}
test('quote matches exact contract, preserves source time and entitlement, and omits raw data', async () => {
  const { provider, calls } = fixture({ ...quotePayload, accountSecret: 'never copy' });
  const quote = await provider.getQuote('/mesz26');
  assert.equal(quote.symbol, '/MESZ26'); assert.equal(quote.providerSymbol, 'MESZ6');
  assert.equal(quote.source, 'NINJATRADER'); assert.equal(quote.assetMainType, 'FUTURE');
  assert.equal(quote.quoteTime, new Date(now).toISOString()); assert.equal(quote.executionEligible, false);
  assert.equal(quote.mark, 6000.125); assert.ok(!JSON.stringify(quote).includes('never copy'));
  assert.ok(assessQuoteEvidence(quote, { nowMs: now, ...CURRENT_LIVE_QUOTE_EVIDENCE_POLICY }).valid);
  assert.deepEqual(calls, [{ name: 'market_snapshot', args: { symbols: ['MESZ6'] } }]);
});
test('missing, delayed, stale and future evidence never becomes fresh realtime data', async () => {
  for (const [field, value] of [['realtime', undefined], ['realtime', false], ['timestamp', '2026-10-19T14:30:00Z'], ['timestamp', '2026-10-19T14:33:00Z']]) {
    const payload = structuredClone(quotePayload); payload.quotes[0][field] = value;
    const quote = await fixture(payload).provider.getQuote('/MESZ26');
    assert.equal(assessQuoteEvidence(quote, { nowMs: now, ...CURRENT_LIVE_QUOTE_EVIDENCE_POLICY }).valid, false);
  }
});
test('contract metadata is passed only from explicit numeric snapshot bindings, never inferred', async () => {
  const cfg = structuredClone(config);
  Object.assign(cfg.bindings.quote, { tick: '/spec/tickSize', tickAmount: '/spec/tickValue', futureMultiplier: '/spec/pointValue' });
  const payload = structuredClone(quotePayload); payload.quotes[0].spec = { tickSize: 0.25, tickValue: 1.25, pointValue: 5 };
  const quote = await fixture(payload, cfg).provider.getQuote('/MESZ26');
  assert.equal(quote.tick, 0.25); assert.equal(quote.tickAmount, 1.25); assert.equal(quote.futureMultiplier, 5);
  const unbound = await fixture(payload).provider.getQuote('/MESZ26');
  assert.equal(unbound.tick, null); assert.equal(unbound.tickAmount, null); assert.equal(unbound.futureMultiplier, null);
});
test('rejects missing/ambiguous contracts, malformed prices and timezone-free timestamps', async () => {
  for (const update of [{ contract: 'MESU6' }, { timestamp: undefined }, { timestamp: '2026-10-19T10:32:00' },
    { timestamp: '2026-10-19' }, { bid: '6000', ask: null, last: true }, { bid: 6001, ask: 6000 }]) {
    const payload = structuredClone(quotePayload); Object.assign(payload.quotes[0], update);
    await assert.rejects(fixture(payload).provider.getQuote('/MESZ26'), /NINJATRADER_/);
  }
  const payload = structuredClone(quotePayload); payload.quotes.push(payload.quotes[0]);
  await assert.rejects(fixture(payload).provider.getQuote('/MESZ26'), /CONTRACT_MISMATCH/);
});
test('mapping requires explicit expiry, same product/month/year, reviewed output bindings and environment', () => {
  for (const patch of [{ bindingStatus: 'UNVERIFIED' }, { instruments: { MES: config.instruments['/MESZ26'] } },
    { instruments: { '/MESZ26': { contract: 'MNQZ6', exchangeTimeZone: 'America/Chicago' } } },
    { instruments: { '/MESZ26': { contract: 'MESU6', exchangeTimeZone: 'America/Chicago' } } },
    { instruments: { '/MESZ26': { contract: 'MESZ5', exchangeTimeZone: 'America/Chicago' } } }, { environment: 'other' }]) {
    assert.throws(() => fixture(quotePayload, { ...config, ...patch }), /NINJATRADER_/);
  }
  const { provider, calls } = fixture();
  return assert.rejects(provider.getQuote('MES'), /EXACT_CONTRACT/).then(() => assert.equal(calls.length, 0));
});
test('minute bars normalize end timestamps to start without filling gaps or double counting', async () => {
  const payload = { contract: 'MESZ6', bars: [candle('2026-10-19T14:32:00Z'), candle('2026-10-19T14:30:00Z')] };
  const { provider, calls } = fixture(payload);
  const bars = await provider.getMinuteBars('/MESZ26', { startDate: now - 180000, endDate: now });
  assert.deepEqual(bars.map(bar => bar.time), ['2026-10-19T14:29:00.000Z', '2026-10-19T14:31:00.000Z']);
  assert.equal(bars[0].volume, 25); assert.equal(bars[0].timeframe, '1m');
  assert.deepEqual(calls[0].args, { symbol: 'MESZ6', barType: 'Minute', barSize: 1, from: '2026-10-19T14:29:00.000Z',
    to: '2026-10-19T14:33:00.000Z' });
});
test('history fails on invalid bars, duplicate slots, wrong contract and truncation', async () => {
  for (const payload of [
    { contract: 'MESU6', bars: [] }, { contract: 'MESZ6', bars: [candle('2026-10-19T14:32:00Z', { v: null })] },
    { contract: 'MESZ6', bars: [candle('2026-10-19T14:32:00Z', { l: 7000 })] },
    { contract: 'MESZ6', bars: [candle('2026-10-19T14:32:01Z')] },
    { contract: 'MESZ6', bars: [candle('2026-10-19T14:32:00Z'), candle('2026-10-19T14:32:00Z')] },
    { contract: 'MESZ6', bars: Array.from({ length: 10000 }, () => candle('2026-10-19T14:32:00Z')) },
  ]) await assert.rejects(fixture(payload).provider.getMinuteBars('/MESZ26', { startDate: now - 60000, endDate: now }), /NINJATRADER_/);
  await assert.rejects(fixture().provider.getMinuteBars('/MESZ26', { startDate: now, endDate: now - 60000 }), /WINDOW_TOO_LARGE/);
  await assert.rejects(fixture().provider.getMinuteBars('/MESZ26', { startDate: now - 10000 * 60000, endDate: now }), /WINDOW_TOO_LARGE/);
});
test('RTH uses existing New York calendar and DST, retaining overnight bars only with extendedHours', async () => {
  for (const [day, before, open] of [['2026-10-19', '13:30', '13:31'], ['2026-12-01', '14:30', '14:31']]) {
    const payload = { contract: 'MESZ6', bars: [candle(`${day}T${before}:00Z`), candle(`${day}T${open}:00Z`)] };
    const provider = fixture(payload).provider;
    const options = { startDate: `${day}T00:00:00Z`, endDate: `${day}T23:59:00Z` };
    assert.equal((await provider.getMinuteBars('/MESZ26', options)).length, 2);
    const rth = await provider.getMinuteBars('/MESZ26', { ...options, extendedHours: false });
    assert.equal(rth.length, 1); assert.equal(rth[0].timestamp, Date.parse(`${day}T${before}:00Z`));
  }
  const payload = { contract: 'MESZ6', bars: [candle('2026-11-26T15:01:00Z')] };
  await assert.rejects(fixture(payload).provider.getMinuteBars('/MESZ26', {
    startDate: '2026-11-26T00:00:00Z', endDate: '2026-11-26T23:59:00Z', extendedHours: false,
  }), /CALENDAR_UNVERIFIED/);
});
test('daily bars preserve provider session anchor instead of assigning a local calendar date', async () => {
  const { provider, calls } = fixture({ contract: 'MESZ6', bars: [candle('2026-10-18T22:00:00Z')] });
  const bars = await provider.getDailyBars('/MESZ26');
  assert.equal(bars[0].time, '2026-10-18T22:00:00.000Z'); assert.equal(bars[0].timeframe, '1d');
  assert.equal(calls[0].args.barType, 'Daily');
});
test('factory preserves Schwab defaults, routes only exact mappings, and blocks permission cross-account use', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nt-config-')); t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify(config));
  const urls = [];
  const requestJson = async url => { urls.push(url); return { NVDA: { quote: { bidPrice: 100, quoteTime: now } } }; };
  const defaults = await createConfiguredMarketDataProviders({ requestJson, env: {} });
  assert.equal(defaults.marketDataProvider.source, 'SCHWAB'); assert.equal(defaults.marketDataProvider, defaults.permissionMarketDataProvider);
  let ninjaCalls = 0;
  const routed = await createConfiguredMarketDataProviders({ requestJson, env: { EXECUTIONOS_NINJATRADER_CONFIG: file },
    ninjaClient: { callTool: async () => { ninjaCalls++; return quotePayload; } }, now: () => now });
  assert.equal((await routed.marketDataProvider.getQuote('/MESZ26')).source, 'NINJATRADER');
  assert.equal((await routed.marketDataProvider.getQuote('NVDA')).source, 'SCHWAB');
  await assert.rejects(routed.permissionMarketDataProvider.getQuote('/MESZ26'), /DATA_ONLY_PERMISSION_DISABLED/);
  assert.equal(ninjaCalls, 1); assert.equal(urls.length, 1);
  assert.equal((await routed.permissionMarketDataProvider.getQuote('NVDA')).source, 'SCHWAB');
  await routed.close();
});
