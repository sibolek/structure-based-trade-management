import assert from "node:assert/strict";
import test from "node:test";
import {
  DssInputAssembler,
  DssInputAssemblyError,
} from "../schwab-bridge/dss-input-assembler.mjs";
import { evaluateDss } from "../schwab-bridge/dss-evaluator.mjs";
import { normalizeSchwabQuote } from "../schwab-bridge/schwab-market-data-provider.mjs";

const PRIOR_DATES = [
  "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07",
  "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
  "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
  "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
];
const CURRENT_DATE = "2026-08-31";

function rthMinuteBars(date, {
  count = 390,
  removeIndex = null,
  duplicateIndex = null,
} = {}) {
  const base = Date.parse(`${date}T13:30:00.000Z`);
  let bars = Array.from({ length: count }, (_, index) => ({
    symbol: "NVDA",
    timeframe: "1m",
    source: "SCHWAB",
    timestamp: base + index * 60_000,
    time: new Date(base + index * 60_000).toISOString(),
    open: 100 + index * 0.01,
    high: 100.10 + index * 0.01,
    low: 99.90 + index * 0.01,
    close: 100.05 + index * 0.01,
    volume: 1000 + index,
  }));
  if (Number.isInteger(removeIndex)) bars = bars.filter((_, index) => index !== removeIndex);
  if (Number.isInteger(duplicateIndex) && bars[duplicateIndex]) bars.push(structuredClone(bars[duplicateIndex]));
  return bars.sort((a, b) => a.timestamp - b.timestamp);
}

function dailyBars() {
  return PRIOR_DATES.map((date, index) => ({
    symbol: "NVDA",
    timeframe: "1d",
    source: "SCHWAB",
    timestamp: Date.parse(`${date}T13:30:00.000Z`),
    time: `${date}T13:30:00.000Z`,
    open: 90 + index,
    high: 91 + index,
    low: 89 + index,
    close: 90.5 + index,
    volume: 1_000_000,
  }));
}

function dateFromWindow(options) {
  const center = (Number(options.startDate) + Number(options.endDate)) / 2;
  return new Date(center).toISOString().slice(0, 10);
}

function provider({
  nowMs,
  currentMinuteCount = 66,
  sessionOverrides = {},
  quoteOverrides = {},
  failMethod = null,
} = {}) {
  const calls = { quote: 0, daily: 0, minute: [] };
  return {
    source: "SCHWAB",
    calls,
    async getQuote(symbol) {
      calls.quote += 1;
      if (failMethod === "quote") throw new Error("quote unavailable");
      return {
        symbol,
        source: "SCHWAB",
        bid: 217.10,
        ask: 217.12,
        last: 217.11,
        mark: 217.11,
        asOf: new Date(nowMs - 500).toISOString(),
        receivedAt: new Date(nowMs).toISOString(),
        assetMainType: "EQUITY",
        tick: 0.01,
        tickAmount: null,
        futureMultiplier: null,
        ...quoteOverrides,
      };
    },
    async getDailyBars() {
      calls.daily += 1;
      if (failMethod === "daily") throw new Error("daily unavailable");
      return dailyBars();
    },
    async getMinuteBars(symbol, options) {
      const date = dateFromWindow(options);
      calls.minute.push(date);
      if (failMethod === "minute") throw new Error("minute unavailable");
      const override = sessionOverrides[date] || {};
      return rthMinuteBars(date, {
        count: date === CURRENT_DATE ? currentMinuteCount : 390,
        ...override,
      }).map((bar) => ({ ...bar, symbol }));
    },
  };
}

function persistedCandidate() {
  return {
    candidateId: "sod-2026-08-31-NVDA-1",
    source: "SOD_A_PLUS",
    contractVersion: 1,
    contentHash: "candidate-hash-1",
    symbol: "NVDA",
    direction: "LONG",
  };
}

function structure() {
  return {
    structuralInvalidationDefinition: {
      composition: "ALL_OF",
      conditions: [{ rule: "LOSS_OF_DYNAMIC_STRUCTURE", referenceType: "BREAKOUT_PULLBACK_LOW" }],
    },
    structureEvaluation: {
      status: "VALID",
      evaluatedAt: "2026-08-31T14:35:58.000Z",
      evaluationReference: "structure-eval-1",
      resolvedPrice: 216.25,
      evidenceReference: "2m-breakout-pullback-low",
    },
  };
}

