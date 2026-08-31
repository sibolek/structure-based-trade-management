import assert from "node:assert/strict";
import test from "node:test";
import { DssLiveInputAssembler } from "../schwab-bridge/dss-live-input-assembler.mjs";
import { DssInputAssemblyError } from "../schwab-bridge/dss-input-assembler.mjs";
import {
  buildLiveProbeContext,
  parseLiveProbeArgs,
} from "../schwab-bridge/dss-live-probe.mjs";

function assembledInput(overrides = {}) {
  return Object.freeze({
    candidate: Object.freeze({ symbol: "NVDA" }),
    marketSnapshot: Object.freeze({
      provider: "SCHWAB",
      capturedAt: "2026-08-31T15:00:00.000Z",
      quote: Object.freeze({
        symbol: "NVDA",
        source: "SCHWAB",
        asOf: "2026-08-31T15:00:00.000Z",
        last: 100,
        tick: null,
      }),
      executionBars: Object.freeze([]),
      sourceIntegrity: Object.freeze({ completedRthSessionsIncluded: 20 }),
    }),
    instrument: Object.freeze({
      instrumentType: "EQUITY",
      priceIncrement: null,
      instrumentValueMetadata: Object.freeze({}),
      metadataProvider: null,
      metadataVerified: false,
      priceIncrementSource: null,
    }),
    ...overrides,
  });
}

test("live assembler replaces the opening assembly quote with the final refreshed quote and its tick provenance", async () => {
  const base = {
    assemble: async () => assembledInput(),
  };
  let quoteCalls = 0;
  const provider = {
    source: "SCHWAB",
    async getQuote(symbol) {
      quoteCalls += 1;
      assert.equal(symbol, "NVDA");
      return {
        symbol: "NVDA",
        source: "SCHWAB",
        asOf: "2026-08-31T15:00:09.500Z",
        last: 101,
        tick: 0.01,
        tickAmount: 0.01,
      };
    },
  };
  const assembler = new DssLiveInputAssembler({
    marketDataProvider: provider,
    baseAssembler: base,
    now: () => Date.parse("2026-08-31T15:00:10.000Z"),
  });

  const input = await assembler.assemble({});
  assert.equal(quoteCalls, 1);
  assert.equal(input.marketSnapshot.quote.last, 101);
  assert.equal(input.marketSnapshot.quote.asOf, "2026-08-31T15:00:09.500Z");
  assert.equal(input.marketSnapshot.capturedAt, "2026-08-31T15:00:10.000Z");
  assert.equal(input.marketSnapshot.finalQuoteRefresh.refreshedAt, "2026-08-31T15:00:10.000Z");
  assert.equal(input.instrument.priceIncrement, 0.01);
  assert.equal(input.instrument.priceIncrementSource, "FINAL_LIVE_QUOTE_TICK");
  assert.equal(input.instrument.metadataVerified, true);
  assert.equal(input.instrument.instrumentValueMetadata.tickAmount, 0.01);
  assert.equal(Object.isFrozen(input), true);
});

test("final quote without a positive tick preserves an already verified resolver increment", async () => {
  const baseInput = assembledInput({
    instrument: Object.freeze({
      instrumentType: "EQUITY",
      priceIncrement: 0.005,
      instrumentValueMetadata: Object.freeze({}),
      metadataProvider: "TEST_REFERENCE",
      metadataVerified: true,
      priceIncrementSource: "VERIFIED_METADATA_RESOLVER",
    }),
  });
  const assembler = new DssLiveInputAssembler({
    marketDataProvider: {
      source: "SCHWAB",
      async getQuote() {
        return { symbol: "NVDA", source: "SCHWAB", asOf: "2026-08-31T15:00:09.500Z", tick: null };
      },
    },
    baseAssembler: { assemble: async () => baseInput },
    now: () => Date.parse("2026-08-31T15:00:10.000Z"),
  });

  const input = await assembler.assemble({});
  assert.equal(input.instrument.priceIncrement, 0.005);
  assert.equal(input.instrument.priceIncrementSource, "VERIFIED_METADATA_RESOLVER");
  assert.equal(input.instrument.metadataProvider, "TEST_REFERENCE");
});

test("final quote refresh failure remains a typed assembly ERROR", async () => {
  const assembler = new DssLiveInputAssembler({
    marketDataProvider: {
      source: "SCHWAB",
      async getQuote() { throw new Error("quote unavailable"); },
    },
    baseAssembler: { assemble: async () => assembledInput() },
  });

  await assert.rejects(
    () => assembler.assemble({}),
    (error) => error instanceof DssInputAssemblyError
      && error.status === "ERROR"
      && error.stage === "FINAL_QUOTE"
      && error.reasonCodes.includes("MARKET_DATA_PROVIDER_ERROR"),
  );
});

test("live probe CLI arguments normalize symbol and direction without inventing structure", () => {
  const args = parseLiveProbeArgs(["nvda", "long", "217.125"]);
  assert.deepEqual(args, { symbol: "NVDA", direction: "LONG", structuralPrice: 217.125 });
  assert.equal(Object.isFrozen(args), true);
});

test("live probe rejects missing, invalid-direction, and non-numeric structural arguments", () => {
  for (const argv of [
    [],
    ["NVDA", "SIDEWAYS", "217"],
    ["NVDA", "LONG", "not-a-price"],
  ]) {
    assert.throws(
      () => parseLiveProbeArgs(argv),
      (error) => error.code === "INVALID_DSS_LIVE_PROBE_ARGS",
    );
  }
});

test("probe context marks structure as synthetic and produces stable candidate provenance", () => {
  const first = buildLiveProbeContext({
    symbol: "NVDA",
    direction: "LONG",
    structuralPrice: 217.125,
    evaluatedAt: "2026-08-31T15:00:10.000Z",
  });
  const second = buildLiveProbeContext({
    symbol: "nvda",
    direction: "long",
    structuralPrice: 217.125,
    evaluatedAt: "2026-08-31T15:00:11.000Z",
  });

  assert.equal(first.candidate.sourceId, "DSS_LIVE_PROBE");
  assert.equal(first.candidate.candidateContentHash, second.candidate.candidateContentHash);
  assert.equal(first.structuralInvalidationDefinition.referenceType, "LIVE_PROBE_SYNTHETIC_PRICE");
  assert.equal(first.structuralInvalidationDefinition.sourceTimeframe, "5m");
  assert.equal(first.structureEvaluation.status, "VALID");
  assert.equal(first.structureEvaluation.resolvedPrice, 217.125);
  assert.equal(first.structureEvaluation.evidenceReference, "CLI_STRUCTURAL_PRICE_ARGUMENT");
});
