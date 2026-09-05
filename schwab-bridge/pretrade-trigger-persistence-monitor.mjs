import crypto from "node:crypto";
import { assertCanonicalCandidateIntegrity, candidateValidityStatusAt } from "./pretrade-candidate-contract.mjs";
import { assertTriggerContract } from "./pretrade-trigger-contract.mjs";
import { canonicalLifecycleState } from "./pretrade-state.mjs";

const PERMISSION_DEPENDENT_STATES = new Set(["PERMISSION_EVALUATING", "READY", "CAUTION"]);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stable(value[key]);
      return result;
    }, {});
  }
  return value;
}

function evidenceHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function comparison(operator, left, right) {
  if (operator === "GT") return left > right;
  if (operator === "GTE") return left >= right;
  if (operator === "LT") return left < right;
  if (operator === "LTE") return left <= right;
  return false;
}

function error(message, code, details = null) {
  const result = new Error(message);
  result.code = code;
  if (details) result.details = details;
  return result;
}

function normalizeEvidence(input, candidate) {
  const evidence = input && typeof input === "object" ? input : {};
  const type = upper(evidence.type);
  const evidenceId = text(evidence.evidenceId);
  const observedAt = timestamp(evidence.observedAt);
  const symbol = upper(evidence.symbol || candidate.symbol);
  if (!evidenceId) throw error("trigger persistence evidenceId is required", "TRIGGER_EVIDENCE_ID_REQUIRED");
  if (!observedAt) throw error("trigger persistence observedAt is invalid", "INVALID_TRIGGER_EVIDENCE_TIME");
  if (symbol !== upper(candidate.symbol)) throw error("trigger persistence symbol mismatch", "TRIGGER_EVIDENCE_SYMBOL_MISMATCH");

  if (type === "QUOTE_EVENT") {
    return {
      type,
      evidenceId,
      observedAt,
      symbol,
      bid: finiteNumber(evidence.bid),
      ask: finiteNumber(evidence.ask),
      last: finiteNumber(evidence.last),
    };
  }
  if (type === "BAR_CLOSE") {
    const barTimestamp = timestamp(evidence.barTimestamp);
    const timeframe = text(evidence.timeframe);
    const close = finiteNumber(evidence.close);
    if (!barTimestamp || !timeframe || close === null) throw error("invalid BAR_CLOSE persistence evidence", "INVALID_TRIGGER_BAR_EVIDENCE");
    if (evidence.complete === false || evidence.closed === false) throw error("forming bar cannot evaluate trigger persistence", "INCOMPLETE_TRIGGER_BAR_EVIDENCE");
    return { type, evidenceId, observedAt, symbol, barTimestamp, timeframe, close };
  }
  throw error("unsupported trigger persistence evidence type", "UNSUPPORTED_TRIGGER_EVIDENCE");
}

export class PreTradeTriggerPersistenceMonitor {
  constructor({ store, persistenceAuthority, clock = nowIso } = {}) {
    if (!store || typeof store.save !== "function") throw error("trigger persistence monitor requires store", "INVALID_TRIGGER_STORE");
    if (!persistenceAuthority || typeof persistenceAuthority.expireSatisfaction !== "function") {
      throw error("trigger persistence monitor requires persistence authority", "INVALID_TRIGGER_PERSISTENCE_AUTHORITY");
    }
    this.store = store;
    this.persistenceAuthority = persistenceAuthority;
    this.clock = clock;
  }

  processEvidence({ candidateId, contractVersion, expectedState, expectedRevision, evidence: rawEvidence } = {}) {
    const candidate = this.#findCandidate(candidateId, contractVersion);
    assertCanonicalCandidateIntegrity(candidate);
    const contract = assertTriggerContract(candidate.trigger);
    candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);

    if (!PERMISSION_DEPENDENT_STATES.has(candidate.lifecycleState)) {
      throw error(`trigger persistence is not active in ${candidate.lifecycleState}`, "TRIGGER_PERSISTENCE_NOT_ACTIVE_IN_STATE");
    }
    if (expectedState !== undefined && canonicalLifecycleState(expectedState) !== candidate.lifecycleState) {
      throw error("trigger persistence expected lifecycle state is stale", "STALE_LIFECYCLE_STATE");
    }
    if (expectedRevision !== undefined && Number(expectedRevision) !== Number(candidate.stateRevision || 0)) {
      throw error("trigger persistence expected stateRevision is stale", "STALE_STATE_REVISION");
    }
    if (!candidate.triggerSatisfaction || candidate.triggerSatisfaction.authority !== "PRETRADE_TRIGGER_ENGINE") {
      throw error("authoritative trigger satisfaction is required", "TRIGGER_SATISFACTION_NOT_AUTHORITATIVE");
    }

