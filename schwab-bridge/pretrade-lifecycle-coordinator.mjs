import crypto from "node:crypto";
import { canonicalLifecycleState, PRETRADE_TRIGGER_EVALUATING } from "./pretrade-state.mjs";

export const PRETRADE_ACTIVE_UNARMED_STATES = new Set([
  "WAITING",
  PRETRADE_TRIGGER_EVALUATING,
  "PERMISSION_EVALUATING",
  "READY",
  "CAUTION",
]);

export const PRETRADE_TERMINAL_UNARMED_STATES = new Set([
  "PASS",
  "EXPIRED",
  "INVALIDATED",
  "DECLINED",
  "SUPERSEDED",
  "OCO_CANCELLED",
]);

const PERMISSION_OUTCOMES = new Set(["READY", "CAUTION", "PASS"]);
const PERMISSION_BLOCKERS = new Set(["BLOCKED_RETRYABLE", "BLOCKED_INTEGRITY"]);

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
  return structuredClone(value);
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

function revision(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizePrerequisites(items) {
  if (!Array.isArray(items)) throw error("prerequisites must be an array", "INVALID_PREREQUISITES");
  const seen = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw error(`prerequisite at index ${index} must be an object`, "INVALID_PREREQUISITES");
    }
    const prerequisiteId = text(item.prerequisiteId || item.id);
    const status = upper(item.status);
    if (!prerequisiteId) throw error("prerequisiteId is required", "INVALID_PREREQUISITES");
    if (seen.has(prerequisiteId)) throw error(`duplicate prerequisiteId ${prerequisiteId}`, "INVALID_PREREQUISITES");
    if (!["PENDING", "RESOLVED", "BLOCKED"].includes(status)) {
      throw error("prerequisite status must be PENDING, RESOLVED, or BLOCKED", "INVALID_PREREQUISITES");
    }
    seen.add(prerequisiteId);
    return {
      prerequisiteId,
      status,
      reason: text(item.reason) || null,
      evidenceReference: item.evidenceReference ?? null,
      metadata: item.metadata ?? null,
    };
  });
}

export class PreTradeLifecycleCoordinator {
  constructor({ store, clock = nowIso, idFactory = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store.snapshot !== "function" || typeof store.save !== "function") {
      throw error("store with snapshot() and save() is required", "INVALID_LIFECYCLE_STORE");
    }
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
    this.busy = new Set();
  }

  snapshot() {
    const snapshot = this.store.snapshot();
    const candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
    snapshot.lifecycleEvents = candidates.flatMap((candidate) => candidate?.lifecycleJournal?.events || []);
    snapshot.lifecycleOperations = candidates.flatMap((candidate) => candidate?.lifecycleJournal?.operations || []);
    return snapshot;
  }

  candidateSnapshot(candidateId, contractVersion) {
    const candidate = this.#findCandidate(candidateId, contractVersion);
    this.#prepareCandidate(candidate);
    return clone(candidate);
  }

