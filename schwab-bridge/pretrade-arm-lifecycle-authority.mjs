import crypto from "node:crypto";
import { canonicalLifecycleState } from "./pretrade-state.mjs";
import {
  assertCanonicalCandidateIntegrity,
  candidateValidityStatusAt,
  isCanonicalCandidate,
} from "./pretrade-candidate-contract.mjs";
import { validateExecutionBoardHandoffDeliveryContract } from "./execution-board-handoff-delivery.mjs";

export const PRETRADE_ARM_LIFECYCLE_AUTHORITY = "PRETRADE_ARM_LIFECYCLE_AUTHORITY";

const ACTIVE_UNARMED = new Set(["WAITING", "PRETRADE_TRIGGER_EVALUATING", "PERMISSION_EVALUATING", "READY", "CAUTION"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function positiveNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
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

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function authorityError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function clone(value) {
  return structuredClone(value);
}

export class PreTradeArmLifecycleAuthority {
  constructor({ store, clock = () => new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
    if (!store || !store.state || typeof store.save !== "function") throw new Error("ARM lifecycle authority requires PRETRADE store");
    if (typeof clock !== "function" || typeof idFactory !== "function") throw new Error("clock and idFactory must be functions");
    this.store = store;
    this.clock = clock;
    this.idFactory = idFactory;
    this.busy = new Set();
  }

  authorizeFromCommit(command = {}) {
    const armCommit = command.armCommit;
    if (!armCommit || armCommit.authority !== "PRETRADE_ARM_OPERATION" || upper(armCommit.status) !== "AUTHORIZED") {
      throw authorityError("durably AUTHORIZED ARM operation is required", "ARM_COMMIT_AUTHORITY_REQUIRED");
    }
    if (text(armCommit.candidateId) !== text(command.candidateId) || Number(armCommit.contractVersion) !== Number(command.contractVersion)) {
      throw authorityError("ARM commit identity does not match lifecycle command", "ARM_COMMIT_IDENTITY_MISMATCH");
    }
    if (positiveNumber(armCommit.selectedQuantity) === null || !text(armCommit.riskEvaluationId) || !text(armCommit.dssEvaluationId)) {
      throw authorityError("ARM commit provenance is incomplete", "ARM_COMMIT_PROVENANCE_INCOMPLETE");
    }

    return this.#run(command, {
      action: "AUTHORIZE_ARM_FROM_COMMIT",
      eventType: "ARM_AUTHORIZED",
      allowedStates: command.recovery === true ? new Set(["READY", "CAUTION", "EXPIRED"]) : new Set(["READY", "CAUTION"]),
      payload: { armCommit },
      precondition: (candidate, committedAt) => {
        if (text(candidate.contentHash) !== text(armCommit.candidateContentHash)) throw authorityError("candidate content hash does not match ARM commit", "ARM_COMMIT_CANDIDATE_HASH_MISMATCH");
        if (upper(candidate.direction) !== upper(armCommit.direction)) throw authorityError("candidate direction does not match ARM commit", "ARM_COMMIT_DIRECTION_MISMATCH");
        if (candidate.currentDssEvaluationStale) throw authorityError("candidate DSS became stale after durable ARM proof", "ARM_COMMIT_DSS_STALE");
        if (text(candidate.currentDssEvaluationId) !== text(armCommit.dssEvaluationId)) throw authorityError("candidate current DSS does not match ARM commit", "ARM_COMMIT_DSS_MISMATCH");
        if (text(candidate.currentPermissionOutcome?.permissionEvaluationId) !== text(armCommit.permissionAttemptId)) throw authorityError("candidate current permission attempt does not match ARM commit", "ARM_COMMIT_PERMISSION_MISMATCH");
        if (candidate.arm || text(candidate.authorizedRiskEvaluationId) || text(candidate.authorizedDssEvaluationId)) {
          throw authorityError("candidate already contains frozen ARM authority", "ARM_ALREADY_FROZEN");
        }
        if (command.recovery === true) {
          this.#assertAuthorizedInsideValidity(candidate, armCommit.authorizedAt);
        } else {
          this.#assertValidWindow(candidate, committedAt);
        }
      },
      update: (candidate) => {
        candidate.lifecycleState = "ARMED";
        candidate.authorizedDssEvaluationId = text(armCommit.dssEvaluationId);
        candidate.authorizedRiskEvaluationId = text(armCommit.riskEvaluationId);
        candidate.arm = {
          authorizedAt: armCommit.authorizedAt,
          candidateVersion: Number(candidate.contractVersion),
          dssEvaluationId: text(armCommit.dssEvaluationId),
          riskEvaluationId: text(armCommit.riskEvaluationId),
          selectedQuantity: Number(armCommit.selectedQuantity),
          reviewPackageId: text(armCommit.reviewPackageId),
          armOperationId: text(armCommit.operationId),
          handoffId: text(armCommit.handoffId),
          executionAccountId: text(armCommit.accountId),
          ocoGroupId: text(armCommit.ocoGroupId) || null,
        };
      },
    });
  }

  retireBlockedHandoff(command = {}) {
    const delivery = command.delivery && typeof command.delivery === "object" ? clone(command.delivery) : null;
    const contract = validateExecutionBoardHandoffDeliveryContract(delivery);
    if (!contract.valid) {
      throw authorityError(
        `blocked handoff retirement requires a valid delivery contract: ${contract.errors.join("; ")}`,
        "ARM_RETIREMENT_DELIVERY_INVALID",
        { errors: contract.errors },
      );
    }
    if (upper(delivery.status) !== "BLOCKED") {
      throw authorityError("only a terminal BLOCKED handoff may retire PRETRADE ARM authority", "ARM_RETIREMENT_BLOCKED_DELIVERY_REQUIRED");
    }
    if (text(delivery.executionListeningAt) || text(delivery.deliveredAt)) {
      throw authorityError("handoff that reached Execution listening/delivery cannot retire through blocked-handoff reconciliation", "ARM_RETIREMENT_EXECUTION_OWNERSHIP_AMBIGUOUS");
    }

    const handoffId = text(delivery.handoffId);
    const blockReason = upper(delivery.blockReason);
    const retirementProvenance = {
      handoffId,
      deliveryStatus: "BLOCKED",
      blockReason,
      blockedAt: text(delivery.blockedAt),
      claimedBy: text(delivery.claimedBy),
      claimedAt: text(delivery.claimedAt),
    };

    return this.#run(command, {
      action: "RETIRE_BLOCKED_HANDOFF",
      eventType: "ARM_RETIRED_AFTER_BLOCKED_HANDOFF",
      allowedStates: new Set(["ARMED"]),
      payload: { delivery },
      precondition: (candidate) => {
        if (!candidate.arm) throw authorityError("ARM retirement requires frozen candidate ARM provenance", "ARM_RETIREMENT_ARM_PROVENANCE_REQUIRED");
        if (text(candidate.arm.handoffId) !== handoffId) {
          throw authorityError("blocked delivery handoff does not match candidate ARM handoff", "ARM_RETIREMENT_HANDOFF_MISMATCH", {
            candidateHandoffId: text(candidate.arm.handoffId) || null,
            deliveryHandoffId: handoffId || null,
          });
        }
      },
      update: (candidate, at) => {
        candidate.lifecycleState = "RETIRED";
        candidate.armRetirement = {
          retiredAt: at,
          source: PRETRADE_ARM_LIFECYCLE_AUTHORITY,
          reasonCode: "EXECUTION_HANDOFF_BLOCKED_BEFORE_LISTENING",
          ...retirementProvenance,
        };
        candidate.terminalOutcome = {
          state: "RETIRED",
          occurredAt: at,
          source: PRETRADE_ARM_LIFECYCLE_AUTHORITY,
          reasonCode: "EXECUTION_HANDOFF_BLOCKED_BEFORE_LISTENING",
          note: null,
          provenance: retirementProvenance,
        };
      },
    });
  }

  cancelOcoSibling(command = {}) {
    const groupId = text(command.groupId);
    const winner = command.winner && typeof command.winner === "object" ? command.winner : null;
    if (!groupId || !winner) throw authorityError("OCO cancellation requires group and winner provenance", "OCO_CANCELLATION_PROVENANCE_REQUIRED");
    return this.#run(command, {
      action: "CANCEL_OCO_SIBLING",
      eventType: "OCO_CANDIDATE_CANCELLED",
      allowedStates: ACTIVE_UNARMED,
      payload: { groupId, winner },
      update: (candidate, at) => {
        candidate.lifecycleState = "OCO_CANCELLED";
        candidate.terminalOutcome = {
          state: "OCO_CANCELLED",
          occurredAt: at,
          source: PRETRADE_ARM_LIFECYCLE_AUTHORITY,
          reasonCode: "OCO_WINNER_ARMED",
          note: null,
          provenance: { groupId, winner },
        };
      },
    });
  }

  #run(command, spec) {
    const operationId = text(command.operationId);
    const candidateId = text(command.candidateId);
    const contractVersion = Number(command.contractVersion);
    const expectedState = canonicalLifecycleState(command.expectedState);
    const expectedRevision = Number(command.expectedRevision);
    if (!operationId) throw authorityError("operationId is required", "ARM_LIFECYCLE_OPERATION_ID_REQUIRED");
    if (!candidateId || !Number.isInteger(contractVersion) || contractVersion < 1) throw authorityError("candidate identity is invalid", "INVALID_CANDIDATE_IDENTITY");
    if (!expectedState || !Number.isInteger(expectedRevision) || expectedRevision < 0) throw authorityError("expected state/revision are required", "ARM_LIFECYCLE_CAS_REQUIRED");

    const key = `${candidateId}:v${contractVersion}`;
    if (this.busy.has(key)) throw authorityError("candidate ARM lifecycle mutation is in progress", "ARM_LIFECYCLE_MUTATION_IN_PROGRESS");
    const beforeStore = clone(this.store.state);
    const candidate = this.#find(candidateId, contractVersion);
    this.#prepare(candidate);
    const operationHash = digest({ action: spec.action, candidateId, contractVersion, expectedState, expectedRevision, payload: spec.payload });
    const prior = candidate.lifecycleJournal.operations.find((item) => item.operationId === operationId);
    if (prior) {
      if (prior.operationHash !== operationHash) throw authorityError("operationId conflicts with prior ARM lifecycle mutation", "ARM_LIFECYCLE_OPERATION_CONFLICT");
      return clone(prior.result);
    }

    this.busy.add(key);
    try {
      if (candidate.lifecycleState !== expectedState) throw authorityError("ARM lifecycle state is stale", "STALE_LIFECYCLE_STATE", { expectedState, actualState: candidate.lifecycleState });
      if (candidate.stateRevision !== expectedRevision) throw authorityError("ARM lifecycle revision is stale", "STALE_STATE_REVISION", { expectedRevision, actualRevision: candidate.stateRevision });
      if (!spec.allowedStates.has(candidate.lifecycleState)) throw authorityError(`ARM lifecycle action is not allowed while ${candidate.lifecycleState}`, "ILLEGAL_LIFECYCLE_ACTION");
      const committedAt = this.#time();
      spec.precondition?.(candidate, committedAt);
      const beforeState = candidate.lifecycleState;
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
        source: PRETRADE_ARM_LIFECYCLE_AUTHORITY,
        reason: text(command.reason) || null,
        operationId,
        provenance: command.provenance ?? spec.payload ?? null,
        metadata: null,
      };
      const result = { operationId, candidateId, contractVersion, lifecycleState: candidate.lifecycleState, stateRevision: candidate.stateRevision, eventId: event.eventId, committedAt };
      candidate.lifecycleJournal.events.push(event);
      candidate.lifecycleJournal.operations.push({ operationId, operationHash, action: spec.action, candidateId, contractVersion, committedAt, result: clone(result) });
      this.store.state.updatedAt = committedAt;
      this.store.save();
      return clone(result);
    } catch (error) {
      this.store.state = beforeStore;
      throw error;
    } finally {
      this.busy.delete(key);
    }
  }

  #assertValidWindow(candidate, at) {
    if (!isCanonicalCandidate(candidate)) return;
    const validity = candidateValidityStatusAt(candidate, at);
    if (validity.status !== "VALID") throw authorityError("candidate is outside valid ARM window", validity.status === "EXPIRED" ? "CANDIDATE_VALIDITY_EXPIRED" : "CANDIDATE_VALIDITY_UNVERIFIABLE", validity);
  }

  #assertAuthorizedInsideValidity(candidate, authorizedAt) {
    if (!isCanonicalCandidate(candidate)) return;
    const validity = candidateValidityStatusAt(candidate, authorizedAt);
    if (validity.status !== "VALID") throw authorityError("durable ARM authorization was not established inside candidate validity", "ARM_RECOVERY_AUTHORIZATION_OUTSIDE_VALIDITY", validity);
  }

  #prepare(candidate) {
    candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    candidate.stateRevision = Number.isInteger(Number(candidate.stateRevision)) && Number(candidate.stateRevision) >= 0 ? Number(candidate.stateRevision) : 0;
    if (!candidate.lifecycleJournal || typeof candidate.lifecycleJournal !== "object") candidate.lifecycleJournal = { events: [], operations: [] };
    if (!Array.isArray(candidate.lifecycleJournal.events)) candidate.lifecycleJournal.events = [];
    if (!Array.isArray(candidate.lifecycleJournal.operations)) candidate.lifecycleJournal.operations = [];
    assertCanonicalCandidateIntegrity(candidate);
  }

  #find(candidateId, contractVersion) {
    const candidate = this.store.state.candidates?.find((item) => text(item.candidateId) === text(candidateId) && Number(item.contractVersion) === Number(contractVersion));
    if (!candidate) throw authorityError("candidate was not found", "CANDIDATE_NOT_FOUND");
    return candidate;
  }

  #time() {
    const parsed = Date.parse(String(this.clock() ?? ""));
    if (!Number.isFinite(parsed)) throw authorityError("ARM lifecycle clock returned invalid timestamp", "ARM_LIFECYCLE_CLOCK_INVALID");
    return new Date(parsed).toISOString();
  }
}
