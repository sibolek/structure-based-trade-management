import crypto from "node:crypto";
import { canonicalLifecycleState } from "./pretrade-state.mjs";
import { currentDssEvaluationForArmHandoff } from "./arm-dss-handoff.mjs";
import { resolveExpectedEntry } from "./expected-entry-resolver.mjs";
import { assessAccountRiskSnapshot } from "./account-risk-provider.mjs";
import { calculateRiskSizing } from "./risk-sizing-calculator.mjs";
import { buildRiskEvaluation } from "./risk-evaluation.mjs";
import { RISK_SIZING_POLICY_VERSION } from "./risk-sizing-policy.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function serviceError(message, code, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function blocked(reasonCode, partial = {}) {
  return immutable({
    ...partial,
    status: "BLOCKED",
    reasonCodes: [reasonCode],
  });
}

function errored(reasonCode = "INTERNAL_ERROR", partial = {}) {
  return immutable({
    ...partial,
    status: "ERROR",
    reasonCodes: [reasonCode],
  });
}

function findPersistedCandidate(state, { sourceId, candidateId, contractVersion }) {
  const candidates = Array.isArray(state?.candidates) ? state.candidates : [];
  const candidate = candidates.find((item) => (
    text(item?.candidateId) === candidateId
    && Number(item?.contractVersion) === contractVersion
  ));
  if (!candidate) {
    throw serviceError(
      `candidate ${sourceId}:${candidateId} v${contractVersion} was not found`,
      "RISK_SIZING_PERMISSION_CANDIDATE_NOT_FOUND",
    );
  }
  if (upper(candidate.source) !== sourceId) {
    throw serviceError(
      `candidate ${candidateId} v${contractVersion} belongs to source ${upper(candidate.source)}, not ${sourceId}`,
      "RISK_SIZING_PERMISSION_SOURCE_MISMATCH",
    );
  }
  return candidate;
}

function requestIdentity({ sourceId, candidateId, contractVersion } = {}) {
  const identity = {
    sourceId: upper(sourceId),
    candidateId: text(candidateId),
    contractVersion: Number(contractVersion),
  };
  if (!identity.sourceId || !identity.candidateId || !Number.isInteger(identity.contractVersion) || identity.contractVersion < 1) {
    throw serviceError(
      "risk sizing evaluation requires sourceId, candidateId, and integer contractVersion >= 1",
      "INVALID_RISK_SIZING_PERMISSION_CANDIDATE_IDENTITY",
    );
  }
  return identity;
}

function normalizedStatus(value) {
  return upper(value?.status);
}

function allValid(...components) {
  return components.every((component) => normalizedStatus(component) === "VALID");
}

function permissionResult(evaluation) {
  const status = upper(evaluation?.status);
  const calculation = evaluation?.calculation && typeof evaluation.calculation === "object"
    ? evaluation.calculation
    : null;
  return immutable({
    riskEvaluationId: text(evaluation?.riskEvaluationId),
    dssEvaluationId: text(evaluation?.dss?.dssEvaluationId),
    status,
    maxAffordableQuantity: status === "VALID"
      ? Number(calculation?.finalQuantity)
      : status === "NO_AFFORDABLE_SIZE"
        ? 0
        : null,
    plannedDollarRisk: calculation?.plannedDollarRisk ?? null,
    plannedRiskFraction: calculation?.plannedRiskFraction ?? null,
    reasonCodes: Array.isArray(evaluation?.reasonCodes) ? [...evaluation.reasonCodes] : [],
  });
}

async function settledValue(promise, onRejected) {
  try {
    return await promise;
  } catch (error) {
    return onRejected(error);
  }
}

export class RiskSizingPermissionService {
  constructor({
    store,
    marketDataProvider,
    accountRiskProvider,
    instrumentSizingMetadataProvider,
    riskEvaluationRepository,
    now = () => Date.now(),
    idFactory = () => crypto.randomUUID(),
    policyVersion = RISK_SIZING_POLICY_VERSION,
  } = {}) {
    if (!store || typeof store.snapshot !== "function" || typeof store.currentDssEvaluationForRiskHandoff !== "function") {
      throw new Error("RiskSizingPermissionService requires a pre-trade store with snapshot() and currentDssEvaluationForRiskHandoff()");
    }
    if (!marketDataProvider || typeof marketDataProvider.getQuote !== "function") {
      throw new Error("RiskSizingPermissionService requires marketDataProvider.getQuote()");
    }
    if (!accountRiskProvider || typeof accountRiskProvider.getSnapshot !== "function") {
      throw new Error("RiskSizingPermissionService requires accountRiskProvider.getSnapshot()");
    }
    if (!instrumentSizingMetadataProvider || typeof instrumentSizingMetadataProvider.getInstrumentSizingMetadata !== "function") {
      throw new Error("RiskSizingPermissionService requires instrumentSizingMetadataProvider.getInstrumentSizingMetadata()");
    }
    if (!riskEvaluationRepository || typeof riskEvaluationRepository.record !== "function") {
      throw new Error("RiskSizingPermissionService requires a risk evaluation repository with record()");
    }
    if (typeof now !== "function") throw new Error("now must be a function");
    if (typeof idFactory !== "function") throw new Error("idFactory must be a function");

    this.store = store;
    this.marketDataProvider = marketDataProvider;
    this.accountRiskProvider = accountRiskProvider;
    this.instrumentSizingMetadataProvider = instrumentSizingMetadataProvider;
    this.riskEvaluationRepository = riskEvaluationRepository;
    this.now = now;
    this.idFactory = idFactory;
    this.policyVersion = Number(policyVersion);
  }