function assemblerOptions(marketDataProvider, nowMs, overrides = {}) {
  return {
    marketDataProvider,
    now: () => nowMs,
    snapshotIdFactory: () => "snapshot-1",
    ...overrides,
  };
}

async function assembleWith(assembler) {
  return assembler.assemble({
    candidate: persistedCandidate(),
    ...structure(),
  });
}

test("assembler builds exactly 20 completed RTH sessions plus the current RTH session", async () => {
  const nowMs = Date.parse("2026-08-31T14:36:05.000Z");
  const market = provider({ nowMs, currentMinuteCount: 66 });
  const assembler = new DssInputAssembler(assemblerOptions(market, nowMs));

  const input = await assembleWith(assembler);

  assert.equal(input.candidate.decisionTimeframe, "5m");
  assert.equal(input.candidate.entryTimeframe, "2m");
  assert.equal(input.marketSnapshot.sourceIntegrity.completedRthSessionsIncluded, 20);
  assert.deepEqual(input.marketSnapshot.sourceIntegrity.includedSessionDates, [...PRIOR_DATES, CURRENT_DATE]);
  assert.equal(input.marketSnapshot.executionBars.length, 20 * 195 + 33);
  assert.equal(input.marketSnapshot.executionBars[0].timestamp, Date.parse("2026-08-03T13:30:00.000Z"));
  assert.equal(input.marketSnapshot.executionBars.at(-1).timestamp, Date.parse("2026-08-31T14:34:00.000Z"));
  assert.equal(input.instrument.priceIncrement, 0.01);
  assert.equal(input.instrument.priceIncrementSource, "SCHWAB_QUOTE_TICK");
  assert.equal(Object.isFrozen(input), true);
});

test("premarket assembly uses the most recent 20 completed RTH sessions and does not fetch a current RTH session", async () => {
  const nowMs = Date.parse("2026-08-31T13:00:00.000Z");
  const market = provider({ nowMs });
  const assembler = new DssInputAssembler(assemblerOptions(market, nowMs));

  const input = await assembleWith(assembler);

  assert.equal(input.marketSnapshot.sourceIntegrity.evaluationSession, "PREMARKET");
  assert.deepEqual(input.marketSnapshot.sourceIntegrity.includedSessionDates, PRIOR_DATES);
  assert.equal(input.marketSnapshot.executionBars.length, 20 * 195);
  assert.equal(market.calls.minute.includes(CURRENT_DATE), false);
});

test("completed historical source sessions are cached in memory while the current session is refreshed", async () => {
  const nowMs = Date.parse("2026-08-31T14:36:05.000Z");
  const market = provider({ nowMs, currentMinuteCount: 66 });
  const assembler = new DssInputAssembler(assemblerOptions(market, nowMs, {
    snapshotIdFactory: (() => {
      let id = 0;
      return () => `snapshot-${++id}`;
    })(),
  }));

  await assembleWith(assembler);
  await assembleWith(assembler);

  assert.equal(market.calls.minute.length, 22);
  for (const date of PRIOR_DATES) {
    assert.equal(market.calls.minute.filter((value) => value === date).length, 1);
  }
  assert.equal(market.calls.minute.filter((value) => value === CURRENT_DATE).length, 2);
});

test("missing or duplicate 1-minute data in a completed RTH session fails closed before ATR input is assembled", async () => {
  for (const override of [{ removeIndex: 100 }, { duplicateIndex: 100 }]) {
    const nowMs = Date.parse("2026-08-31T14:36:05.000Z");
    const market = provider({ nowMs, sessionOverrides: { [PRIOR_DATES[0]]: override } });
    const assembler = new DssInputAssembler(assemblerOptions(market, nowMs));

    await assert.rejects(
      () => assembleWith(assembler),
      (error) => error instanceof DssInputAssemblyError
        && error.status === "BLOCKED"
        && error.reasonCodes.includes("COMPLETED_RTH_SOURCE_INTEGRITY_FAILED"),
    );
  }
});

test("publication-latency gap in the newest current 2-minute interval is omitted so evaluator grace semantics remain authoritative", async () => {
  const nowMs = Date.parse("2026-08-31T14:36:05.000Z");
  const market = provider({ nowMs, currentMinuteCount: 65 });
  const assembler = new DssInputAssembler(assemblerOptions(market, nowMs));

  const input = await assembleWith(assembler);
  assert.equal(input.marketSnapshot.executionBars.at(-1).timestamp, Date.parse("2026-08-31T14:32:00.000Z"));

  const evaluation = evaluateDss(input, { nowMs, idFactory: () => "eval-grace" });
  assert.equal(evaluation.status, "VALID");
  assert.equal(evaluation.latestCompletedBar.timestamp, Date.parse("2026-08-31T14:32:00.000Z"));
});

