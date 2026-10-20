import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NinjaTraderMarketDataProvider } from '../schwab-bridge/ninjatrader-market-data-provider.mjs';
import { uniqueTradingDates } from '../schwab-bridge/dss-input-assembler.mjs';
import { assessQuoteEvidence, CURRENT_LIVE_QUOTE_EVIDENCE_POLICY } from '../schwab-bridge/ninjatrader-quote-evidence.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../docs/ninjatrader-market-data.live-verified.json', import.meta.url)));
const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/ninjatrader/live-market-sample.json', import.meta.url)));
const now = Date.parse('2026-10-20T00:25:16Z');
function provider(payload = sample, cfg = config) {
  const calls = [];
  return { calls, instance: new NinjaTraderMarketDataProvider({ config: cfg, now: () => now,
    client: { endpoint: 'https://mcp-live.tradovateapi.com/mcp', callTool: async (name, args) => {
      calls.push({ name, args });
      return structuredClone(name === 'market_snapshot' ? payload.quote : args.barType === 'Minute' ? payload.minute : payload.daily);
    } } }) };
}
test('recorded first-party snapshot binds contract specs and RealTime enum without boolean coercion', async () => {
  const quote = await provider().instance.getQuote('/MESZ26');
  assert.equal(quote.bid, 7730); assert.equal(quote.ask, 7730.25); assert.equal(quote.last, 7730.25);
  assert.equal(quote.dataFeedMode, 'RealTime'); assert.equal(quote.realtime, true);
  assert.equal(quote.tick, 0.25); assert.equal(quote.tickAmount, 1.25); assert.equal(quote.futureMultiplier, 5);
  assert.equal(quote.executionEligible, false);
  assert.equal(assessQuoteEvidence(quote, { nowMs: now, ...CURRENT_LIVE_QUOTE_EVIDENCE_POLICY }).valid, true);
});
test('Delayed and unknown enum values remain false/unknown and fail live evidence', async () => {
  for (const [value, expected] of [['Delayed', false], ['Unexpected', null], ['true', null], [undefined, null]]) {
    const payload = structuredClone(sample); payload.quote.snapshots[0].dataFeedMode = value;
    const quote = await provider(payload).instance.getQuote('/MESZ26');
    assert.equal(quote.realtime, expected);
    assert.equal(assessQuoteEvidence(quote, { nowMs: now, ...CURRENT_LIVE_QUOTE_EVIDENCE_POLICY }).valid, false);
  }
});
test('recorded history uses a date range without count and preserves provenance and gaps', async () => {
  const { instance, calls } = provider();
  const bars = await instance.getMinuteBars('/MESZ26', sample.minuteWindow);
  assert.equal(bars.length, 3); assert.equal(bars[0].time, '2026-10-19T23:25:00.000Z');
  assert.equal(bars.at(-1).time, '2026-10-20T00:24:00.000Z');
  assert.equal(bars[0].volume, 109); assert.equal(bars[0].realtime, true); assert.equal(bars[0].dataFeedMode, 'RealTime');
  assert.equal(Object.hasOwn(calls[0].args, 'count'), false);
  assert.equal(calls[0].args.from, '2026-10-19T23:25:00.000Z');
  assert.equal(calls[0].args.to, '2026-10-20T00:25:00.000Z');
});
test('split volume requires both nonnegative integer components; missing volume is not fabricated', async () => {
  for (const value of [undefined, -1, 0.5, '34', null]) {
    const payload = structuredClone(sample); payload.minute.bars[0].downVolume = value;
    await assert.rejects(provider(payload).instance.getMinuteBars('/MESZ26', sample.minuteWindow), /OHLCV_INVALID/);
  }
});
test('history rejects a wrong bar type/size instead of relabeling it as one-minute data', async () => {
  for (const update of [{ barType: 'Daily' }, { barSize: 5 }]) {
    const payload = structuredClone(sample); Object.assign(payload.minute, update);
    await assert.rejects(provider(payload).instance.getMinuteBars('/MESZ26', sample.minuteWindow), /AGGREGATION_MISMATCH/);
  }
});
test('daily UTC midnight is an exchange trade-date label; DSS does not shift it to the prior New York date', async () => {
  const bars = await provider().instance.getDailyBars('/MESZ26');
  assert.equal(bars.at(-1).time, '2026-10-20T00:00:00.000Z');
  assert.equal(bars.at(-1).sessionTradingDate, '2026-10-20');
  assert.equal(bars.at(-1).timestampSemantics, 'TRADING_DATE_LABEL');
  assert.deepEqual(uniqueTradingDates(bars), ['2026-09-01', '2026-09-02', '2026-10-19', '2026-10-20']);
  // Existing Schwab timestamp-to-New-York behavior remains unchanged.
  const schwab = { ...bars.at(-1), source: 'SCHWAB' };
  assert.deepEqual(uniqueTradingDates([schwab]), ['2026-10-19']);
});
test('trade-date bindings reject non-midnight daily labels', async () => {
  const payload = structuredClone(sample); payload.daily.bars[0].timestamp = '2026-09-01T22:00:00Z';
  await assert.rejects(provider(payload).instance.getDailyBars('/MESZ26'), /DAILY_TRADE_DATE_INVALID/);
});
test('daily label metadata cannot override dates for intraday bars or malformed NinjaTrader records', () => {
  const bar = { source: 'NINJATRADER', timeframe: '1d', timestampSemantics: 'TRADING_DATE_LABEL',
    timestamp: Date.parse('2026-10-20T00:00:00Z'), sessionTradingDate: '2026-10-21' };
  assert.deepEqual(uniqueTradingDates([bar]), []);
  assert.deepEqual(uniqueTradingDates([{ ...bar, timestamp: NaN }]), []);
  assert.deepEqual(uniqueTradingDates([{ ...bar, timeframe: '1m' }]), ['2026-10-19']);
});
