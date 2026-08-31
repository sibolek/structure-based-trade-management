import crypto from "node:crypto";
import { DSS_POLICY_VERSION, dssPolicyForVersion } from "./dss-policy.mjs";
import { DSS_CALCULATOR_VERSION } from "./dss-evaluator.mjs";
import {
  EASTERN_TIME_ZONE,
  aggregateMinuteBars,
  minuteContinuity,
  selectSessionBars,
  tradingDateKey,
} from "./market-data-provider.mjs";

const ONE_MINUTE_MS = 60_000;
const TWO_MINUTES_MS = 120_000;
const FULL_RTH_MINUTES = 390;
const FULL_RTH_TWO_MINUTE_BARS = 195;

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function easternSession(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (["Sat", "Sun"].includes(values.weekday)) return "CLOSED";
  const minuteOfDay = Number(values.hour) * 60 + Number(values.minute);
  if (minuteOfDay < 9 * 60 + 30) return "PREMARKET";
  if (minuteOfDay < 16 * 60) return "RTH";
  return "AFTER_HOURS";
}

function easternMinuteOfDay(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function broadDateWindow(date) {
  const center = Date.parse(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(center)) {
    throw new Error(`invalid trading date: ${date}`);
  }
  return {
    startDate: center - 18 * 60 * 60 * 1000,
    endDate: center + 18 * 60 * 60 * 1000,
  };
}

function uniqueTradingDates(bars) {
  return [...new Set((Array.isArray(bars) ? bars : [])
    .map((bar) => tradingDateKey(bar?.timestamp))
    .filter(Boolean))]
    .sort();
}

function candidateIdentity(candidate) {
  const value = candidate && typeof candidate === "object" ? candidate : {};
  return {
    candidateId: text(value.candidateId),
    sourceId: upper(value.sourceId ?? value.source),
    contractVersion: Number(value.contractVersion),
    candidateContentHash: text(value.candidateContentHash ?? value.contentHash),
    symbol: upper(value.symbol),
    direction: upper(value.direction),
    decisionTimeframe: "5m",
    entryTimeframe: "2m",
  };
}

function validateCandidateIdentity(candidate) {
  if (!candidate.candidateId) return "candidateId is required";
  if (!candidate.sourceId) return "sourceId is required";
  if (!Number.isInteger(candidate.contractVersion) || candidate.contractVersion < 1) return "contractVersion must be an integer >= 1";
  if (!candidate.candidateContentHash) return "candidateContentHash is required";
  if (!candidate.symbol) return "symbol is required";
  if (!["LONG", "SHORT"].includes(candidate.direction)) return "direction must be LONG or SHORT";
  return null;
}

function sessionIntegrity(rthMinuteBars, {
  date,
  nowMs,
  isCurrentSession,
  evaluationSession,
} = {}) {
  const closed = (Array.isArray(rthMinuteBars) ? rthMinuteBars : [])
    .filter((bar) => !isCurrentSession || Number(bar.timestamp) + ONE_MINUTE_MS <= nowMs)
    .slice()
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const aggregated = aggregateMinuteBars(rthMinuteBars, { minutes: 2, nowMs });
  const complete = aggregated.filter((bar) => bar.complete);

  if (!isCurrentSession) {
    const continuity = minuteContinuity(closed);
    const firstMinute = closed[0]?.timestamp;
    const lastMinute = closed.at(-1)?.timestamp;
    const valid = closed.length === FULL_RTH_MINUTES
      && continuity.missingSlots === 0
      && continuity.duplicates === 0
      && easternMinuteOfDay(firstMinute) === 9 * 60 + 30
      && easternMinuteOfDay(lastMinute) === 15 * 60 + 59
      && complete.length === FULL_RTH_TWO_MINUTE_BARS
      && easternMinuteOfDay(complete[0]?.timestamp) === 9 * 60 + 30
      && easternMinuteOfDay(complete.at(-1)?.timestamp) === 15 * 60 + 58;
    return {
      valid,
      date,
      minuteCount: closed.length,
      missingMinutes: continuity.missingSlots,
      duplicateMinutes: continuity.duplicates,
      completeTwoMinuteBars: complete.length,
      executionBars: complete,
    };
  }

  if (evaluationSession === "AFTER_HOURS") {
    const continuity = minuteContinuity(closed);
    const valid = closed.length === FULL_RTH_MINUTES
      && continuity.missingSlots === 0
      && continuity.duplicates === 0
      && easternMinuteOfDay(closed[0]?.timestamp) === 9 * 60 + 30
      && easternMinuteOfDay(closed.at(-1)?.timestamp) === 15 * 60 + 59
      && complete.length === FULL_RTH_TWO_MINUTE_BARS;
    return {
      valid,
      date,
      minuteCount: closed.length,
      missingMinutes: continuity.missingSlots,
      duplicateMinutes: continuity.duplicates,
      completeTwoMinuteBars: complete.length,
      executionBars: complete,
    };
  }

  if (evaluationSession !== "RTH") {
    return {
      valid: true,
      date,
      minuteCount: 0,
      missingMinutes: 0,
      duplicateMinutes: 0,
      completeTwoMinuteBars: 0,
      executionBars: [],
    };
  }

  if (!complete.length) {
    return {
      valid: true,
      date,
      minuteCount: closed.length,
      missingMinutes: 0,
      duplicateMinutes: 0,
      completeTwoMinuteBars: 0,
      executionBars: [],
    };
  }

  const latestCompleteEnd = Number(complete.at(-1).timestamp) + TWO_MINUTES_MS;
  const sourceForCompletedBars = closed.filter((bar) => Number(bar.timestamp) < latestCompleteEnd);
  const continuity = minuteContinuity(sourceForCompletedBars);
  const expectedSourceMinutes = complete.length * 2;
  const valid = sourceForCompletedBars.length === expectedSourceMinutes
    && continuity.missingSlots === 0
    && continuity.duplicates === 0
    && easternMinuteOfDay(sourceForCompletedBars[0]?.timestamp) === 9 * 60 + 30
    && easternMinuteOfDay(complete[0]?.timestamp) === 9 * 60 + 30;

  return {
    valid,
    date,
    minuteCount: sourceForCompletedBars.length,
    missingMinutes: continuity.missingSlots,
    duplicateMinutes: continuity.duplicates,
    completeTwoMinuteBars: complete.length,
    executionBars: complete,
  };
}

function normalizeInstrumentMetadata(quote, resolvedMetadata) {
  const quoteTick = finiteNumber(quote?.tick);
  const resolverValue = resolvedMetadata && typeof resolvedMetadata === "object" ? resolvedMetadata : {};
  const resolverIncrement = finiteNumber(resolverValue.priceIncrement);
  const resolverProvider = text(resolverValue.provider);
  const resolverVerified = resolverValue.verified === true
    && resolverIncrement !== null
    && resolverIncrement > 0
    && Boolean(resolverProvider);
  const quoteVerified = quoteTick !== null && quoteTick > 0;
  const priceIncrement = quoteVerified ? quoteTick : (resolverVerified ? resolverIncrement : null);

  const tickAmount = finiteNumber(quote?.tickAmount ?? resolverValue.instrumentValueMetadata?.tickAmount);
  const futureMultiplier = finiteNumber(quote?.futureMultiplier ?? resolverValue.instrumentValueMetadata?.futureMultiplier);
  const instrumentValueMetadata = {
    ...(resolverValue.instrumentValueMetadata && typeof resolverValue.instrumentValueMetadata === "object"
      ? clone(resolverValue.instrumentValueMetadata)
      : {}),
  };
  if (tickAmount !== null) instrumentValueMetadata.tickAmount = tickAmount;
  if (futureMultiplier !== null) instrumentValueMetadata.futureMultiplier = futureMultiplier;

  return {
    instrumentType: text(resolverValue.instrumentType || quote?.assetMainType) || null,
    priceIncrement,
    instrumentValueMetadata,
    metadataProvider: quoteVerified ? text(quote?.source || "SCHWAB") : (resolverVerified ? resolverProvider : null),
    metadataVerified: quoteVerified || resolverVerified,
    priceIncrementSource: quoteVerified ? "SCHWAB_QUOTE_TICK" : (resolverVerified ? "VERIFIED_METADATA_RESOLVER" : null),
  };
}

export class DssInputAssemblyError extends Error {
  constructor(message, {
    status = "ERROR",
    reasonCodes = ["DSS_INPUT_ASSEMBLY_ERROR"],
    stage = "ASSEMBLY",
    details = null,
  } = {}) {
    super(message);
    this.name = "DssInputAssemblyError";
    this.status = status;
    this.reasonCodes = [...new Set(reasonCodes)];
    this.stage = stage;
    this.details = details;
  }
}

export class DssInputAssembler {
  constructor({
    marketDataProvider,
    instrumentMetadataResolver = null,
    now = () => Date.now(),
    snapshotIdFactory = () => crypto.randomUUID(),
    policyVersion = DSS_POLICY_VERSION,
  } = {}) {
    const requiredProviderMethods = ["getQuote", "getMinuteBars", "getDailyBars"];
    if (!marketDataProvider || requiredProviderMethods.some((method) => typeof marketDataProvider[method] !== "function")) {
      throw new Error("DssInputAssembler requires a compatible MarketDataProvider");
    }
    const resolverFunction = typeof instrumentMetadataResolver === "function"
      ? instrumentMetadataResolver
      : instrumentMetadataResolver?.getInstrumentMetadata;
    if (instrumentMetadataResolver && typeof resolverFunction !== "function") {
      throw new Error("instrumentMetadataResolver must be a function or expose getInstrumentMetadata()");
    }
    if (typeof now !== "function") throw new Error("now must be a function");
    if (typeof snapshotIdFactory !== "function") throw new Error("snapshotIdFactory must be a function");

    this.marketDataProvider = marketDataProvider;
    this.instrumentMetadataResolver = resolverFunction
      ? resolverFunction.bind(instrumentMetadataResolver)
      : null;
    this.now = now;
    this.snapshotIdFactory = snapshotIdFactory;
    this.policy = dssPolicyForVersion(policyVersion);
    this.completedSessionCache = new Map();
  }

  async assemble({
    candidate,
    structuralInvalidationDefinition,
    structureEvaluation,
  } = {}) {
    const nowMs = Number(this.now());
    if (!Number.isFinite(nowMs)) {
      throw new DssInputAssemblyError("input assembler clock must return epoch milliseconds", {
        reasonCodes: ["INVALID_DSS_INPUT_ASSEMBLY_CLOCK"],
      });
    }

    const normalizedCandidate = candidateIdentity(candidate);
    const candidateError = validateCandidateIdentity(normalizedCandidate);
    if (candidateError) {
      throw new DssInputAssemblyError(candidateError, {
        status: "BLOCKED",
        reasonCodes: ["INVALID_DSS_INPUT_CANDIDATE_IDENTITY"],
        stage: "CANDIDATE",
      });
    }

    const snapshotId = text(this.snapshotIdFactory());
    if (!snapshotId) {
      throw new DssInputAssemblyError("snapshotIdFactory must return a non-empty snapshotId", {
        reasonCodes: ["INVALID_MARKET_SNAPSHOT_ID"],
      });
    }

    let quote;
    let dailyBars;
    try {
      [quote, dailyBars] = await Promise.all([
        this.marketDataProvider.getQuote(normalizedCandidate.symbol),
        this.marketDataProvider.getDailyBars(normalizedCandidate.symbol),
      ]);
    } catch (error) {
      throw new DssInputAssemblyError(`market-data provider failed: ${error?.message || error}`, {
        status: "ERROR",
        reasonCodes: ["MARKET_DATA_PROVIDER_ERROR"],
        stage: "MARKET_DATA",
      });
    }

    const evaluationSession = easternSession(nowMs);
    const currentTradingDate = tradingDateKey(nowMs);
    const availableTradingDates = uniqueTradingDates(dailyBars).filter((date) => date < currentTradingDate);
    const completedSessionDates = availableTradingDates.slice(-this.policy.atrReconstructionCompletedRthSessions);
    const includeCurrentSession = ["RTH", "AFTER_HOURS"].includes(evaluationSession);
    const sessionDates = includeCurrentSession
      ? [...completedSessionDates, currentTradingDate]
      : completedSessionDates;

    const sessionReports = [];
    const executionBars = [];
    const cacheHits = [];

    for (const date of sessionDates) {
      const isCurrentSession = date === currentTradingDate;
      let rthMinuteBars;
      const cacheKey = `${normalizedCandidate.symbol}:${date}`;
      if (!isCurrentSession && this.completedSessionCache.has(cacheKey)) {
        rthMinuteBars = clone(this.completedSessionCache.get(cacheKey));
        cacheHits.push(date);
      } else {
        try {
          const window = broadDateWindow(date);
          const minuteBars = await this.marketDataProvider.getMinuteBars(normalizedCandidate.symbol, {
            ...window,
            extendedHours: false,
          });
          rthMinuteBars = selectSessionBars(minuteBars, { session: "RTH", tradingDate: date });
        } catch (error) {
          throw new DssInputAssemblyError(`market-data provider failed for ${date}: ${error?.message || error}`, {
            status: "ERROR",
            reasonCodes: ["MARKET_DATA_PROVIDER_ERROR"],
            stage: "MARKET_DATA",
            details: { date },
          });
        }
      }

      const report = sessionIntegrity(rthMinuteBars, {
        date,
        nowMs,
        isCurrentSession,
        evaluationSession,
      });
      sessionReports.push({
        date,
        isCurrentSession,
        minuteCount: report.minuteCount,
        missingMinutes: report.missingMinutes,
        duplicateMinutes: report.duplicateMinutes,
        completeTwoMinuteBars: report.completeTwoMinuteBars,
      });

      if (!report.valid) {
        throw new DssInputAssemblyError(`RTH source integrity failed for ${date}`, {
          status: "BLOCKED",
          reasonCodes: [isCurrentSession ? "CURRENT_RTH_SOURCE_INTEGRITY_FAILED" : "COMPLETED_RTH_SOURCE_INTEGRITY_FAILED"],
          stage: "MARKET_DATA_INTEGRITY",
          details: sessionReports.at(-1),
        });
      }

      if (!isCurrentSession && report.completeTwoMinuteBars === FULL_RTH_TWO_MINUTE_BARS) {
        this.completedSessionCache.set(cacheKey, deepFreeze(clone(rthMinuteBars)));
      }
      executionBars.push(...report.executionBars);
    }

    let resolvedMetadata = null;
    if (this.instrumentMetadataResolver) {
      try {
        resolvedMetadata = await this.instrumentMetadataResolver(normalizedCandidate.symbol, { quote: clone(quote) });
      } catch (error) {
        throw new DssInputAssemblyError(`instrument metadata resolver failed: ${error?.message || error}`, {
          status: "ERROR",
          reasonCodes: ["INSTRUMENT_METADATA_PROVIDER_ERROR"],
          stage: "INSTRUMENT_METADATA",
        });
      }
    }
    const instrument = normalizeInstrumentMetadata(quote, resolvedMetadata);

    const marketSnapshot = {
      snapshotId,
      provider: text(this.marketDataProvider.source || quote?.source || "UNKNOWN"),
      capturedAt: new Date(nowMs).toISOString(),
      quote: clone(quote),
      executionBars: executionBars.slice().sort((a, b) => Number(a.timestamp) - Number(b.timestamp)),
      sourceIntegrity: {
        sourceTimeframe: "1m",
        aggregateTimeframe: "2m",
        evaluationSession,
        currentTradingDate,
        requiredCompletedRthSessions: this.policy.atrReconstructionCompletedRthSessions,
        completedRthSessionsIncluded: completedSessionDates.length,
        includedSessionDates: sessionDates,
        cacheHits,
        sessions: sessionReports,
      },
    };

    return deepFreeze({
      candidate: normalizedCandidate,
      structuralInvalidationDefinition: clone(structuralInvalidationDefinition),
      structureEvaluation: clone(structureEvaluation),
      marketSnapshot,
      instrument,
      dssPolicy: clone(this.policy),
      calculation: {
        calculatorVersion: DSS_CALCULATOR_VERSION,
      },
    });
  }
}
