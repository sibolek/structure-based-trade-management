import crypto from "node:crypto";
import { assertCanonicalCandidateIntegrity, candidateValidityStatusAt } from "./pretrade-candidate-contract.mjs";
import { assertTriggerContract } from "./pretrade-trigger-contract.mjs";
import { canonicalLifecycleState, PRETRADE_TRIGGER_EVALUATING } from "./pretrade-state.mjs";

export const PRETRADE_TRIGGER_ENGINE_AUTHORITY = "PRETRADE_TRIGGER_ENGINE";
export const PRETRADE_TRIGGER_ENGINE_VERSION = 1;

const TRIGGER_ACTIVE_STATES = new Set(["WAITING", PRETRADE_TRIGGER_EVALUATING]);
const OBSERVATION_TYPES = new Set(["QUOTE_EVENT", "BAR_CLOSE", "MANUAL_EVENT"]);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
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

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function error(message, code, details = null) {
  const result = new Error(message);
  result.code = code;
  if (details) result.details = details;
  return result;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function comparison(operator, left, right) {
  if (operator === "GT") return left > right;
  if (operator === "GTE") return left >= right;
  if (operator === "LT") return left < right;
  if (operator === "LTE") return left <= right;
  return false;
}

function evidenceClock(evidence) {
  if (evidence.type === "BAR_CLOSE") return timestamp(evidence.barTimestamp || evidence.observedAt);
  return timestamp(evidence.observedAt);
}

function normalizeEvidence(input, candidate) {
  const evidence = input && typeof input === "object" ? input : {};
  const type = upper(evidence.type);
  const evidenceId = text(evidence.evidenceId);
  const observedAt = timestamp(evidence.observedAt);
  const symbol = upper(evidence.symbol || candidate.symbol);

  if (!OBSERVATION_TYPES.has(type)) throw error("unsupported trigger evidence type", "UNSUPPORTED_TRIGGER_EVIDENCE");
  if (!evidenceId) throw error("trigger evidenceId is required", "TRIGGER_EVIDENCE_ID_REQUIRED");
  if (!observedAt) throw error("trigger observedAt must be an absolute timestamp", "INVALID_TRIGGER_EVIDENCE_TIME");
  if (symbol !== upper(candidate.symbol)) throw error("trigger evidence symbol does not match candidate", "TRIGGER_EVIDENCE_SYMBOL_MISMATCH");

  if (type === "QUOTE_EVENT") {
    return {
      type,
      evidenceId,
      observedAt,
      symbol,
      bid: finiteNumber(evidence.bid),
      ask: finiteNumber(evidence.ask),
      last: finiteNumber(evidence.last),
      source: text(evidence.source) || null,
      sourceEventId: text(evidence.sourceEventId) || null,
    };
  }

  if (type === "BAR_CLOSE") {
    const barTimestamp = timestamp(evidence.barTimestamp);
    const timeframe = text(evidence.timeframe);
    const close = finiteNumber(evidence.close);
    if (!barTimestamp) throw error("BAR_CLOSE requires barTimestamp", "INVALID_TRIGGER_BAR_EVIDENCE");
    if (!timeframe) throw error("BAR_CLOSE requires timeframe", "INVALID_TRIGGER_BAR_EVIDENCE");
    if (close === null) throw error("BAR_CLOSE requires numeric close", "INVALID_TRIGGER_BAR_EVIDENCE");
    if (evidence.complete === false || evidence.closed === false) {
      throw error("forming/incomplete bar cannot satisfy trigger", "INCOMPLETE_TRIGGER_BAR_EVIDENCE");
    }
    return { type, evidenceId, observedAt, symbol, barTimestamp, timeframe, close, source: text(evidence.source) || null };
  }

  const nodeId = text(evidence.nodeId);
  if (!nodeId) throw error("MANUAL_EVENT requires nodeId", "INVALID_MANUAL_TRIGGER_EVIDENCE");
  if (text(evidence.candidateId) && text(evidence.candidateId) !== text(candidate.candidateId)) {
    throw error("manual trigger candidateId mismatch", "TRIGGER_EVIDENCE_IDENTITY_MISMATCH");
  }
  if (evidence.contractVersion !== undefined && Number(evidence.contractVersion) !== Number(candidate.contractVersion)) {
    throw error("manual trigger contractVersion mismatch", "TRIGGER_EVIDENCE_IDENTITY_MISMATCH");
  }
  return {
    type,
    evidenceId,
    observedAt,
    symbol,
    nodeId,
    confirmed: evidence.confirmed === true,
    actor: text(evidence.actor) || "OPERATOR",
    note: text(evidence.note) || null,
  };
}

function emptyRuntime(candidate, contract) {
  return {
    authority: PRETRADE_TRIGGER_ENGINE_AUTHORITY,
    engineVersion: PRETRADE_TRIGGER_ENGINE_VERSION,
    evaluatorVersion: contract.evaluatorVersion,
    candidateId: candidate.candidateId,
    contractVersion: candidate.contractVersion,
    candidateContentHash: candidate.contentHash,
    nodeStates: {},
    consumedEvidence: {},
    lastEvidenceTimeByType: {},
    lastProcessedAt: null,
    satisfaction: null,
  };
}

function ensureRuntime(candidate, contract) {
  const existing = candidate.triggerRuntime;
  if (!existing) return emptyRuntime(candidate, contract);
  if (
    existing.authority !== PRETRADE_TRIGGER_ENGINE_AUTHORITY
    || Number(existing.engineVersion) !== PRETRADE_TRIGGER_ENGINE_VERSION
    || Number(existing.evaluatorVersion) !== Number(contract.evaluatorVersion)
    || text(existing.candidateId) !== text(candidate.candidateId)
    || Number(existing.contractVersion) !== Number(candidate.contractVersion)
    || text(existing.candidateContentHash) !== text(candidate.contentHash)
  ) {
    throw error("persisted trigger runtime is incompatible with candidate/evaluator authority", "TRIGGER_RUNTIME_RECONCILIATION_REQUIRED");
  }
  if (!existing.nodeStates || typeof existing.nodeStates !== "object") existing.nodeStates = {};
  if (!existing.consumedEvidence || typeof existing.consumedEvidence !== "object") existing.consumedEvidence = {};
  if (!existing.lastEvidenceTimeByType || typeof existing.lastEvidenceTimeByType !== "object") existing.lastEvidenceTimeByType = {};
  return existing;
}

function evaluateLeaf(node, evidence, runtime) {
  if (node.type === "MANUAL_CONFIRMATION") {
    if (evidence.type !== "MANUAL_EVENT" || evidence.nodeId !== node.nodeId) return { applicable: false, matched: runtime.nodeStates[node.nodeId]?.matched === true };
    const matched = evidence.confirmed === true;
    runtime.nodeStates[node.nodeId] = { matched, evidenceId: evidence.evidenceId, evidenceTime: evidence.observedAt };
    return { applicable: true, matched };
  }

  if (node.type === "QUOTE_COMPARISON") {
    if (evidence.type !== "QUOTE_EVENT") return { applicable: false, matched: runtime.nodeStates[node.nodeId]?.matched === true };
    const left = finiteNumber(evidence[node.side.toLowerCase()]);
    if (left === null) throw error(`QUOTE_EVENT is missing ${node.side}`, "TRIGGER_QUOTE_FIELD_UNAVAILABLE");
    const matched = comparison(node.operator, left, node.value);
    runtime.nodeStates[node.nodeId] = { matched, evidenceId: evidence.evidenceId, evidenceTime: evidence.observedAt, observedValue: left };
    return { applicable: true, matched };
  }

  if (node.type === "BAR_CLOSE_COMPARISON") {
    if (evidence.type !== "BAR_CLOSE" || text(evidence.timeframe) !== text(node.timeframe)) {
      return { applicable: false, matched: runtime.nodeStates[node.nodeId]?.matched === true };
    }
    const matched = comparison(node.operator, evidence.close, node.value);
    runtime.nodeStates[node.nodeId] = {
      matched,
      evidenceId: evidence.evidenceId,
      evidenceTime: evidence.barTimestamp,
      observedValue: evidence.close,
      timeframe: evidence.timeframe,
    };
    return { applicable: true, matched };
  }

  throw error(`unsupported trigger node ${node.type}`, "UNSUPPORTED_TRIGGER_NODE");
}

function evaluateNode(node, evidence, runtime) {
  if (node.type !== "ALL_OF" && node.type !== "ANY_OF") return evaluateLeaf(node, evidence, runtime);
  let applicable = false;
  const childResults = [];
  for (const child of node.children || []) {
    const result = evaluateNode(child, evidence, runtime);
    applicable ||= result.applicable;
    childResults.push(result);
  }
  const matched = node.type === "ALL_OF"
    ? childResults.every((result) => result.matched)
    : childResults.some((result) => result.matched);
  runtime.nodeStates[node.nodeId] = { matched, evidenceId: evidence.evidenceId, evidenceTime: evidenceClock(evidence) };
  return { applicable, matched };
}

function prepareJournal(candidate) {
  if (!candidate.lifecycleJournal || typeof candidate.lifecycleJournal !== "object") {
    candidate.lifecycleJournal = { events: [], operations: [] };
  }
  if (!Array.isArray(candidate.lifecycleJournal.events)) candidate.lifecycleJournal.events = [];
  if (!Array.isArray(candidate.lifecycleJournal.operations)) candidate.lifecycleJournal.operations = [];
}

export class PreTradeTriggerEngine {
  constructor({ store, lifecycleCoordinator, clock = nowIso, idFactory = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store.save !== "function") throw error("trigger engine requires PRETRADE store", "INVALID_TRIGGER_STORE");
    if (!lifecycleCoordinator || typeof lifecycleCoordinator.activateCandidate !== "function" || typeof lifecycleCoordinator.beginPermission !== "function") {
      throw error("trigger engine requires lifecycle coordinator", "INVALID_TRIGGER_LIFECYCLE_COORDINATOR");
    }
    this.store = store;
    this.lifecycleCoordinator = lifecycleCoordinator;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  processEvidence({ candidateId, contractVersion, expectedState, expectedRevision, evidence: rawEvidence } = {}) {
    const candidate = this.#findCandidate(candidateId, contractVersion);
    assertCanonicalCandidateIntegrity(candidate);
    const contract = assertTriggerContract(candidate.trigger);
    const at = this.clock();
    const validity = candidateValidityStatusAt(candidate, at);
    if (validity.status !== "VALID") {
      throw error(`candidate validity is ${validity.status}`, "TRIGGER_CANDIDATE_NOT_VALID", validity);
    }

    candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    if (!TRIGGER_ACTIVE_STATES.has(candidate.lifecycleState)) {
      throw error(`trigger evidence cannot advance candidate in ${candidate.lifecycleState}`, "TRIGGER_NOT_ACTIVE_IN_STATE");
    }
    if (expectedState !== undefined && canonicalLifecycleState(expectedState) !== candidate.lifecycleState) {
      throw error("trigger expected lifecycle state is stale", "STALE_LIFECYCLE_STATE");
    }
    if (expectedRevision !== undefined && Number(expectedRevision) !== Number(candidate.stateRevision || 0)) {
      throw error("trigger expected stateRevision is stale", "STALE_STATE_REVISION");
    }

    const evidence = normalizeEvidence(rawEvidence, candidate);
    const runtime = ensureRuntime(candidate, contract);
    const prior = runtime.consumedEvidence[evidence.evidenceId];
    if (prior) {
      if (prior.evidenceHash !== hash(evidence)) throw error("evidenceId already used with different payload", "TRIGGER_EVIDENCE_ID_CONFLICT");
      return this.#completeTransition(candidate, contract, runtime, clone(prior.result), true);
    }

    const evidenceTime = evidenceClock(evidence);
    const lastEvidenceTime = runtime.lastEvidenceTimeByType[evidence.type];
    if (lastEvidenceTime && Date.parse(evidenceTime) < Date.parse(lastEvidenceTime)) {
      throw error("trigger evidence is stale/out-of-order", "STALE_TRIGGER_EVIDENCE", { lastEvidenceTime, evidenceTime, evidenceType: evidence.type });
    }

    const beforeStore = clone(this.store.state);
    try {
      const beforeRevision = Number(candidate.stateRevision || 0);
      const beforeState = candidate.lifecycleState;
      let relevance = { applicable: false, matched: false };
      let satisfaction = { applicable: false, matched: false };

      if (contract.relevance) relevance = evaluateNode(contract.relevance, evidence, runtime);
      if (candidate.lifecycleState === PRETRADE_TRIGGER_EVALUATING) {
        satisfaction = evaluateNode(contract.satisfaction, evidence, runtime);
      }

      runtime.lastEvidenceTimeByType[evidence.type] = evidenceTime;
      runtime.lastProcessedAt = at;
      const progressResult = {
        evidenceId: evidence.evidenceId,
        evidenceType: evidence.type,
        evidenceTime,
        beforeState,
        relevance,
        satisfaction,
      };
      runtime.consumedEvidence[evidence.evidenceId] = {
        evidenceHash: hash(evidence),
        processedAt: at,
        result: clone(progressResult),
      };

      candidate.triggerRuntime = runtime;
      candidate.stateRevision = beforeRevision + 1;
      candidate.lastLifecycleMutationAt = at;
      prepareJournal(candidate);
      const operationId = `TRIGGER_EVIDENCE:${candidate.candidateId}:v${candidate.contractVersion}:${evidence.evidenceId}`;
      const eventId = this.idFactory();
      candidate.lifecycleJournal.events.push({
        eventId,
        eventType: "TRIGGER_EVIDENCE_PROCESSED",
        candidateId: candidate.candidateId,
        contractVersion: candidate.contractVersion,
        resultingRevision: candidate.stateRevision,
        beforeState,
        afterState: candidate.lifecycleState,
        occurredAt: at,
        source: PRETRADE_TRIGGER_ENGINE_AUTHORITY,
        reason: null,
        operationId,
        provenance: {
          engineVersion: PRETRADE_TRIGGER_ENGINE_VERSION,
          evaluatorVersion: contract.evaluatorVersion,
          candidateContentHash: candidate.contentHash,
          evidence: clone(evidence),
        },
        metadata: { relevance: clone(relevance), satisfaction: clone(satisfaction) },
      });
      candidate.lifecycleJournal.operations.push({
        operationId,
        operationHash: hash({ candidateId: candidate.candidateId, contractVersion: candidate.contractVersion, evidence }),
        action: "PROCESS_TRIGGER_EVIDENCE",
        candidateId: candidate.candidateId,
        contractVersion: candidate.contractVersion,
        committedAt: at,
        result: {
          operationId,
          candidateId: candidate.candidateId,
          contractVersion: candidate.contractVersion,
          lifecycleState: candidate.lifecycleState,
          stateRevision: candidate.stateRevision,
          eventId,
          committedAt: at,
        },
      });
      this.store.state.updatedAt = at;
      this.store.save();
      return this.#completeTransition(candidate, contract, runtime, progressResult, false);
    } catch (cause) {
      this.store.state = beforeStore;
      throw cause;
    }
  }

  #completeTransition(candidate, contract, runtime, progressResult, duplicateEvidence) {
    const current = this.#findCandidate(candidate.candidateId, candidate.contractVersion);
    current.lifecycleState = canonicalLifecycleState(current.lifecycleState);

    if (current.lifecycleState === "WAITING" && contract.relevance && progressResult.relevance.applicable && progressResult.relevance.matched) {
      const result = this.lifecycleCoordinator.activateCandidate({
        operationId: `TRIGGER_ACTIVATE:${current.candidateId}:v${current.contractVersion}:${progressResult.evidenceId}`,
        candidateId: current.candidateId,
        contractVersion: current.contractVersion,
        expectedState: "WAITING",
        expectedRevision: Number(current.stateRevision || 0),
        activationMode: "AUTO",
        source: PRETRADE_TRIGGER_ENGINE_AUTHORITY,
        reason: "TRIGGER_RELEVANCE_TRUE",
        provenance: this.#provenance(current, contract, progressResult),
      });
      return { status: "ACTIVATED", duplicateEvidence, progress: clone(progressResult), transition: result };
    }

    if (current.lifecycleState === PRETRADE_TRIGGER_EVALUATING && progressResult.satisfaction.applicable && progressResult.satisfaction.matched) {
      const satisfaction = {
        authority: PRETRADE_TRIGGER_ENGINE_AUTHORITY,
        engineVersion: PRETRADE_TRIGGER_ENGINE_VERSION,
        evaluatorVersion: contract.evaluatorVersion,
        candidateContentHash: current.contentHash,
        evidenceId: progressResult.evidenceId,
        evidenceTimestamp: progressResult.evidenceTime,
        persistence: clone(contract.persistence),
        nodeStates: clone(runtime.nodeStates),
      };
      runtime.satisfaction = clone(satisfaction);
      const result = this.lifecycleCoordinator.beginPermission({
        operationId: `TRIGGER_SATISFIED:${current.candidateId}:v${current.contractVersion}:${progressResult.evidenceId}`,
        candidateId: current.candidateId,
        contractVersion: current.contractVersion,
        expectedState: PRETRADE_TRIGGER_EVALUATING,
        expectedRevision: Number(current.stateRevision || 0),
        source: PRETRADE_TRIGGER_ENGINE_AUTHORITY,
        reason: "TRIGGER_SATISFIED",
        triggerSatisfaction: satisfaction,
        provenance: this.#provenance(current, contract, progressResult),
      });
      return { status: "SATISFIED", duplicateEvidence, progress: clone(progressResult), transition: result };
    }

    if (
      current.lifecycleState === PRETRADE_TRIGGER_EVALUATING
      && current.activation?.mode === "AUTO"
      && contract.relevance
      && progressResult.relevance.applicable
      && !progressResult.relevance.matched
    ) {
      const result = this.lifecycleCoordinator.returnToWaiting({
        operationId: `TRIGGER_DEACTIVATE:${current.candidateId}:v${current.contractVersion}:${progressResult.evidenceId}`,
        candidateId: current.candidateId,
        contractVersion: current.contractVersion,
        expectedState: PRETRADE_TRIGGER_EVALUATING,
        expectedRevision: Number(current.stateRevision || 0),
        operatorRequested: false,
        source: PRETRADE_TRIGGER_ENGINE_AUTHORITY,
        reason: "TRIGGER_RELEVANCE_FALSE",
        provenance: this.#provenance(current, contract, progressResult),
      });
      return { status: "RETURNED_TO_WAITING", duplicateEvidence, progress: clone(progressResult), transition: result };
    }

    return {
      status: contract.relevance || current.lifecycleState === PRETRADE_TRIGGER_EVALUATING ? "PROGRESS_RECORDED" : "MANUAL_ACTIVATION_REQUIRED",
      duplicateEvidence,
      progress: clone(progressResult),
      transition: null,
      lifecycleState: current.lifecycleState,
      stateRevision: current.stateRevision,
    };
  }

  #provenance(candidate, contract, progressResult) {
    return {
      authority: PRETRADE_TRIGGER_ENGINE_AUTHORITY,
      engineVersion: PRETRADE_TRIGGER_ENGINE_VERSION,
      evaluatorVersion: contract.evaluatorVersion,
      candidateContentHash: candidate.contentHash,
      evidenceId: progressResult.evidenceId,
      evidenceType: progressResult.evidenceType,
      evidenceTimestamp: progressResult.evidenceTime,
    };
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