  activateCandidate(command = {}) {
    const mode = upper(command.activationMode || "MANUAL");
    if (!["MANUAL", "AUTO"].includes(mode)) throw error("activationMode must be MANUAL or AUTO", "INVALID_ACTIVATION_MODE");
    return this.#run(command, {
      action: "ACTIVATE_CANDIDATE",
      eventType: "CANDIDATE_ACTIVATED",
      allowedStates: new Set(["WAITING"]),
      payload: { mode, reason: text(command.reason) || null, provenance: command.provenance ?? null },
      update: (candidate, at) => {
        candidate.lifecycleState = PRETRADE_TRIGGER_EVALUATING;
        candidate.activation = {
          mode,
          activatedAt: at,
          source: upper(command.source || (mode === "MANUAL" ? "OPERATOR" : "AUTOMATION")),
          reason: text(command.reason) || null,
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  returnToWaiting(command = {}) {
    return this.#run(command, {
      action: "RETURN_TO_WAITING",
      eventType: "CANDIDATE_RETURNED_TO_WAITING",
      allowedStates: new Set([PRETRADE_TRIGGER_EVALUATING]),
      payload: {
        operatorRequested: command.operatorRequested === true,
        reason: text(command.reason) || null,
        provenance: command.provenance ?? null,
      },
      precondition: (candidate) => {
        if (candidate.activation?.mode === "MANUAL" && command.operatorRequested !== true) {
          throw error("manual activation is pinned until explicit operator return", "MANUAL_ACTIVATION_PINNED");
        }
      },
      update: (candidate, at) => {
        candidate.lifecycleState = "WAITING";
        candidate.lastDeactivation = {
          deactivatedAt: at,
          source: upper(command.source || "SYSTEM"),
          reason: text(command.reason) || null,
          provenance: command.provenance ?? null,
        };
        candidate.activation = null;
      },
    });
  }

  beginPermission(command = {}) {
    if (!command.triggerSatisfaction || typeof command.triggerSatisfaction !== "object") {
      throw error("triggerSatisfaction provenance is required", "TRIGGER_SATISFACTION_REQUIRED");
    }
    return this.#run(command, {
      action: "BEGIN_PERMISSION",
      eventType: "TRIGGER_SATISFIED",
      allowedStates: new Set([PRETRADE_TRIGGER_EVALUATING]),
      payload: { triggerSatisfaction: command.triggerSatisfaction },
      eventMetadata: { triggerSatisfaction: command.triggerSatisfaction },
      update: (candidate, at) => {
        candidate.lifecycleState = "PERMISSION_EVALUATING";
        candidate.triggerSatisfaction = clone({
          ...command.triggerSatisfaction,
          satisfiedAt: command.triggerSatisfaction.satisfiedAt || at,
        });
        candidate.permissionEvaluationStatus = "RUNNING";
        candidate.permissionBlocker = null;
      },
    });
  }

  publishPermissionOutcome(command = {}) {
    const outcome = upper(command.outcome);
    if (!PERMISSION_OUTCOMES.has(outcome)) throw error("outcome must be READY, CAUTION, or PASS", "INVALID_PERMISSION_OUTCOME");
    return this.#run(command, {
      action: `PUBLISH_${outcome}`,
      eventType: "PERMISSION_OUTCOME_PUBLISHED",
      allowedStates: new Set(["PERMISSION_EVALUATING"]),
      payload: {
        outcome,
        permissionEvaluationId: text(command.permissionEvaluationId) || null,
        reason: text(command.reason) || null,
        provenance: command.provenance ?? null,
      },
      eventMetadata: { outcome, permissionEvaluationId: text(command.permissionEvaluationId) || null },
      update: (candidate, at) => {
        candidate.lifecycleState = outcome;
        candidate.permissionEvaluationStatus = "COMPLETE";
        candidate.permissionBlocker = null;
        candidate.currentPermissionOutcome = {
          outcome,
          permissionEvaluationId: text(command.permissionEvaluationId) || null,
          publishedAt: at,
          reason: text(command.reason) || null,
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  revalidatePermission(command = {}) {
    return this.#run(command, {
      action: "REVALIDATE_PERMISSION",
      eventType: "PERMISSION_REVALIDATION_STARTED",
      allowedStates: new Set(["READY", "CAUTION"]),
      payload: { reason: text(command.reason) || null, provenance: command.provenance ?? null },
      update: (candidate) => {
        candidate.lifecycleState = "PERMISSION_EVALUATING";
        candidate.permissionEvaluationStatus = "RUNNING";
        candidate.permissionBlocker = null;
      },
    });
  }

  expireCandidate(command = {}) {
    return this.#terminal(command, "EXPIRED", "CANDIDATE_EXPIRED");
  }

  declineCandidate(command = {}) {
    const reasonCode = text(command.reasonCode || command.reason);
    if (!reasonCode) throw error("DECLINED requires a structured reason", "DECLINE_REASON_REQUIRED");
    return this.#terminal(command, "DECLINED", "CANDIDATE_DECLINED", reasonCode);
  }

  invalidateCandidate(command = {}) {
    const reasonCode = text(command.reasonCode || command.reason);
    if (!reasonCode) throw error("INVALIDATED requires a reason", "INVALIDATION_REASON_REQUIRED");
    return this.#terminal(command, "INVALIDATED", "CANDIDATE_INVALIDATED", reasonCode, new Set(["WAITING", PRETRADE_TRIGGER_EVALUATING]));
  }

  setPrerequisites(command = {}) {
    const items = normalizePrerequisites(command.prerequisites);
    return this.#run(command, {
      action: "SET_PREREQUISITES",
      eventType: "PREREQUISITES_UPDATED",
      allowedStates: PRETRADE_ACTIVE_UNARMED_STATES,
      payload: { items },
      update: (candidate, at) => {
        candidate.prerequisiteStatus = {
          updatedAt: at,
          allResolved: items.every((item) => item.status === "RESOLVED"),
          anyBlocked: items.some((item) => item.status === "BLOCKED"),
          items,
        };
      },
    });
  }

  setPermissionBlocker(command = {}) {
    const blockerStatus = upper(command.blockerStatus);
    const reasonCode = text(command.reasonCode || command.reason);
    if (!PERMISSION_BLOCKERS.has(blockerStatus)) {
      throw error("blockerStatus must be BLOCKED_RETRYABLE or BLOCKED_INTEGRITY", "INVALID_PERMISSION_BLOCKER");
    }
    if (!reasonCode) throw error("permission blocker requires a reason", "PERMISSION_BLOCKER_REASON_REQUIRED");
    return this.#run(command, {
      action: "SET_PERMISSION_BLOCKER",
      eventType: "PERMISSION_BLOCKED",
      allowedStates: new Set(["PERMISSION_EVALUATING"]),
      payload: { blockerStatus, reasonCode, provenance: command.provenance ?? null },
      update: (candidate, at) => {
        candidate.permissionEvaluationStatus = blockerStatus;
        candidate.permissionBlocker = {
          status: blockerStatus,
          reasonCode,
          blockedAt: at,
          retryable: blockerStatus === "BLOCKED_RETRYABLE",
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  clearPermissionBlocker(command = {}) {
    return this.#run(command, {
      action: "CLEAR_PERMISSION_BLOCKER",
      eventType: "PERMISSION_RESUMED",
      allowedStates: new Set(["PERMISSION_EVALUATING"]),
      payload: { reason: text(command.reason) || null, provenance: command.provenance ?? null },
      precondition: (candidate) => {
        if (!candidate.permissionBlocker) throw error("candidate has no active permission blocker", "NO_PERMISSION_BLOCKER");
      },
      update: (candidate) => {
        candidate.permissionEvaluationStatus = "RUNNING";
        candidate.permissionBlocker = null;
      },
    });
  }

  setRecoveryGate(command = {}) {
    const reasonCode = text(command.reasonCode || command.reason);
    if (!reasonCode) throw error("recovery gate requires a reason", "RECOVERY_GATE_REASON_REQUIRED");
    return this.#run(command, {
      action: "SET_RECOVERY_GATE",
      eventType: "RECOVERY_GATE_SET",
      allowedStates: PRETRADE_ACTIVE_UNARMED_STATES,
      allowRecoveryMutation: true,
      payload: { reasonCode, provenance: command.provenance ?? null },
      update: (candidate, at) => {
        candidate.recoveryGate = {
          blocked: true,
          reasonCode,
          blockedAt: at,
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  clearRecoveryGate(command = {}) {
    return this.#run(command, {
      action: "CLEAR_RECOVERY_GATE",
      eventType: "RECOVERY_GATE_CLEARED",
      allowedStates: PRETRADE_ACTIVE_UNARMED_STATES,
      allowRecoveryMutation: true,
      payload: { reason: text(command.reason) || "RECOVERY_RECONCILED", provenance: command.provenance ?? null },
      precondition: (candidate) => {
        if (!candidate.recoveryGate?.blocked) throw error("candidate has no active recovery gate", "NO_RECOVERY_GATE");
      },
      update: (candidate, at) => {
        candidate.recoveryGate = {
          blocked: false,
          clearedAt: at,
          reasonCode: text(command.reasonCode || command.reason) || "RECOVERY_RECONCILED",
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  #terminal(command, state, eventType, explicitReason = null, allowedStates = PRETRADE_ACTIVE_UNARMED_STATES) {
    const reasonCode = explicitReason || text(command.reasonCode || command.reason) || state;
    return this.#run(command, {
      action: `TERMINATE_${state}`,
      eventType,
      allowedStates,
      payload: { state, reasonCode, note: text(command.note) || null, provenance: command.provenance ?? null },
      update: (candidate, at) => {
        candidate.lifecycleState = state;
        candidate.terminalOutcome = {
          state,
          occurredAt: at,
          source: upper(command.source || "SYSTEM"),
          reasonCode,
          note: text(command.note) || null,
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  #run(command, spec) {
    const operationId = text(command.operationId);
    const candidateId = text(command.candidateId);
    const contractVersion = Number(command.contractVersion);
    const expectedState = canonicalLifecycleState(text(command.expectedState));
    const expectedRevision = Number(command.expectedRevision);

    if (!operationId) throw error("operationId is required", "OPERATION_ID_REQUIRED");
    if (!candidateId || !Number.isInteger(contractVersion) || contractVersion < 1) {
      throw error("candidateId and contractVersion are required", "INVALID_CANDIDATE_IDENTITY");
    }
    if (!expectedState) throw error("expectedState is required", "EXPECTED_STATE_REQUIRED");
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw error("expectedRevision must be an integer >= 0", "EXPECTED_REVISION_REQUIRED");
    }

    const entityKey = `${candidateId}:${contractVersion}`;
    if (this.busy.has(entityKey)) throw error(`candidate ${entityKey} is already being mutated`, "ENTITY_MUTATION_IN_PROGRESS");

    const beforeStore = clone(this.store.state);
    const candidate = this.#findCandidate(candidateId, contractVersion);
    this.#prepareCandidate(candidate);

    const operationHash = hash({
      action: spec.action,
      candidateId,
      contractVersion,
      expectedState,
      expectedRevision,
      source: upper(command.source || "SYSTEM"),
      payload: spec.payload ?? null,
    });

    const prior = candidate.lifecycleJournal.operations.find((item) => item.operationId === operationId);
    if (prior) {
      if (prior.operationHash !== operationHash) {
        throw error(`operationId ${operationId} was already used with different immutable command payload`, "OPERATION_ID_CONFLICT");
      }
      return clone(prior.result);
    }

    this.busy.add(entityKey);
    try {
      if (candidate.recoveryGate?.blocked && !spec.allowRecoveryMutation) {
        throw error("candidate is blocked pending authoritative recovery reconciliation", "RECOVERY_RECONCILIATION_REQUIRED", {
          recoveryGate: clone(candidate.recoveryGate),
        });
      }
      if (candidate.lifecycleState !== expectedState) {
        throw error(`expected state ${expectedState} but candidate is ${candidate.lifecycleState}`, "STALE_LIFECYCLE_STATE", {
          expectedState,
          actualState: candidate.lifecycleState,
        });
      }
      if (candidate.stateRevision !== expectedRevision) {
        throw error(`expected revision ${expectedRevision} but candidate is revision ${candidate.stateRevision}`, "STALE_STATE_REVISION", {
          expectedRevision,
          actualRevision: candidate.stateRevision,
        });
      }
      if (!spec.allowedStates.has(candidate.lifecycleState)) {
        throw error(`${spec.action} is not allowed while candidate is ${candidate.lifecycleState}`, "ILLEGAL_LIFECYCLE_ACTION");
      }

      spec.precondition?.(candidate);
      const beforeState = candidate.lifecycleState;
      const committedAt = this.clock();
      spec.update(candidate, committedAt);
      candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
      candidate.stateRevision += 1;
      candidate.lastLifecycleMutationAt = committedAt;

      const event = {
        eventId: this.idFactory(),
        eventType: spec.eventType,
        candidateId,
        contractVersion,
        resultingRevision: candidate.stateRevision,
        beforeState,
        afterState: candidate.lifecycleState,
        occurredAt: committedAt,
        source: upper(command.source || "SYSTEM"),
        reason: text(command.reason) || null,
        operationId,
        provenance: command.provenance ?? null,
        metadata: spec.eventMetadata ?? null,
      };

      const result = {
        operationId,
        candidateId,
        contractVersion,
        lifecycleState: candidate.lifecycleState,
        stateRevision: candidate.stateRevision,
        eventId: event.eventId,
        committedAt,
      };

      candidate.lifecycleJournal.events.push(event);
      candidate.lifecycleJournal.operations.push({
        operationId,
        operationHash,
        action: spec.action,
        candidateId,
        contractVersion,
        committedAt,
        result: clone(result),
      });
      this.store.state.updatedAt = committedAt;
      this.store.save();
      return clone(result);
    } catch (cause) {
      this.store.state = beforeStore;
      throw cause;
    } finally {
      this.busy.delete(entityKey);
    }
  }

  #prepareCandidate(candidate) {
    candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    candidate.stateRevision = revision(candidate.stateRevision);
    if (!candidate.lifecycleJournal || typeof candidate.lifecycleJournal !== "object") {
      candidate.lifecycleJournal = { events: [], operations: [] };
    }
    if (!Array.isArray(candidate.lifecycleJournal.events)) candidate.lifecycleJournal.events = [];
    if (!Array.isArray(candidate.lifecycleJournal.operations)) candidate.lifecycleJournal.operations = [];
    if (!Object.prototype.hasOwnProperty.call(candidate, "prerequisiteStatus")) candidate.prerequisiteStatus = null;
    if (!Object.prototype.hasOwnProperty.call(candidate, "permissionEvaluationStatus")) candidate.permissionEvaluationStatus = null;
    if (!Object.prototype.hasOwnProperty.call(candidate, "permissionBlocker")) candidate.permissionBlocker = null;
    if (!Object.prototype.hasOwnProperty.call(candidate, "recoveryGate")) candidate.recoveryGate = null;
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