  async evaluate({
    sourceId,
    candidateId,
    contractVersion,
    accountId,
    entryMode,
    triggerPrice = null,
  } = {}) {
    const identity = requestIdentity({ sourceId, candidateId, contractVersion });
    const state = this.store.snapshot();
    const candidate = findPersistedCandidate(state, identity);
    const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    if (lifecycleState !== "PERMISSION_EVALUATING") {
      throw serviceError(
        `risk sizing permission evaluation is not allowed while candidate is ${lifecycleState}`,
        "RISK_SIZING_PERMISSION_NOT_ALLOWED_IN_STATE",
      );
    }

    const dssHandoff = this.store.currentDssEvaluationForRiskHandoff(
      identity.candidateId,
      identity.contractVersion,
    );

    return this.#evaluateWithHandoff({
      candidate,
      dssHandoff,
      accountId,
      entryMode,
      triggerPrice,
    });
  }

  async evaluateForArm({
    sourceId,
    candidateId,
    contractVersion,
    accountId,
    entryMode,
    triggerPrice = null,
  } = {}) {
    const identity = requestIdentity({ sourceId, candidateId, contractVersion });
    const state = this.store.snapshot();
    const candidate = findPersistedCandidate(state, identity);
    const lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    if (!["READY", "CAUTION"].includes(lifecycleState)) {
      throw serviceError(
        `ARM-time risk sizing evaluation is not allowed while candidate is ${lifecycleState}`,
        "RISK_SIZING_ARM_REFRESH_NOT_ALLOWED_IN_STATE",
      );
    }

    // ARM never reuses a prior Phase 4 evaluation. First prove that the exact
    // Phase 3 DSS identity is still VALID and non-stale in READY/CAUTION, then
    // obtain fresh Phase 4 inputs and persist a brand-new riskEvaluationId.
    const dssHandoff = currentDssEvaluationForArmHandoff(
      this.store,
      identity.candidateId,
      identity.contractVersion,
    );

    return this.#evaluateWithHandoff({
      candidate,
      dssHandoff,
      accountId,
      entryMode,
      triggerPrice,
    });
  }

  async #evaluateWithHandoff({ candidate, dssHandoff, accountId, entryMode, triggerPrice }) {
    const effectiveStop = dssHandoff?.evaluation?.effectiveStop;

    const quotePromise = settledValue(
      this.marketDataProvider.getQuote(candidate.symbol),
      () => null,
    );
    const accountPromise = settledValue(
      this.accountRiskProvider.getSnapshot(text(accountId)),
      () => errored("INTERNAL_ERROR"),
    );
    const instrumentPromise = settledValue(
      this.instrumentSizingMetadataProvider.getInstrumentSizingMetadata(candidate.symbol),
      () => errored("INTERNAL_ERROR"),
    );

    const [quote, rawAccountResult, instrumentResult] = await Promise.all([
      quotePromise,
      accountPromise,
      instrumentPromise,
    ]);

    const evaluatedAtMs = finiteTimestamp(this.now());
    if (evaluatedAtMs === null) {
      throw serviceError("risk sizing service clock returned an invalid timestamp", "RISK_SIZING_PERMISSION_CLOCK_INVALID");
    }

    let entryResult;
    if (!quote || typeof quote !== "object") {
      entryResult = blocked("QUOTE_UNAVAILABLE", {
        direction: upper(candidate.direction),
        entryMode: upper(entryMode) || null,
      });
    } else {
      try {
        entryResult = immutable(resolveExpectedEntry({
          direction: candidate.direction,
          entryMode,
          triggerPrice,
          effectiveStop,
          quote,
          nowMs: evaluatedAtMs,
          policyVersion: this.policyVersion,
        }));
      } catch {
        entryResult = errored("INTERNAL_ERROR");
      }
    }

    let accountResult = rawAccountResult;
    if (normalizedStatus(rawAccountResult) === "VALID") {
      try {
        accountResult = assessAccountRiskSnapshot(rawAccountResult.snapshot, {
          nowMs: evaluatedAtMs,
          policyVersion: this.policyVersion,
        });
      } catch {
        accountResult = errored("INTERNAL_ERROR");
      }
    }

    let calculationResult = null;
    if (allValid(entryResult, accountResult, instrumentResult)) {
      try {
        calculationResult = immutable(calculateRiskSizing({
          direction: candidate.direction,
          currentExpectedEntry: entryResult.currentExpectedEntry,
          effectiveStop,
          accountEquity: accountResult.snapshot.accountEquity,
          accountCurrency: accountResult.snapshot.currency,
          instrument: instrumentResult,
          policyVersion: this.policyVersion,
        }));
      } catch {
        calculationResult = errored("INTERNAL_ERROR");
      }
    }

    const riskEvaluationId = text(this.idFactory());
    if (!riskEvaluationId) {
      throw serviceError("idFactory returned an empty riskEvaluationId", "RISK_SIZING_PERMISSION_ID_INVALID");
    }

    let evaluation;
    try {
      evaluation = buildRiskEvaluation({
        riskEvaluationId,
        evaluatedAt: evaluatedAtMs,
        candidate,
        dssHandoff,
        entryResult,
        accountResult,
        instrumentResult,
        calculationResult,
        policyVersion: this.policyVersion,
      });
    } catch (error) {
      throw serviceError(
        `risk evaluation construction failed: ${error?.message || String(error)}`,
        "RISK_SIZING_PERMISSION_EVALUATION_BUILD_FAILED",
        error,
      );
    }

    try {
      this.riskEvaluationRepository.record(evaluation);
    } catch (error) {
      throw serviceError(
        `risk evaluation persistence failed: ${error?.message || String(error)}`,
        "RISK_SIZING_PERMISSION_PERSISTENCE_ERROR",
        error,
      );
    }

    return permissionResult(evaluation);
  }
}
