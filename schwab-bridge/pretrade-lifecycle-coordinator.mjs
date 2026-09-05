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
const PERMISSION_BLOCKER_STATUSES = new Set(["BLOCKED_RETRYABLE", "BLOCKED_INTEGRITY"]);

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
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stable(value[key]);
        return result;
      }, {});
  }
  return value;
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function lifecycleError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function normalizePrerequisiteItems(items) {
  if (!Array.isArray(items)) throw lifecycleError("prerequisites must be an array", "INVALID_PREREQUISITES");
  const seen = new Set();
  return items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw lifecycleError(`prerequisite at index ${index} must be an object`, "INVALID_PREREQUISITES");
    }
    const prerequisiteId = text(item.prerequisiteId || item.id);
    const status = upper(item.status);
    if (!prerequisiteId) throw lifecycleError("prerequisiteId is required", "INVALID_PREREQUISITES");
    if (seen.has(prerequisiteId)) throw lifecycleError(`duplicate prerequisiteId ${prerequisiteId}`, "INVALID_PREREQUISITES");
    if (!["PENDING", "RESOLVED", "BLOCKED"].includes(status)) {
      throw lifecycleError("prerequisite status must be PENDING, RESOLVED, or BLOCKED", "INVALID_PREREQUISITES");
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

function normalizeSource(value, fallback = "SYSTEM") {
  return upper(value || fallback) || fallback;
}

export class PreTradeLifecycleCoordinator {
  constructor({ store, clock = nowIso, idFactory = () => crypto.randomUUID() } = {}) {
    if (!store || typeof store !== "object" || typeof store.save !== "function" || typeof store.snapshot !== "function") {
      throw lifecycleError("store with snapshot() and save() is required", "INVALID_LIFECYCLE_STORE");
    }
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
    this.busyEntities = new Set();
  }

  snapshot() {
    this.#ensureStateShape();
    return this.store.snapshot();
  }

  candidateSnapshot(candidateId, contractVersion) {
    this.#ensureStateShape();
    return clone(this.#findCandidate(candidateId, contractVersion));
  }

  activateCandidate(command = {}) {
    const activationMode = upper(command.activationMode || "MANUAL");
    if (!["MANUAL", "AUTO"].includes(activationMode)) {
      throw lifecycleError("activationMode must be MANUAL or AUTO", "INVALID_ACTIVATION_MODE");
    }
    return this.#mutate({
      ...command,
      action: "ACTIVATE_CANDIDATE",
      eventType: "CANDIDATE_ACTIVATED",
      allowedStates: new Set(["WAITING"]),
      mutate: (candidate, committedAt) => {
        candidate.lifecycleState = PRETRADE_TRIGGER_EVALUATING;
        candidate.activation = {
          mode: activationMode,
          activatedAt: committedAt,
          source: normalizeSource(command.source, activationMode === "MANUAL" ? "OPERATOR" : "AUTOMATION"),
          reason: text(command.reason) || null,
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  returnToWaiting(command = {}) {
    return this.#mutate({
      ...command,
      action: "RETURN_TO_WAITING",
      eventType: "CANDIDATE_RETURNED_TO_WAITING",
      allowedStates: new Set([PRETRADE_TRIGGER_EVALUATING]),
      precondition: (candidate) => {
        if (candidate.activation?.mode === "MANUAL" && command.operatorRequested !== true) {
          throw lifecycleError(
            "manually activated candidate is pinned until explicit operator return or another allowed resolution",
            "MANUAL_ACTIVATION_PINNED",
          );
        }
      },
      mutate: (candidate, committedAt) => {
        candidate.lifecycleState = "WAITING";
        candidate.lastDeactivation = {
          deactivatedAt: committedAt,
          source: normalizeSource(command.source),
          reason: text(command.reason) || null,
          provenance: command.provenance ?? null,
        };
        candidate.activation = null;
      },
    });
  }

  beginPermission(command = {}) {
    if (!command.triggerSatisfaction || typeof command.triggerSatisfaction !== "object") {
      throw lifecycleError("triggerSatisfaction provenance is required", "TRIGGER_SATISFACTION_REQUIRED");
    }
    return this.#mutate({
      ...command,
      action: "BEGIN_PERMISSION",
      eventType: "TRIGGER_SATISFIED",
      allowedStates: new Set([PRETRADE_TRIGGER_EVALUATING]),
      mutate: (candidate, committedAt) => {
        candidate.lifecycleState = "PERMISSION_EVALUATING";
        candidate.triggerSatisfaction = clone({
          ...command.triggerSatisfaction,
          satisfiedAt: command.triggerSatisfaction.satisfiedAt || committedAt,
        });
        candidate.permissionEvaluationStatus = "RUNNING";
        candidate.permissionBlocker = null;
      },
    });
  }

  publishPermissionOutcome(command = {}) {
    const outcome = upper(command.outcome);
    if (!PERMISSION_OUTCOMES.has(outcome)) {
      throw lifecycleError("outcome must be READY, CAUTION, or PASS", "INVALID_PERMISSION_OUTCOME");
    }
    return this.#mutate({
      ...command,
      action: `PUBLISH_${outcome}`,
      eventType: "PERMISSION_OUTCOME_PUBLISHED",
      allowedStates: new Set(["PERMISSION_EVALUATING"]),
      mutate: (candidate, committedAt) => {
        candidate.lifecycleState = outcome;
        candidate.permissionEvaluationStatus = "COMPLETE";
        candidate.permissionBlocker = null;
        candidate.currentPermissionOutcome = {
          outcome,
          permissionEvaluationId: text(command.permissionEvaluationId) || null,
          publishedAt: committedAt,
          reason: text(command.reason) || null,
          provenance: command.provenance ?? null,
        };
      },
      eventMetadata: {
        permissionEvaluationId: text(command.permissionEvaluationId) || null,
        outcome,
      },
    });
  }

  revalidatePermission(command = {}) {
    return this.#mutate({
      ...command,
      action: "REVALIDATE_PERMISSION",
      eventType: "PERMISSION_REVALIDATION_STARTED",
      allowedStates: new Set(["READY", "CAUTION"]),
      mutate: (candidate) => {
        candidate.lifecycleState = "PERMISSION_EVALUATING";
        candidate.permissionEvaluationStatus = "RUNNING";
        candidate.permissionBlocker = null;
      },
    });
  }

  expireCandidate(command = {}) {
    return this.#terminalMutation(command, "EXPIRED", "CANDIDATE_EXPIRED");
  }

  declineCandidate(command = {}) {
    if (!text(command.reasonCode || command.reason)) {
      throw lifecycleError("DECLINED requires a structured reason", "DECLINE_REASON_REQUIRED");
    }
    return this.#terminalMutation(
      {
        ...command,
        terminalDetails: {
          reasonCode: text(command.reasonCode || command.reason),
          note: text(command.note) || null,
        },
      },
      "DECLINED",
      "CANDIDATE_DECLINED",
    );
  }

  invalidateCandidate(command = {}) {
    if (!text(command.reasonCode || command.reason)) {
      throw lifecycleError("INVALIDATED requires a reason", "INVALIDATION_REASON_REQUIRED");
    }
    return this.#mutate({
      ...command,
      action: "INVALIDATE_CANDIDATE",
      eventType: "CANDIDATE_INVALIDATED",
      allowedStates: new Set(["WAITING", PRETRADE_TRIGGER_EVALUATING]),
      mutate: (candidate, committedAt) => {
        candidate.lifecycleState = "INVALIDATED";
        candidate.terminalOutcome = {
          state: "INVALIDATED",
          occurredAt: committedAt,
          source: normalizeSource(command.source),
          reasonCode: text(command.reasonCode || command.reason),
          note: text(command.note) || null,
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  setPrerequisites(command = {}) {
    const prerequisites = normalizePrerequisiteItems(command.prerequisites);
    return this.#mutate({
      ...command,
      action: "SET_PREREQUISITES",
      eventType: "PREREQUISITES_UPDATED",
      allowedStates: PRETRADE_ACTIVE_UNARMED_STATES,
      mutate: (candidate, committedAt) => {
        candidate.prerequisiteStatus = {
          updatedAt: committedAt,
          allResolved: prerequisites.every((item) => item.status === "RESOLVED"),
          anyBlocked: prerequisites.some((item) => item.status === "BLOCKED"),
          items: prerequisites,
        };
      },
    });
  }

  setPermissionBlocker(command = {}) {
    const status = upper(command.blockerStatus);
    if (!PERMISSION_BLOCKER_STATUSES.has(status)) {
      throw lifecycleError(
        "blockerStatus must be BLOCKED_RETRYABLE or BLOCKED_INTEGRITY",
        "INVALID_PERMISSION_BLOCKER",
      );
    }
    if (!text(command.reasonCode || command.reason)) {
      throw lifecycleError("permission blocker requires a reason", "PERMISSION_BLOCKER_REASON_REQUIRED");
    }
    return this.#mutate({
      ...command,
      action: "SET_PERMISSION_BLOCKER",
      eventType: "PERMISSION_BLOCKED",
      allowedStates: new Set(["PERMISSION_EVALUATING"]),
      mutate: (candidate, committedAt) => {
        candidate.permissionEvaluationStatus = status;
        candidate.permissionBlocker = {
          status,
          reasonCode: text(command.reasonCode || command.reason),
          blockedAt: committedAt,
          retryable: status === "BLOCKED_RETRYABLE",
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  clearPermissionBlocker(command = {}) {
    return this.#mutate({
      ...command,
      action: "CLEAR_PERMISSION_BLOCKER",
      eventType: "PERMISSION_RESUMED",
      allowedStates: new Set(["PERMISSION_EVALUATING"]),
      precondition: (candidate) => {
        if (!candidate.permissionBlocker) {
          throw lifecycleError("candidate has no active permission blocker", "NO_PERMISSION_BLOCKER");
        }
      },
      mutate: (candidate) => {
        candidate.permissionEvaluationStatus = "RUNNING";
        candidate.permissionBlocker = null;
      },
    });
  }

  setRecoveryGate(command = {}) {
    if (!text(command.reasonCode || command.reason)) {
      throw lifecycleError("recovery gate requires a reason", "RECOVERY_GATE_REASON_REQUIRED");
    }
    return this.#mutate({
      ...command,
      action: "SET_RECOVERY_GATE",
      eventType: "RECOVERY_GATE_SET",
      allowedStates: new Set([
        "WAITING",
        PRETRADE_TRIGGER_EVALUATING,
        "PERMISSION_EVALUATING",
        "READY",
        "CAUTION",
      ]),
      allowWhileRecoveryBlocked: true,
      mutate: (candidate, committedAt) => {
        candidate.recoveryGate = {
          blocked: true,
          reasonCode: text(command.reasonCode || command.reason),
          blockedAt: committedAt,
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  clearRecoveryGate(command = {}) {
    return this.#mutate({
      ...command,
      action: "CLEAR_RECOVERY_GATE",
      eventType: "RECOVERY_GATE_CLEARED",
      allowedStates: new Set([
        "WAITING",
        PRETRADE_TRIGGER_EVALUATING,
        "PERMISSION_EVALUATING",
        "READY",
        "CAUTION",
      ]),
      allowWhileRecoveryBlocked: true,
      precondition: (candidate) => {
        if (!candidate.recoveryGate?.blocked) {
          throw lifecycleError("candidate has no active recovery gate", "NO_RECOVERY_GATE");
        }
      },
      mutate: (candidate, committedAt) => {
        candidate.recoveryGate = {
          blocked: false,
          clearedAt: committedAt,
          reasonCode: text(command.reasonCode || command.reason) || "RECOVERY_RECONCILED",
          provenance: command.provenance ?? null,
        };
      },
    });
  }

  #terminalMutation(command, state, eventType) {
    return this.#mutate({
      ...command,
      action: `TERMINATE_${state}`,
      eventType,
      allowedStates: PRETRADE_ACTIVE_UNARMED_STATES,
      mutate: (candidate, committedAt) => {
        candidate.lifecycleState = state;
        candidate.terminalOutcome = {
          state,
          occurredAt: committedAt,
          source: normalizeSource(command.source),
          reasonCode: text(command.reasonCode || command.reason) || state,
          note: text(command.note) || null,
          provenance: command.provenance ?? null,
          ...(command.terminalDetails ?? {}),
        };
      },
    });
  }

  #mutate({
    operationId,
    candidateId,
    contractVersion,
    expectedState,
    expectedRevision,
    action,
    eventType,
    allowedStates,
    source = "SYSTEM",
    reason = null,
    provenance = null,
    eventMetadata = null,
    precondition = null,
    mutate,
    allowWhileRecoveryBlocked = false,
  }) {
    this.#ensureStateShape();

    const normalizedOperationId = text(operationId);
    const normalizedCandidateId = text(candidateId);
    const normalizedContractVersion = Number(contractVersion);
    const normalizedExpectedState = canonicalLifecycleState(text(expectedState));
    const normalizedExpectedRevision = Number(expectedRevision);

    if (!normalizedOperationId) throw lifecycleError("operationId is required", "OPERATION_ID_REQUIRED");
    if (!normalizedCandidateId || !Number.isInteger(normalizedContractVersion) || normalizedContractVersion < 1) {
      throw lifecycleError("candidateId and contractVersion are required", "INVALID_CANDIDATE_IDENTITY");
    }
    if (!normalizedExpectedState) throw lifecycleError("expectedState is required", "EXPECTED_STATE_REQUIRED");
    if (!Number.isInteger(normalizedExpectedRevision) || normalizedExpectedRevision < 0) {
      throw lifecycleError("expectedRevision must be an integer >= 0", "EXPECTED_REVISION_REQUIRED");
    }

    const operationFingerprint = fingerprint({
      action,
      candidateId: normalizedCandidateId,
      contractVersion: normalizedContractVersion,
      expectedState: normalizedExpectedState,
      expectedRevision: normalizedExpectedRevision,
    });

    const priorOperation = this.store.state.lifecycleOperations.find((item) => item.operationId === normalizedOperationId);
    if (priorOperation) {
      if (priorOperation.fingerprint !== operationFingerprint) {
        throw lifecycleError(
          `operationId ${normalizedOperationId} was already used for a different command`,
          "OPERATION_ID_CONFLICT",
        );
      }
      return clone(priorOperation.result);
    }

    const entityKey = `${normalizedCandidateId}:${normalizedContractVersion}`;
    if (this.busyEntities.has(entityKey)) {
      throw lifecycleError(`candidate ${entityKey} is already being mutated`, "ENTITY_MUTATION_IN_PROGRESS");
    }

    this.busyEntities.add(entityKey);
    const stateBeforeMutation = clone(this.store.state);

    try {
      const candidate = this.#findCandidate(normalizedCandidateId, normalizedContractVersion);
      candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
      candidate.stateRevision = normalizeRevision(candidate.stateRevision);

      if (candidate.recoveryGate?.blocked && !allowWhileRecoveryBlocked) {
        throw lifecycleError(
          `candidate ${entityKey} is blocked pending authoritative recovery reconciliation`,
          "RECOVERY_RECONCILIATION_REQUIRED",
          { recoveryGate: clone(candidate.recoveryGate) },
        );
      }

      if (candidate.lifecycleState !== normalizedExpectedState) {
        throw lifecycleError(
          `expected state ${normalizedExpectedState} but candidate is ${candidate.lifecycleState}`,
          "STALE_LIFECYCLE_STATE",
          { expectedState: normalizedExpectedState, actualState: candidate.lifecycleState },
        );
      }
      if (candidate.stateRevision !== normalizedExpectedRevision) {
        throw lifecycleError(
          `expected revision ${normalizedExpectedRevision} but candidate is revision ${candidate.stateRevision}`,
          "STALE_STATE_REVISION",
          { expectedRevision: normalizedExpectedRevision, actualRevision: candidate.stateRevision },
        );
      }
      if (!allowedStates.has(candidate.lifecycleState)) {
        throw lifecycleError(
          `${action} is not allowed while candidate is ${candidate.lifecycleState}`,
          "ILLEGAL_LIFECYCLE_ACTION",
          { action, lifecycleState: candidate.lifecycleState },
        );
      }

      precondition?.(candidate);

      const beforeState = candidate.lifecycleState;
      const committedAt = this.clock();
      mutate(candidate, committedAt);
      candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
      candidate.stateRevision += 1;
      candidate.lastLifecycleMutationAt = committedAt;

      const event = {
        eventId: this.idFactory(),
        eventType,
        candidateId: normalizedCandidateId,
        contractVersion: normalizedContractVersion,
        resultingRevision: candidate.stateRevision,
        beforeState,
        afterState: candidate.lifecycleState,
        occurredAt: committedAt,
        source: normalizeSource(source),
        reason: text(reason) || null,
        operationId: normalizedOperationId,
        provenance: provenance ?? null,
        metadata: eventMetadata ?? null,
      };

      this.store.state.lifecycleEvents.push(event);
      this.store.state.updatedAt = committedAt;

      const result = {
        operationId: normalizedOperationId,
        candidateId: normalizedCandidateId,
        contractVersion: normalizedContractVersion,
        lifecycleState: candidate.lifecycleState,
        stateRevision: candidate.stateRevision,
        eventId: event.eventId,
        committedAt,
      };

      this.store.state.lifecycleOperations.push({
        operationId: normalizedOperationId,
        fingerprint: operationFingerprint,
        action,
        candidateId: normalizedCandidateId,
        contractVersion: normalizedContractVersion,
        committedAt,
        result: clone(result),
      });

      this.store.save();
      return clone(result);
    } catch (error) {
      this.store.state = stateBeforeMutation;
      throw error;
    } finally {
      this.busyEntities.delete(entityKey);
    }
  }

  #ensureStateShape() {
    if (!this.store.state || typeof this.store.state !== "object") {
      throw lifecycleError("store state is unavailable; call store.load() first", "LIFECYCLE_STORE_NOT_LOADED");
    }
    if (!Array.isArray(this.store.state.candidates)) this.store.state.candidates = [];
    if (!Array.isArray(this.store.state.lifecycleEvents)) this.store.state.lifecycleEvents = [];
    if (!Array.isArray(this.store.state.lifecycleOperations)) this.store.state.lifecycleOperations = [];

    for (const candidate of this.store.state.candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
      candidate.stateRevision = normalizeRevision(candidate.stateRevision);
      if (!Object.prototype.hasOwnProperty.call(candidate, "prerequisiteStatus")) candidate.prerequisiteStatus = null;
      if (!Object.prototype.hasOwnProperty.call(candidate, "permissionEvaluationStatus")) candidate.permissionEvaluationStatus = null;
      if (!Object.prototype.hasOwnProperty.call(candidate, "permissionBlocker")) candidate.permissionBlocker = null;
      if (!Object.prototype.hasOwnProperty.call(candidate, "recoveryGate")) candidate.recoveryGate = null;
    }
  }

  #findCandidate(candidateId, contractVersion) {
    const normalizedId = text(candidateId);
    const normalizedVersion = Number(contractVersion);
    const candidate = this.store.state.candidates.find(
      (item) => item?.candidateId === normalizedId && Number(item?.contractVersion) === normalizedVersion,
    );
    if (!candidate) {
      throw lifecycleError(
        `candidate ${normalizedId} v${normalizedVersion} not found`,
        "CANDIDATE_NOT_FOUND",
      );
    }
    return candidate;
  }
}
