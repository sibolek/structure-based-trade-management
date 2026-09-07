import assert from "node:assert/strict";
import test from "node:test";
import { DssInputAssembler } from "../schwab-bridge/dss-input-assembler.mjs";
import { evaluateDss } from "../schwab-bridge/dss-evaluator.mjs";

const PRIOR_20 = [
  "2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14",
  "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
  "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28",
  "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
];

function dateFromWindow(options) {
  const center = (Number(options.startDate) + Number(options.endDate)) / 2;
  return new Date(center).toISOString().slice(0, 10);
}

function minuteBars(symbol, date, count) {
  const base = Date.parse(`${date}T13:30:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const timestamp = base + index * 60_000;
    const basis = 7700 + (index % 20) * 0.05;
    return {
      symbol,
      timeframe: "1m",
      source: "SCHWAB",
      timestamp,
      time: new Date(timestamp).toISOString(),
      open: basis,
      high: basis + 0.25,
      low: basis - 0.25,
      close: basis + 0.05,
      volume: 1000 + index,
    };
  });
}

function dailyBars(symbol, dates) {
  return dates.map((date, index) => ({
    symbol,
    timeframe: "1d",
    source: "SCHWAB",
    timestamp: Date.parse(`${date}T13:30:00.000Z`),
    time: `${date}T13:30:00.000Z`,
    open: 7600 + index,
    high: 7620 + index,
    low: 7580 + index,
    close: 7610 + index,
    volume: 1_000_000,
  }));
}

function provider({
  symbol,
  assetMainType,
  nowMs,
  dailyDates,
  countsByDate = {},
  defaultCount = 390,
} = {}) {
  return {
    source: "SCHWAB",
    async getQuote() {
      return {
        symbol,
        source: "SCHWAB",
        bid: 7709,
        ask: 7709.25,
        last: 7709,
        mark: 7709.125,
        asOf: new Date(nowMs - 500).toISOString(),
        receivedAt: new Date(nowMs).toISOString(),
        assetMainType,
        tick: assetMainType === "FUTURE" ? 0.25 : 0.01,
        tickAmount: assetMainType === "FUTURE" ? 1.25 : null,
        futureMultiplier: assetMainType === "FUTURE" ? 5 : null,
      };
    },
    async getDailyBars() {
      return dailyBars(symbol, dailyDates);
    },
    async getMinuteBars(_symbol, options) {
      const date = dateFromWindow(options);
      return minuteBars(symbol, date, countsByDate[date] ?? defaultCount);
    },
  };
}

function candidate(symbol) {
  return {
    candidateId: `holiday-${symbol.replace(/\W/g, "")}`,
    source: "SOD_A_PLUS_TRADES",
    contractVersion: 1,
    contentHash: `hash-${symbol}`,
    symbol,
    direction: "SHORT",
  };
}

function structure(nowMs) {
  return {
    structuralInvalidationDefinition: {
      rule: "Structure invalidates above operator-resolved reference",
      referenceType: "PRICE",
    },
    structureEvaluation: {
      status: "VALID",
      evaluatedAt: new Date(nowMs - 1000).toISOString(),
      evaluationReference: "holiday-structure-eval",
      evidenceReference: "operator-chart-structure-confirmation",
      resolvedPrice: 7715,
    },
  };
}

async function assemble({ symbol, assetMainType, nowMs, dailyDates, countsByDate }) {
  const marketDataProvider = provider({
    symbol,
    assetMainType,
    nowMs,
    dailyDates,
    countsByDate,
  });
  const assembler = new DssInputAssembler({
    marketDataProvider,
    now: () => nowMs,
    snapshotIdFactory: () => `snapshot-${symbol}-${nowMs}`,
  });
  return assembler.assemble({
    candidate: candidate(symbol),
    ...structure(nowMs),
  });
}

test("MES Labor Day early close is a complete 210-minute session, not a missing-bar failure", async () => {
  const nowMs = Date.parse("2026-09-07T17:45:00.000Z");
  const input = await assemble({
    symbol: "/MESU26",
    assetMainType: "FUTURE",
    nowMs,
    dailyDates: PRIOR_20,
    countsByDate: { "2026-09-07": 210 },
  });

  assert.equal(input.marketSnapshot.sourceIntegrity.marketSessionProfile, "CME_EQUITY_INDEX");
  assert.equal(input.marketSnapshot.sourceIntegrity.evaluationSession, "AFTER_HOURS");
  assert.equal(input.marketSnapshot.sourceIntegrity.currentSessionSchedule.status, "EARLY_CLOSE");
  assert.equal(input.marketSnapshot.sourceIntegrity.currentSessionSchedule.minuteCount, 210);
  assert.equal(input.marketSnapshot.sourceIntegrity.sessions.at(-1).completeTwoMinuteBars, 105);

  const evaluation = evaluateDss(input, { nowMs, idFactory: () => "labor-day-mes-eval" });
  assert.equal(evaluation.status, "VALID");
  assert.equal(evaluation.evaluationSession, "AFTER_HOURS");
  assert.equal(evaluation.latestCompletedBar.timestamp, Date.parse("2026-09-07T16:58:00.000Z"));
  assert.equal(evaluation.reasonCodes.includes("EXPECTED_COMPLETED_BAR_MISSING"), false);
  assert.equal(evaluation.reasonCodes.includes("CURRENT_SESSION_RTH_INCOMPLETE"), false);
});

test("US equity Labor Day is closed for the full day and never expects phantom RTH bars", async () => {
  const nowMs = Date.parse("2026-09-07T17:45:00.000Z");
  const input = await assemble({
    symbol: "NVDA",
    assetMainType: "EQUITY",
    nowMs,
    dailyDates: PRIOR_20,
    countsByDate: {},
  });

  assert.equal(input.marketSnapshot.sourceIntegrity.marketSessionProfile, "US_EQUITY");
  assert.equal(input.marketSnapshot.sourceIntegrity.evaluationSession, "CLOSED");
  assert.equal(input.marketSnapshot.sourceIntegrity.currentSessionSchedule.status, "CLOSED");
  assert.equal(input.marketSnapshot.sourceIntegrity.includedSessionDates.includes("2026-09-07"), false);

  const evaluation = evaluateDss(input, { nowMs, idFactory: () => "labor-day-equity-eval" });
  assert.equal(evaluation.status, "BLOCKED");
  assert.ok(evaluation.reasonCodes.includes("UNSUPPORTED_EVALUATION_SESSION"));
  assert.equal(evaluation.reasonCodes.includes("EXPECTED_COMPLETED_BAR_MISSING"), false);
  assert.equal(evaluation.reasonCodes.includes("CURRENT_SESSION_RTH_INCOMPLETE"), false);
});

test("the shortened Labor Day MES session is accepted as a completed ATR source session on September 8", async () => {
  const nowMs = Date.parse("2026-09-08T14:06:05.000Z");
  const priorDates = [...PRIOR_20.slice(1), "2026-09-07"];
  const input = await assemble({
    symbol: "/MESU26",
    assetMainType: "FUTURE",
    nowMs,
    dailyDates: priorDates,
    countsByDate: {
      "2026-09-07": 210,
      "2026-09-08": 36,
    },
  });

  const laborDayReport = input.marketSnapshot.sourceIntegrity.sessions.find((item) => item.date === "2026-09-07");
  assert.ok(laborDayReport);
  assert.equal(laborDayReport.isCurrentSession, false);
  assert.equal(laborDayReport.sessionStatus, "EARLY_CLOSE");
  assert.equal(laborDayReport.minuteCount, 210);
  assert.equal(laborDayReport.completeTwoMinuteBars, 105);
  assert.equal(input.marketSnapshot.sourceIntegrity.completedRthSessionsIncluded, 20);

  const evaluation = evaluateDss(input, { nowMs, idFactory: () => "post-labor-day-mes-eval" });
  assert.equal(evaluation.status, "VALID");
  assert.equal(evaluation.reasonCodes.includes("COMPLETED_RTH_SOURCE_INTEGRITY_FAILED"), false);
  assert.equal(evaluation.reasonCodes.includes("EXPECTED_COMPLETED_BAR_MISSING"), false);
});
