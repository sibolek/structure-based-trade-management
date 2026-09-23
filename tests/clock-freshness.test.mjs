import assert from "node:assert/strict";
import test from "node:test";
import { freshness, timestampMs } from "../schwab-bridge/clock-freshness.mjs";

test("freshness preserves Date millisecond precision for the local clock", () => {
  const result = freshness("2026-09-01T00:00:00.500Z", {
    nowMs: new Date("2026-09-01T00:00:05.999Z"),
    maxAgeMs: 5_000,
  });
  assert.equal(result.ageMs, 5_499);
  assert.equal(result.isStale, true);
});

test("timestamp normalization preserves supported forms", () => {
  const expected = Date.parse("2026-09-01T00:00:04.000Z");
  assert.equal(timestampMs("2026-09-01T00:00:04.000Z"), expected);
  assert.equal(timestampMs(expected), expected);
  assert.equal(timestampMs(String(expected)), expected);
  assert.equal(timestampMs(new Date(expected)), expected);
});

test("timestamp normalization rejects invalid and out-of-range values without throwing", () => {
  for (const value of ["invalid", 9e15, "9000000000000000", new Date(NaN), true, {}, null]) {
    assert.doesNotThrow(() => timestampMs(value));
    assert.equal(timestampMs(value), null);
  }
});
