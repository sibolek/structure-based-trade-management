import crypto from "node:crypto";
import { dssPolicyForVersion } from "./dss-policy.mjs";
import { calculateEffectiveStop } from "./effective-stop.mjs";
import {
  EASTERN_TIME_ZONE,
  expectedClosedRthMinutes,
  freshness,
  tradingDateKey,
} from "./market-data-provider.mjs";
import {
  ATR_RECONSTRUCTION_COMPLETED_RTH_SESSIONS,
  reconstructWilderAtr,
} from "./wilder-atr.mjs";

export const DSS_EVALUATION_SCHEMA_VERSION = 1;
export const DSS_CALCULATOR_VERSION = "DSS_EFFECTIVE_STOP_V1";
export const DSS_STATUS = Object.freeze({
  VALID: "VALID",
  BLOCKED: "BLOCKED",
  ERROR: "ERROR",
});

const TWO_MINUTES_MS = 120_000;
const VALID_DIRECTIONS = new Set(["LONG", "SHORT"]);

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

function parseTimestamp(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

export function dssInputHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function snapshot(value) {
  return value == null ? value : structuredClone(value);
}

function unique(values) {
  return [...new Set(values)];
}

function easternSession(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (["Sat", "Sun"].includes(fields.weekday)) return "CLOSED";
  const minuteOfDay = Number(fields.hour) * 60 + Number(fields.minute);
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
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(fields.hour) * 60 + Number(fields.minute);
}

class DssContractError extends Error {
  constructor(message, code = "DSS_INTERNAL_CONTRACT_ERROR") {
    super(message);
    this.code = code;
  }
}

function validatePolicyContract(inputPolicy) {
  if (!inputPolicy || typeof inputPolicy !== "object") {
    throw new DssContractError("dssPolicy is required", "DSS_POLICY_CONTRACT_ERROR");
  }

  const policyVersion = Number(inputPolicy.policyVersion);
  let trusted;
  try {
    trusted = dssPolicyForVersion(policyVersion);
  } catch (error) {
    throw new DssContractError(error.message, "DSS_POLICY_CONTRACT_ERROR");
  }

  const fields = [
    "policyId",
    "policyVersion",
    "volatilityMethod",
    "volatilityPeriod",
    "volatilityTimeframe",
    "bufferMultiplier",
    "quoteMaxAgeMs",
    "completedBarPublicationGraceMs",
    "atrReconstructionCompletedRthSessions",
  ];

  for (const field of fields) {
    if (inputPolicy[field] !== trusted[field]) {
      throw new DssContractError(
        `dssPolicy.${field} does not match trusted policy version ${trusted.policyVersion}`,
        "DSS_POLICY_CONTRACT_ERROR",
      );
    }
  }

  return trusted;
}

function candidateSnapshot(candidate) {
  return {
    candidateId: text(candidate?.candidateId),
    sourceId: upper(candidate?.sourceId ?? candidate?.source),
    candidateContractVersion: Number(candidate?.contractVersion),
    candidateContentHash: text(candidate?.candidateContentHash ?? candidate?.contentHash),
    symbol: upper(candidate?.symbol),
    direction: upper(candidate?.direction),
    decisionTimeframe: text(candidate?.decisionTimeframe),
    entryTimeframe: text(candidate?.entryTimeframe),
  };
}

function candidateReasonCodes(candidate) {
  const reasons = [];
  if (!candidate.candidateId) reasons.push("INVALID_CANDIDATE_ID");
  if (!candidate.sourceId) reasons.push("INVALID_SOURCE_ID");
  if (!Number.isInteger(candidate.candidateContractVersion) || candidate.candidateContractVersion < 1) {
    reasons.push("INVALID_CANDIDATE_CONTRACT_VERSION");
  }
  if (!candidate.candidateContentHash) reasons.push("MISSING_CANDIDATE_CONTENT_HASH");
  if (!candidate.symbol) reasons.push("INVALID_SYMBOL");
  if (!VALID_DIRECTIONS.has(candidate.direction)) reasons.push("INVALID_DIRECTION");
  if (candidate.decisionTimeframe !== "5m") reasons.push("UNSUPPORTED_DECISION_TIMEFRAME");
  if (candidate.entryTimeframe !== "2m") reasons.push("UNSUPPORTED_ENTRY_TIMEFRAME");
  return reasons;
}

function structureReasonCodes(definition, evaluation) {
  const reasons = [];
  if (
    !definition
    || typeof definition !== "object"
    || Array.isArray(definition)
    || Object.keys(definition).length === 0
  ) {
    reasons.push("MISSING_STRUCTURAL_INVALIDATION_DEFINITION");
  }

  if (!evaluation || typeof evaluation !== "object") {
    reasons.push("MISSING_STRUCTURE_EVALUATION");
    return unique(reasons);
  }

  if (upper(evaluation.status) !== "VALID") reasons.push("STRUCTURE_EVALUATION_NOT_VALID");
  if (finiteNumber(evaluation.resolvedPrice) === null) reasons.push("INVALID_RESOLVED_STRUCTURAL_PRICE");
  if (
    parseTimestamp(evaluation.evaluatedAt) === null
    || !text(evaluation.evaluationReference)
    || !text(evaluation.evidenceReference)
  ) {
    reasons.push("MISSING_STRUCTURE_PROVENANCE");
  }

  return unique(reasons);
}

function validateBarShape(bar, candidateSymbol, nowMs) {
  const reasons = [];
  const timestamp = finiteNumber(bar?.timestamp);
  const open = finiteNumber(bar?.open);
  const high = finiteNumber(bar?.high);
  const low = finiteNumber(bar?.low);
  const close = finiteNumber(bar?.close);

  if (![timestamp, open, high, low, close].every(Number.isFinite)) {
    reasons.push("INVALID_EXECUTION_BAR");
    return reasons;
  }
  if (high < low || open < low || open > high || close < low || close > high) {
    reasons.push("INVALID_EXECUTION_BAR");
  }
  if (bar?.complete !== true) reasons.push("INCOMPLETE_EXECUTION_BAR");
  if (bar?.timeframe && text(bar.timeframe) !== "2m") reasons.push("INVALID_EXECUTION_BAR_TIMEFRAME");
  if (bar?.symbol && upper(bar.symbol) !== candidateSymbol) reasons.push("EXECUTION_BAR_SYMBOL_MISMATCH");
  if (easternSession(timestamp) !== "RTH") reasons.push("NON_RTH_EXECUTION_BAR");
  if (timestamp + TWO_MINUTES_MS > nowMs) reasons.push("FUTURE_OR_FORMING_EXECUTION_BAR");
  return reasons;
}

function inspectExecutionBars(bars, {
  candidateSymbol,
  nowMs,
  requiredCompletedSessions,
  publicationGraceMs,
} = {}) {
  const reasons = [];
  if (!Array.isArray(bars) || bars.length === 0) {
    return {
      reasons: ["MISSING_EXECUTION_BARS"],
      bars: [],
      currentTradingDate: tradingDateKey(nowMs),
      evaluationSession: easternSession(nowMs),
      completedRthSessionsObserved: 0,
      sessionCount: 0,
    };
  }

  const ordered = bars.slice().sort((a, b) => Number(a?.timestamp) - Number(b?.timestamp));
  for (const bar of ordered) reasons.push(...validateBarShape(bar, candidateSymbol, nowMs));

  const timestamps = ordered.map((bar) => finiteNumber(bar?.timestamp)).filter(Number.isFinite);
  if (new Set(timestamps).size !== timestamps.length) reasons.push("DUPLICATE_EXECUTION_BAR");

  const grouped = new Map();
  for (const bar of ordered) {
    const timestamp = finiteNumber(bar?.timestamp);
    if (timestamp === null) continue;
    const key = tradingDateKey(timestamp);
    if (!key) {
      reasons.push("INVALID_EXECUTION_BAR");
      continue;
    }
    const list = grouped.get(key) || [];
    list.push(bar);
    grouped.set(key, list);
  }

  for (const sessionBars of grouped.values()) {
    const sessionTimestamps = sessionBars.map((bar) => Number(bar.timestamp)).sort((a, b) => a - b);
    for (let index = 1; index < sessionTimestamps.length; index += 1) {
      if (sessionTimestamps[index] - sessionTimestamps[index - 1] !== TWO_MINUTES_MS) {
        reasons.push("MISSING_OR_MISALIGNED_EXECUTION_BAR");
        break;
      }
    }
  }

  const currentTradingDate = tradingDateKey(nowMs);
  const evaluationSession = easternSession(nowMs);
  if (evaluationSession === "CLOSED") reasons.push("UNSUPPORTED_EVALUATION_SESSION");

  const dateKeys = [...grouped.keys()].sort();
  const priorDateKeys = dateKeys.filter((key) => currentTradingDate && key < currentTradingDate);
  if (priorDateKeys.length < requiredCompletedSessions) {
    reasons.push("INSUFFICIENT_ATR_RECONSTRUCTION_SESSIONS");
  }

  const currentBars = (grouped.get(currentTradingDate) || [])
    .slice()
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

  if (currentBars.length > 0 && easternMinuteOfDay(currentBars[0].timestamp) !== 9 * 60 + 30) {
    reasons.push("CURRENT_SESSION_OPEN_BAR_MISSING");
  }

  if (evaluationSession === "RTH") {
    const expectedClosedMinutes = expectedClosedRthMinutes(nowMs);

    if (!Number.isFinite(expectedClosedMinutes) || expectedClosedMinutes < 2 || currentBars.length === 0) {
      reasons.push("CURRENT_SESSION_WARMUP_INCOMPLETE");
    } else {
      const expectedLatestStart = Math.floor(nowMs / TWO_MINUTES_MS) * TWO_MINUTES_MS - TWO_MINUTES_MS;
      const latestTimestamp = Number(currentBars[currentBars.length - 1].timestamp);
      const previousExpectedStart = expectedLatestStart - TWO_MINUTES_MS;
      const publicationBoundary = expectedLatestStart + TWO_MINUTES_MS;
      const publicationDelayMs = nowMs - publicationBoundary;

      if (latestTimestamp === expectedLatestStart) {
        // Current expected completed bar is present.
      } else if (
        latestTimestamp === previousExpectedStart
        && publicationDelayMs >= 0
        && publicationDelayMs <= publicationGraceMs
      ) {
        // During publication grace, retain the previous valid completed-bar ATR.
      } else if (latestTimestamp < expectedLatestStart) {
        reasons.push("EXPECTED_COMPLETED_BAR_MISSING");
      } else {
        reasons.push("UNEXPECTED_EXECUTION_BAR_STATE");
      }
    }
  }

  if (
    evaluationSession === "AFTER_HOURS"
    && currentBars.length > 0
    && easternMinuteOfDay(currentBars[currentBars.length - 1].timestamp) !== 15 * 60 + 58
  ) {
    reasons.push("CURRENT_SESSION_RTH_INCOMPLETE");
  }

  return {
    reasons: unique(reasons),
    bars: ordered,
    currentTradingDate,
    evaluationSession,
    completedRthSessionsObserved: priorDateKeys.length,
    sessionCount: dateKeys.length,
    firstTradingDate: dateKeys[0] || null,
    lastTradingDate: dateKeys[dateKeys.length - 1] || null,
  };
}

function baseResult({
  dssEvaluationId,
  status,
  reasonCodes,
  candidate,
  definition,
  structureEvaluation,
  marketSnapshot,
  instrument,
  policy,
  inputHash,
  evaluatedAt,
  evaluationSession,
  errorMessage = null,
} = {}) {
  return {
    schemaVersion: DSS_EVALUATION_SCHEMA_VERSION,
    dssEvaluationId,
    status,
    reasonCodes: unique(reasonCodes || []),
    candidateId: candidate?.candidateId || null,
    sourceId: candidate?.sourceId || null,
    candidateContractVersion: candidate?.candidateContractVersion ?? null,
    candidateContentHash: candidate?.candidateContentHash || null,
    structuralInvalidationDefinition: snapshot(definition) ?? null,
    structureEvaluation: snapshot(structureEvaluation) ?? null,
    resolvedStructuralInvalidationPrice: finiteNumber(structureEvaluation?.resolvedPrice),
    priorAtrValue: null,
    currentTrueRange: null,
    atrValue: null,
    atrMethod: policy?.volatilityMethod || null,
    atrPeriod: policy?.volatilityPeriod ?? null,
    atrTimeframe: policy?.volatilityTimeframe || null,
    atrSourceSession: "RTH",
    atrReconstructionWindow: null,
    latestCompletedBar: null,
    rawVolatilityBuffer: null,
    rawEffectiveStop: null,
    priceIncrement: finiteNumber(instrument?.priceIncrement),
    roundingDirection: null,
    roundingAdjustment: null,
    effectiveStop: null,
    appliedBuffer: null,
    snapshotId: text(marketSnapshot?.snapshotId) || null,
    provider: text(marketSnapshot?.provider) || null,
    quoteTimestamp: null,
    quoteAgeMs: null,
    policyId: policy?.policyId || null,
    policyVersion: policy?.policyVersion ?? null,
    calculatorVersion: DSS_CALCULATOR_VERSION,
    inputHash,
    evaluatedAt,
    evaluationSession: evaluationSession || null,
    errorMessage,
  };
}

export function evaluateDss(input, {
  nowMs = Date.now(),
  idFactory = () => crypto.randomUUID(),
} = {}) {
  const evaluationTime = finiteNumber(nowMs);
  if (evaluationTime === null) throw new Error("nowMs must be a finite epoch-millisecond timestamp");

  const dssEvaluationId = text(idFactory());
  if (!dssEvaluationId) throw new Error("idFactory must return a non-empty dssEvaluationId");

  const inputValue = input && typeof input === "object" ? input : {};
  const inputHash = dssInputHash(inputValue);
  const evaluatedAt = new Date(evaluationTime).toISOString();
  const candidate = candidateSnapshot(inputValue.candidate);
  const definition = inputValue.structuralInvalidationDefinition;
  const structureEvaluation = inputValue.structureEvaluation;
  const marketSnapshot = inputValue.marketSnapshot;
  const instrument = inputValue.instrument;
  let policy = null;
  let evaluationSession = easternSession(evaluationTime);

  try {
    policy = validatePolicyContract(inputValue.dssPolicy);

    const suppliedCalculatorVersion = text(inputValue.calculation?.calculatorVersion);
    if (suppliedCalculatorVersion !== DSS_CALCULATOR_VERSION) {
      throw new DssContractError(
        `calculation.calculatorVersion must be ${DSS_CALCULATOR_VERSION}`,
        "DSS_CALCULATOR_CONTRACT_ERROR",
      );
    }

    const reasons = [
      ...candidateReasonCodes(candidate),
      ...structureReasonCodes(definition, structureEvaluation),
    ];

    if (!marketSnapshot || typeof marketSnapshot !== "object") {
      reasons.push("MISSING_MARKET_SNAPSHOT");
    } else {
      if (!text(marketSnapshot.snapshotId)) reasons.push("MISSING_MARKET_SNAPSHOT_ID");
      if (!text(marketSnapshot.provider)) reasons.push("MISSING_MARKET_PROVIDER");
      if (parseTimestamp(marketSnapshot.capturedAt) === null) reasons.push("INVALID_MARKET_SNAPSHOT_TIMESTAMP");
    }

    const quote = marketSnapshot?.quote;
    const quoteTimestamp = quote?.asOf ?? quote?.quoteTime ?? quote?.tradeTime;
    const quoteFreshness = freshness(quoteTimestamp, {
      nowMs: evaluationTime,
      maxAgeMs: policy.quoteMaxAgeMs,
    });
    if (quoteFreshness.isStale) reasons.push("STALE_OR_INVALID_QUOTE");
    if (quote?.symbol && upper(quote.symbol) !== candidate.symbol) reasons.push("QUOTE_SYMBOL_MISMATCH");

    const priceIncrement = finiteNumber(instrument?.priceIncrement);
    if (priceIncrement === null || priceIncrement <= 0) reasons.push("INVALID_PRICE_INCREMENT");

    const barInspection = inspectExecutionBars(marketSnapshot?.executionBars, {
      candidateSymbol: candidate.symbol,
      nowMs: evaluationTime,
      requiredCompletedSessions: policy.atrReconstructionCompletedRthSessions,
      publicationGraceMs: policy.completedBarPublicationGraceMs,
    });
    reasons.push(...barInspection.reasons);
    evaluationSession = barInspection.evaluationSession;

    if (reasons.length) {
      const blocked = baseResult({
        dssEvaluationId,
        status: DSS_STATUS.BLOCKED,
        reasonCodes: reasons,
        candidate,
        definition,
        structureEvaluation,
        marketSnapshot,
        instrument,
        policy,
        inputHash,
        evaluatedAt,
        evaluationSession,
      });
      blocked.quoteTimestamp = quoteFreshness.asOf;
      blocked.quoteAgeMs = quoteFreshness.ageMs;
      return deepFreeze(blocked);
    }

    const atr = reconstructWilderAtr(barInspection.bars, {
      period: policy.volatilityPeriod,
      requireRth: true,
    });

    if (!Number.isFinite(atr.currentAtr)) {
      const blocked = baseResult({
        dssEvaluationId,
        status: DSS_STATUS.BLOCKED,
        reasonCodes: ["INSUFFICIENT_ATR_HISTORY"],
        candidate,
        definition,
        structureEvaluation,
        marketSnapshot,
        instrument,
        policy,
        inputHash,
        evaluatedAt,
        evaluationSession,
      });
      blocked.quoteTimestamp = quoteFreshness.asOf;
      blocked.quoteAgeMs = quoteFreshness.ageMs;
      return deepFreeze(blocked);
    }

    const priorAtrValue = atr.atrSeries.length >= 2
      ? atr.atrSeries[atr.atrSeries.length - 2].atr
      : null;
    const currentTrueRange = atr.trueRanges[atr.trueRanges.length - 1] ?? null;
    const latestCompletedBar = barInspection.bars[barInspection.bars.length - 1];

    const stop = calculateEffectiveStop({
      direction: candidate.direction,
      structuralInvalidationPrice: structureEvaluation.resolvedPrice,
      atrValue: atr.currentAtr,
      priceIncrement,
      policyVersion: policy.policyVersion,
    });

    const valid = baseResult({
      dssEvaluationId,
      status: DSS_STATUS.VALID,
      reasonCodes: [],
      candidate,
      definition,
      structureEvaluation,
      marketSnapshot,
      instrument,
      policy,
      inputHash,
      evaluatedAt,
      evaluationSession,
    });

    Object.assign(valid, {
      priorAtrValue,
      currentTrueRange,
      atrValue: atr.currentAtr,
      atrMethod: atr.method,
      atrPeriod: atr.period,
      atrTimeframe: policy.volatilityTimeframe,
      atrSourceSession: "RTH",
      atrReconstructionWindow: {
        requiredCompletedRthSessions: ATR_RECONSTRUCTION_COMPLETED_RTH_SESSIONS,
        completedRthSessionsObserved: barInspection.completedRthSessionsObserved,
        sessionCount: barInspection.sessionCount,
        firstTradingDate: barInspection.firstTradingDate,
        lastTradingDate: barInspection.lastTradingDate,
        observationCount: atr.observationCount,
      },
      latestCompletedBar: snapshot(latestCompletedBar),
      rawVolatilityBuffer: stop.rawVolatilityBuffer,
      rawEffectiveStop: stop.rawEffectiveStop,
      priceIncrement: stop.priceIncrement,
      roundingDirection: stop.roundingDirection,
      roundingAdjustment: stop.roundingAdjustment,
      effectiveStop: stop.effectiveStop,
      appliedBuffer: stop.appliedBuffer,
      quoteTimestamp: quoteFreshness.asOf,
      quoteAgeMs: quoteFreshness.ageMs,
      policyId: stop.policyId,
      policyVersion: stop.policyVersion,
      calculatorVersion: DSS_CALCULATOR_VERSION,
    });

    return deepFreeze(valid);
  } catch (error) {
    const errored = baseResult({
      dssEvaluationId,
      status: DSS_STATUS.ERROR,
      reasonCodes: [error?.code || "INTERNAL_DSS_ERROR"],
      candidate,
      definition,
      structureEvaluation,
      marketSnapshot,
      instrument,
      policy,
      inputHash,
      evaluatedAt,
      evaluationSession,
      errorMessage: error?.message || String(error),
    });
    return deepFreeze(errored);
  }
}