    const validity = candidateValidityStatusAt(candidate, this.clock());
    if (validity.status !== "VALID") throw error(`candidate validity is ${validity.status}`, "TRIGGER_CANDIDATE_NOT_VALID", validity);

    const persistence = contract.persistence;
    if (persistence.type === "ONE_SHOT") {
      return { status: "STILL_VALID", reason: "ONE_SHOT", lifecycleState: candidate.lifecycleState, stateRevision: candidate.stateRevision };
    }

    const evidence = normalizeEvidence(rawEvidence, candidate);
    const hash = evidenceHash(evidence);
    const satisfiedAt = timestamp(candidate.triggerSatisfaction.evidenceTimestamp);
    const evidenceTime = evidence.type === "BAR_CLOSE" ? evidence.barTimestamp : evidence.observedAt;
    if (!satisfiedAt) throw error("trigger satisfaction evidence timestamp is missing", "TRIGGER_SATISFACTION_NOT_AUTHORITATIVE");
    if (Date.parse(evidenceTime) <= Date.parse(satisfiedAt)) {
      return { status: "IGNORED_STALE", evidenceId: evidence.evidenceId, lifecycleState: candidate.lifecycleState, stateRevision: candidate.stateRevision };
    }

    if (persistence.type === "CONDITION_HELD") {
      if (evidence.type !== "QUOTE_EVENT") {
        return { status: "IGNORED_WRONG_OBSERVATION", evidenceId: evidence.evidenceId, lifecycleState: candidate.lifecycleState, stateRevision: candidate.stateRevision };
      }
      const node = contract.satisfaction;
      const observed = finiteNumber(evidence[node.side.toLowerCase()]);
      if (observed === null) throw error(`QUOTE_EVENT is missing ${node.side}`, "TRIGGER_QUOTE_FIELD_UNAVAILABLE");
      if (comparison(node.operator, observed, node.value)) {
        return { status: "STILL_VALID", reason: "CONDITION_HELD", evidenceId: evidence.evidenceId, lifecycleState: candidate.lifecycleState, stateRevision: candidate.stateRevision };
      }
      const transition = this.persistenceAuthority.expireSatisfaction({
        candidateId,
        contractVersion,
        expectedState: candidate.lifecycleState,
        expectedRevision: candidate.stateRevision,
        evidenceId: evidence.evidenceId,
        evidenceTimestamp: evidenceTime,
        evidenceHash: hash,
        reasonCode: "CONDITION_NO_LONGER_HELD",
      });
      return { status: "EXPIRED_TO_TRIGGER_EVALUATING", reason: "CONDITION_NO_LONGER_HELD", transition };
    }

    if (persistence.type === "BAR_BOUND") {
      if (evidence.type !== "BAR_CLOSE" || text(evidence.timeframe) !== text(persistence.timeframe)) {
        return { status: "IGNORED_WRONG_OBSERVATION", evidenceId: evidence.evidenceId, lifecycleState: candidate.lifecycleState, stateRevision: candidate.stateRevision };
      }
      const transition = this.persistenceAuthority.expireSatisfaction({
        candidateId,
        contractVersion,
        expectedState: candidate.lifecycleState,
        expectedRevision: candidate.stateRevision,
        evidenceId: evidence.evidenceId,
        evidenceTimestamp: evidenceTime,
        evidenceHash: hash,
        reasonCode: "BAR_BOUND_SATISFACTION_EXPIRED",
      });
      return { status: "EXPIRED_TO_TRIGGER_EVALUATING", reason: "BAR_BOUND_SATISFACTION_EXPIRED", transition };
    }

    throw error("unsupported trigger persistence mode", "INVALID_TRIGGER_CONTRACT");
  }

  #findCandidate(candidateId, contractVersion) {
    const candidate = this.store.state?.candidates?.find((item) => (
      text(item?.candidateId) === text(candidateId)
      && Number(item?.contractVersion) === Number(contractVersion)
    ));
    if (!candidate) throw error(`candidate ${candidateId} v${contractVersion} not found`, "CANDIDATE_NOT_FOUND");
    return candidate;
  }
}