test("after-hours assembly blocks if today's RTH source session is truncated", async () => {
  const nowMs = Date.parse("2026-08-31T20:05:00.000Z");
  const market = provider({ nowMs, currentMinuteCount: 389 });
  const assembler = new DssInputAssembler(assemblerOptions(market, nowMs));

  await assert.rejects(
    () => assembleWith(assembler),
    (error) => error instanceof DssInputAssemblyError
      && error.status === "BLOCKED"
      && error.reasonCodes.includes("CURRENT_RTH_SOURCE_INTEGRITY_FAILED"),
  );
});

test("verified metadata resolver supplies priceIncrement when Schwab quote has no positive tick", async () => {
  const nowMs = Date.parse("2026-08-31T13:00:00.000Z");
  const market = provider({ nowMs, quoteOverrides: { tick: null } });
  const assembler = new DssInputAssembler(assemblerOptions(market, nowMs, {
    instrumentMetadataResolver: async () => ({
      verified: true,
      provider: "SCHWAB_REFERENCE_ADAPTER",
      instrumentType: "EQUITY",
      priceIncrement: 0.01,
    }),
  }));

  const input = await assembleWith(assembler);
  assert.equal(input.instrument.priceIncrement, 0.01);
  assert.equal(input.instrument.metadataVerified, true);
  assert.equal(input.instrument.priceIncrementSource, "VERIFIED_METADATA_RESOLVER");
});

test("assembler never assumes a penny increment when quote metadata and verified resolver evidence are absent", async () => {
  const nowMs = Date.parse("2026-08-31T13:00:00.000Z");
  const market = provider({ nowMs, quoteOverrides: { tick: null } });
  const assembler = new DssInputAssembler(assemblerOptions(market, nowMs, {
    instrumentMetadataResolver: async () => ({
      verified: false,
      provider: "UNVERIFIED",
      instrumentType: "EQUITY",
      priceIncrement: 0.01,
    }),
  }));

  const input = await assembleWith(assembler);
  assert.equal(input.instrument.priceIncrement, null);
  assert.equal(input.instrument.metadataVerified, false);

  const evaluation = evaluateDss(input, { nowMs, idFactory: () => "eval-no-increment" });
  assert.equal(evaluation.status, "BLOCKED");
  assert.ok(evaluation.reasonCodes.includes("INVALID_PRICE_INCREMENT"));
});

test("provider and metadata-resolver exceptions remain typed assembly ERRORs", async () => {
  const nowMs = Date.parse("2026-08-31T13:00:00.000Z");
  const brokenMarket = provider({ nowMs, failMethod: "daily" });
  const brokenAssembler = new DssInputAssembler(assemblerOptions(brokenMarket, nowMs));
  await assert.rejects(
    () => assembleWith(brokenAssembler),
    (error) => error instanceof DssInputAssemblyError
      && error.status === "ERROR"
      && error.reasonCodes.includes("MARKET_DATA_PROVIDER_ERROR"),
  );

  const market = provider({ nowMs, quoteOverrides: { tick: null } });
  const metadataAssembler = new DssInputAssembler(assemblerOptions(market, nowMs, {
    instrumentMetadataResolver: async () => { throw new Error("reference metadata unavailable"); },
  }));
  await assert.rejects(
    () => assembleWith(metadataAssembler),
    (error) => error instanceof DssInputAssemblyError
      && error.status === "ERROR"
      && error.reasonCodes.includes("INSTRUMENT_METADATA_PROVIDER_ERROR"),
  );
});

test("Schwab normalization preserves tick, tickAmount, and futureMultiplier when supplied", () => {
  const payload = {
    "/MES": {
      assetMainType: "FUTURE",
      quote: {
        bidPrice: 6500,
        askPrice: 6500.25,
        lastPrice: 6500.25,
        quoteTime: 1_800_000_000_000,
        tick: 0.25,
        tickAmount: 1.25,
      },
      reference: {
        futureMultiplier: 5,
      },
    },
  };

  const quote = normalizeSchwabQuote(payload, "/MES", { receivedAtMs: 1_800_000_000_500 });
  assert.equal(quote.assetMainType, "FUTURE");
  assert.equal(quote.tick, 0.25);
  assert.equal(quote.tickAmount, 1.25);
  assert.equal(quote.futureMultiplier, 5);
});
