import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSchwabInstrumentSizingMetadata,
  SchwabInstrumentSizingMetadataProvider,
} from "../schwab-bridge/instrument-sizing-metadata-provider.mjs";

function equityQuote(overrides = {}) {
  return {
    symbol: "NVDA",
    source: "SCHWAB",
    assetMainType: "EQUITY",
    receivedAt: "2026-09-01T17:15:00.000Z",
    ...overrides,
  };
}

function futureQuote(overrides = {}) {
  return {
    symbol: "/MESZ26",
    source: "SCHWAB",
    assetMainType: "FUTURE",
    tick: 0.25,
    tickAmount: 1.25,
    futureMultiplier: 5,
    receivedAt: "2026-09-01T17:15:00.000Z",
    ...overrides,
  };
}

test("equity metadata normalizes to whole-share USD sizing contract", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("nvda", equityQuote());
  assert.equal(result.status, "VALID");
  assert.equal(result.assetType, "EQUITY");
  assert.equal(result.symbol, "NVDA");
  assert.equal(result.currency, "USD");
  assert.equal(result.minimumQuantity, 1);
  assert.equal(result.quantityIncrement, 1);
  assert.equal(result.tickSize, undefined);
});

test("equity sizing does not require price-increment metadata", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("NVDA", equityQuote({ tick: null }));
  assert.equal(result.status, "VALID");
});

test("MES futures metadata maps Schwab tick fields exactly", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote());
  assert.equal(result.status, "VALID");
  assert.equal(result.assetType, "FUTURE");
  assert.equal(result.tickSize, 0.25);
  assert.equal(result.tickValue, 1.25);
  assert.equal(result.pointValue, 5);
  assert.equal(result.minimumQuantity, 1);
  assert.equal(result.quantityIncrement, 1);
});

test("future may omit pointValue when tick size and tick value are valid", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote({ futureMultiplier: null }));
  assert.equal(result.status, "VALID");
  assert.equal(result.pointValue, null);
});

test("future requires positive tick size", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote({ tick: 0 }));
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_INVALID"]);
});

test("future requires positive tick value", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote({ tickAmount: null }));
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_INVALID"]);
});

test("contradictory future point value blocks", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote({ futureMultiplier: 50 }));
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_INCONSISTENT"]);
});

test("unsupported asset type blocks", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("AAPL  260918C00200000", equityQuote({ assetMainType: "OPTION" }));
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["UNSUPPORTED_ASSET_TYPE"]);
});

test("missing quote blocks as metadata unavailable", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("NVDA", null);
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_UNAVAILABLE"]);
});

test("empty provider currency blocks instead of inventing currency", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("NVDA", equityQuote(), { currency: "" });
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_INVALID"]);
});

test("metadata preserves source timestamp provenance", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("NVDA", equityQuote());
  assert.equal(result.metadataSource, "SCHWAB_QUOTE");
  assert.equal(result.metadataObservedAt, "2026-09-01T17:15:00.000Z");
  assert.match(result.metadataVersion, /^[0-9a-f]{64}$/);
});

test("metadataVersion is stable across irrelevant quote price changes", () => {
  const first = normalizeSchwabInstrumentSizingMetadata("NVDA", equityQuote({ bid: 200, ask: 200.01 }));
  const second = normalizeSchwabInstrumentSizingMetadata("NVDA", equityQuote({ bid: 205, ask: 205.01 }));
  assert.equal(first.metadataVersion, second.metadataVersion);
});

test("future metadataVersion changes when sizing metadata changes", () => {
  const first = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote());
  const second = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote({ tickAmount: 2.5, futureMultiplier: 10 }));
  assert.notEqual(first.metadataVersion, second.metadataVersion);
});

test("provider requests normalized symbol and returns normalized metadata", async () => {
  let requested = null;
  const provider = new SchwabInstrumentSizingMetadataProvider({
    marketDataProvider: {
      async getQuote(symbol) {
        requested = symbol;
        return equityQuote();
      },
    },
  });
  const result = await provider.getInstrumentSizingMetadata(" nvda ");
  assert.equal(requested, "NVDA");
  assert.equal(result.status, "VALID");
});

test("provider quote failure blocks as metadata unavailable", async () => {
  const provider = new SchwabInstrumentSizingMetadataProvider({
    marketDataProvider: {
      async getQuote() { throw new Error("network"); },
    },
  });
  const result = await provider.getInstrumentSizingMetadata("NVDA");
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_UNAVAILABLE"]);
});

test("provider requires symbol before market-data read", async () => {
  let calls = 0;
  const provider = new SchwabInstrumentSizingMetadataProvider({
    marketDataProvider: {
      async getQuote() { calls += 1; return equityQuote(); },
    },
  });
  const result = await provider.getInstrumentSizingMetadata("  ");
  assert.equal(calls, 0);
  assert.equal(result.status, "BLOCKED");
  assert.deepEqual(result.reasonCodes, ["INSTRUMENT_METADATA_UNAVAILABLE"]);
});

test("returned metadata is deeply immutable", () => {
  const result = normalizeSchwabInstrumentSizingMetadata("/MESZ26", futureQuote());
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.tickValue = 999; }, TypeError);
});
