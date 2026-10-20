import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuoteEvidence, CURRENT_LIVE_QUOTE_EVIDENCE_POLICY, freshness } from '../schwab-bridge/ninjatrader-quote-evidence.mjs';
const now = Date.parse('2026-10-19T22:00:00Z');
const quote = { quoteTime: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(), realtime: true };
const assess = value => assessQuoteEvidence(value, { nowMs: now, ...CURRENT_LIVE_QUOTE_EVIDENCE_POLICY });
test('NinjaTrader probe requires source, receipt and explicit realtime evidence', () => {
  assert.equal(assess(quote).valid, true);
  for (const patch of [{ quoteTime: null }, { receivedAt: null }, { receivedAt: 'bad' }, { realtime: null }, { realtime: false }, { realtime: 'true' }]) {
    assert.equal(assess({ ...quote, ...patch }).valid, false);
  }
});
test('NinjaTrader probe rejects stale, future and inconsistent clocks without mutating source quotes', () => {
  for (const field of ['quoteTime', 'receivedAt']) {
    for (const offset of [-5001, 2001]) assert.equal(assess({ ...quote, [field]: new Date(now + offset).toISOString() }).valid, false);
  }
  const result = assess({ ...quote, quoteTime: new Date(now + 1000).toISOString(), receivedAt: new Date(now - 2000).toISOString() });
  assert.ok(result.reasonCodes.includes('QUOTE_SOURCE_RECEIPT_CLOCK_MISMATCH'));
  assert.equal(quote.realtime, true);
  for (const value of [null, false, '', NaN, 'not-time']) assert.equal(freshness(value, { nowMs: now, maxAgeMs: 5000 }).isStale, true);
});
