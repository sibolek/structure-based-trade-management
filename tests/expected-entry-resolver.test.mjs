import assert from "node:assert/strict";
import test from "node:test";
import { resolveExpectedEntry } from "../schwab-bridge/expected-entry-resolver.mjs";
import { CURRENT_LIVE_QUOTE_EVIDENCE_POLICY } from "../schwab-bridge/clock-freshness.mjs";

const NOW = Date.parse("2026-09-01T00:00:05.000Z");
const FRESH = "2026-09-01T00:00:01.000Z";

function quote(overrides = {}) {
  return {
    bid: 99.9,
    ask: 100.1,
    last: 1,
    mark: 2,
    asOf: FRESH,
    source: "SCHWAB",
    ...overrides,
  };
}

function resolve(overrides = {}) {
  return resolveExpectedEntry({
    direction: "LONG",
    entryMode: "MARKETABLE_NOW",
    effectiveStop: 99,
    quote: quote(),
    nowMs: NOW,
    ...overrides,
  });
}

test("marketable LONG uses ask and ignores mark/last", () => {
  const result = resolve();
  assert.equal(result.status, "VALID");
  assert.equal(result.currentExpectedEntry, 100.1);
  assert.equal(result.expectedEntryRule, "ASK_MARKETABLE_LONG");
});

test("marketable SHORT uses bid", () => {
  const result = resolve({ direction: "SHORT", effectiveStop: 101 });
  assert.equal(result.status, "VALID");
  assert.equal(result.currentExpectedEntry, 99.9);
  assert.equal(result.expectedEntryRule, "BID_MARKETABLE_SHORT");
});

test("LONG stop trigger uses trigger when trigger is above ask", () => {
  const result = resolve({ entryMode: "STOP_TRIGGER", triggerPrice: 100.5 });
  assert.equal(result.currentExpectedEntry, 100.5);
  assert.equal(result.expectedEntryRule, "MAX_TRIGGER_ASK_STOP_LONG");
});

test("LONG stop trigger uses ask when ask has moved above trigger", () => {
  const result = resolve({ entryMode: "STOP_TRIGGER", triggerPrice: 100, quote: quote({ ask: 100.7 }) });
  assert.equal(result.currentExpectedEntry, 100.7);
});

test("SHORT stop trigger uses trigger when trigger is below bid", () => {
  const result = resolve({ direction: "SHORT", entryMode: "STOP_TRIGGER", triggerPrice: 99.5, effectiveStop: 101 });
  assert.equal(result.currentExpectedEntry, 99.5);
  assert.equal(result.expectedEntryRule, "MIN_TRIGGER_BID_STOP_SHORT");
});

test("SHORT stop trigger uses bid when bid has moved below trigger", () => {
  const result = resolve({
    direction: "SHORT",
    entryMode: "STOP_TRIGGER",
    triggerPrice: 99.5,
    effectiveStop: 101,
    quote: quote({ bid: 99.2, ask: 99.3 }),
  });
  assert.equal(result.currentExpectedEntry, 99.2);
});

test("locked market is valid", () => {
  const result = resolve({ quote: quote({ bid: 100, ask: 100 }) });
  assert.equal(result.status, "VALID");
  assert.equal(result.currentExpectedEntry, 100);
});

