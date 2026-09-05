import crypto from "node:crypto";
import { assertCanonicalCandidateIntegrity } from "./pretrade-candidate-contract.mjs";
import { canonicalLifecycleState, PRETRADE_TRIGGER_EVALUATING } from "./pretrade-state.mjs";

const PERMISSION_DEPENDENT_STATES = new Set(["PERMISSION_EVALUATING", "READY", "CAUTION"]);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return structuredClone(value);
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function error(message, code) {
  const result = new Error(message);
  result.code = code;
  return result;
}

function prepareJournal(candidate) {
  if (!candidate.lifecycleJournal || typeof candidate.lifecycleJournal !== "object") {
    candidate.lifecycleJournal = { events: [], operations: [] };
  }
  if (!Array.isArray(candidate.lifecycleJournal.events)) candidate.lifecycleJournal.events = [];
  if (!Array.isArray(candidate.lifecycleJournal.operations)) candidate.lifecycleJournal.operations = [];
}

export class PreTradeTriggerPersistenceAuthority {
  constructor({ store, clock = nowIso, idFactory = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store.save !== "function") throw error("trigger persistence authority requires store", "INVALID_TRIGGER_STORE");
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  expireSatisfaction({ candidateId, contractVersion, expectedState, expectedRevision, evidenceId, evidenceTimestamp, reasonCode } = {}) {
    const candidate = this.#findCandidate(candidateId, contractVersion);
    assertCanonicalCandidateIntegrity(candidate);
    candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    const operationId = `TRIGGER_PERSISTENCE_EXPIRE:${candidateId}:v${contractVersion}:${text(evidenceId)}`;
    prepareJournal(candidate);

    const prior = candidate.lifecycleJournal.operations.find((item) => item.operationId === operationId);
    if (prior) return clone(prior.result);

    if (!PERMISSION_DEPENDENT_STATES.has(candidate.lifecycleState)) {
      throw error(`trigger satisfaction cannot expire while candidate is ${candidate.lifecycleState}`, "TRIGGER_PERSISTENCE_STATE_CONFLICT");
    }
    if (candidate.lifecycleState !== canonicalLifecycleState(expectedState)) {
      throw error("trigger persistence expected lifecycle state is stale", "STALE_LIFECYCLE_STATE");
    }
    if (Number(candidate.stateRevision || 0) !== Number(expectedRevision)) {
      throw error("trigger persistence expected stateRevision is stale", "STALE_STATE_REVISION");
    }
    if (!candidate.triggerSatisfaction || candidate.triggerSatisfaction.authority !== "PRETRADE_TRIGGER_ENGINE") {
      throw error("candidate has no authoritative trigger satisfaction to expire", "TRIGGER_SATISFACTION_NOT_AUTHORITATIVE");
    }

    const beforeStore = clone(this.store.state);
    try {
      const at = this.clock();
      const beforeState = candidate.lifecycleState;
      candidate.lifecycleState = PRETRADE_TRIGGER_EVALUATING;
      candidate.stateRevision = Number(candidate.stateRevision || 0) + 1;
      candidate.lastLifecycleMutationAt = at;
      candidate.lastTriggerSatisfactionExpiration = {
        expiredAt: at,
        evidenceId: text(evidenceId) || null,
        evidenceTimestamp: text(evidenceTimestamp) || null,
        reasonCode: text(reasonCode) || "TRIGGER_PERSISTENCE_EXPIRED",
        previousSatisfaction: clone(candidate.triggerSatisfaction),
      };
      candidate.triggerSatisfaction = null;
      candidate.permissionEvaluationStatus = null;
      candidate.permissionBlocker = null;
      candidate.currentPermissionOutcome = null;
      if (candidate.currentDssEvaluationId) {
        candidate.currentDssEvaluationStale = true;
        candidate.currentDssEvaluationStaleAt = at;
        candidate.currentDssEvaluationStaleReason = "TRIGGER_SATISFACTION_EXPIRED";
      }
      if (candidate.triggerRuntime?.nodeStates) candidate.triggerRuntime.nodeStates = {};

      const eventId = this.idFactory();
      const event = {
        eventId,
        eventType: "TRIGGER_SATISFACTION_EXPIRED",
        candidateId,
        contractVersion,
        resultingRevision: candidate.stateRevision,
        beforeState,
        afterState: candidate.lifecycleState,
        occurredAt: at,
        source: "PRETRADE_TRIGGER_ENGINE",
        reason: text(reasonCode) || "TRIGGER_PERSISTENCE_EXPIRED",
        operationId,
        provenance: {
          evidenceId: text(evidenceId) || null,
          evidenceTimestamp: text(evidenceTimestamp) || null,
        },
        metadata: null,
      };
      const result = {
        operationId,
        candidateId,
        contractVersion,
        lifecycleState: candidate.lifecycleState,
        stateRevision: candidate.stateRevision,
        eventId,
        committedAt: at,
      };
      candidate.lifecycleJournal.events.push(event);
      candidate.lifecycleJournal.operations.push({
        operationId,
        operationHash: hash({ action: "EXPIRE_TRIGGER_SATISFACTION", candidateId, contractVersion, evidenceId, evidenceTimestamp, reasonCode }),
        action: "EXPIRE_TRIGGER_SATISFACTION",
        candidateId,
        contractVersion,
        committedAt: at,
        result: clone(result),
      });
      this.store.state.updatedAt = at;
      this.store.save();
      return clone(result);
    } catch (cause) {
      this.store.state = beforeStore;
      throw cause;
    }
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