test("crossed market blocks", () => {
  const result = resolve({ quote: quote({ bid: 100.2, ask: 100.1 }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["CROSSED_MARKET"]);
});

test("missing bid blocks instead of falling back to last or mark", () => {
  const result = resolve({ quote: quote({ bid: null }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["REQUIRED_QUOTE_SIDE_MISSING"]);
});

test("missing ask blocks instead of falling back to last or mark", () => {
  const result = resolve({ quote: quote({ ask: 0 }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["REQUIRED_QUOTE_SIDE_MISSING"]);
});

test("quote exactly 5 seconds old remains valid", () => {
  const result = resolve({ quote: quote({ asOf: "2026-09-01T00:00:00.000Z" }) });
  assert.equal(result.status, "VALID");
  assert.equal(result.quoteAgeMs, 5000);
});

test("quote older than 5 seconds blocks", () => {
  const result = resolve({ quote: quote({ asOf: "2026-08-31T23:59:59.999Z" }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUOTE_STALE"]);
  assert.equal(result.quoteAgeMs, 5001);
});

test("missing quote timestamp blocks", () => {
  const result = resolve({ quote: quote({ asOf: null }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUOTE_UNAVAILABLE"]);
});

test("unsupported entry mode blocks", () => {
  const result = resolve({ entryMode: "LIMIT" });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["UNSUPPORTED_ENTRY_MODE"]);
});

test("stop-trigger mode requires a positive trigger", () => {
  const result = resolve({ entryMode: "STOP_TRIGGER", triggerPrice: null });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INVALID_TRIGGER_PRICE"]);
});

test("LONG entry at or below effective stop blocks", () => {
  const result = resolve({ effectiveStop: 100.1 });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INVALID_ENTRY_STOP_GEOMETRY"]);
});

test("SHORT entry at or above effective stop blocks", () => {
  const result = resolve({ direction: "SHORT", effectiveStop: 99.9 });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INVALID_ENTRY_STOP_GEOMETRY"]);
});

test("resolver preserves normalized quote provenance", () => {
  const result = resolve();
  assert.equal(result.quoteSource, "SCHWAB");
  assert.equal(result.quoteObservedAt, FRESH);
  assert.equal(result.quoteAgeMs, 4000);
  assert.equal(result.bid, 99.9);
  assert.equal(result.ask, 100.1);
});

test("resolver accepts ISO, epoch number/string, Date and legacy alias timestamps consistently", () => {
  const epoch = Date.parse(FRESH);
  for (const quoteValue of [
    quote({ asOf: FRESH }),
    quote({ asOf: epoch }),
    quote({ asOf: String(epoch) }),
    quote({ asOf: new Date(epoch) }),
    { ...quote(), asOf: undefined, quoteObservedAt: FRESH },
  ]) {
    if (quoteValue.asOf === undefined) delete quoteValue.asOf;
    const result = resolve({ quote: quoteValue });
    assert.equal(result.status, "VALID");
    assert.equal(result.quoteObservedAt, FRESH);
    assert.equal(result.quoteAgeMs, 4_000);
  }
});

test("explicit invalid bid/ask timestamp is not replaced by trade or alias time", () => {
  const result = resolve({
    quote: quote({
      quoteTime: "invalid",
      asOf: "2026-09-01T00:00:04.500Z",
      quoteObservedAt: "2026-09-01T00:00:04.500Z",
      tradeTime: "2026-09-01T00:00:04.500Z",
    }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUOTE_UNAVAILABLE"]);
});

test("future-dated quote within clock skew is treated as age zero", () => {
  const result = resolve({ quote: quote({ asOf: "2026-09-01T00:00:06.000Z" }) });
  assert.equal(result.status, "VALID");
  assert.equal(result.quoteAgeMs, 0);
});

test("future-dated quote beyond clock skew blocks", () => {
  const result = resolve({ quote: quote({ asOf: "2026-09-01T00:00:07.001Z" }) });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUOTE_STALE"]);
  assert.equal(result.quoteAgeMs, null);
});

test("bid and ask freshness uses quoteTime rather than a newer trade asOf", () => {
  const result = resolve({
    quote: quote({
      quoteTime: "2026-08-31T23:59:59.999Z",
      asOf: "2026-09-01T00:00:04.500Z",
    }),
  });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["QUOTE_STALE"]);
  assert.equal(result.quoteObservedAt, "2026-08-31T23:59:59.999Z");
});

test("strict live evidence requires a fresh receipt and real-time entitlement", () => {
  const valid = resolve({
    quote: quote({
      receivedAt: "2026-09-01T00:00:04.500Z",
      realtime: true,
    }),
    quoteEvidencePolicy: CURRENT_LIVE_QUOTE_EVIDENCE_POLICY,
  });
  assert.equal(valid.status, "VALID");

  const missingReceipt = resolve({
    quote: quote({ realtime: true }),
    quoteEvidencePolicy: CURRENT_LIVE_QUOTE_EVIDENCE_POLICY,
  });
  assert.equal(missingReceipt.status, "BLOCKED");
  assert.deepEqual(missingReceipt.reasonCodes, ["QUOTE_RECEIPT_UNAVAILABLE"]);

  const delayed = resolve({
    quote: quote({
      receivedAt: "2026-09-01T00:00:04.500Z",
      realtime: false,
    }),
    quoteEvidencePolicy: CURRENT_LIVE_QUOTE_EVIDENCE_POLICY,
  });
  assert.equal(delayed.status, "BLOCKED");
  assert.deepEqual(delayed.reasonCodes, ["QUOTE_NOT_REALTIME"]);

  const staleReceipt = resolve({
    quote: quote({
      receivedAt: "2026-08-31T23:59:59.999Z",
      realtime: true,
    }),
    quoteEvidencePolicy: CURRENT_LIVE_QUOTE_EVIDENCE_POLICY,
  });
  assert.equal(staleReceipt.status, "BLOCKED");
  assert.deepEqual(staleReceipt.reasonCodes, ["QUOTE_RECEIPT_STALE"]);
});
