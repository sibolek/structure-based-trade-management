import crypto from "node:crypto";
import { canonicalLifecycleState } from "./pretrade-state.mjs";
import { buildExecutionBoardHandoff } from "./execution-board-handoff.mjs";
import { armAuthorizationProof } from "./pretrade-arm-operation-repository.mjs";

export const PRETRADE_ARM_SERVICE_AUTHORITY = "PRETRADE_ARM_SERVICE";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
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

function armError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function timestampMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function deepEqual(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

export class PreTradeArmService {
  constructor({
    lifecycleCoordinator,
    permissionPipeline,
    reviewService,
    reviewRepository,
    permissionAttemptRepository,
    riskEvaluationRepository,
    armOperationRepository,
    armLifecycleAuthority,
    handoffRepository,
    deliveryRepository,
    ocoService,
    clock = () => new Date().toISOString(),
  } = {}) {
    if (!lifecycleCoordinator || typeof lifecycleCoordinator.revalidatePermission !== "function") throw new Error("ARM service requires lifecycleCoordinator");
    if (!permissionPipeline || typeof permissionPipeline.evaluate !== "function") throw new Error("ARM service requires permissionPipeline");
    if (!reviewService || typeof reviewService.readiness !== "function") throw new Error("ARM service requires reviewService");
    if (!reviewRepository || typeof reviewRepository.get !== "function") throw new Error("ARM service requires reviewRepository");
    if (!permissionAttemptRepository || typeof permissionAttemptRepository.getById !== "function") throw new Error("ARM service requires permissionAttemptRepository");
    if (!riskEvaluationRepository || typeof riskEvaluationRepository.getById !== "function") throw new Error("ARM service requires riskEvaluationRepository");
    if (!armOperationRepository || typeof armOperationRepository.beginRequest !== "function") throw new Error("ARM service requires armOperationRepository");
    if (!armLifecycleAuthority || typeof armLifecycleAuthority.authorizeFromCommit !== "function") throw new Error("ARM service requires armLifecycleAuthority");
    if (!handoffRepository || typeof handoffRepository.record !== "function") throw new Error("ARM service requires handoffRepository");
    if (!deliveryRepository || typeof deliveryRepository.register !== "function") throw new Error("ARM service requires deliveryRepository");
    if (!ocoService || typeof ocoService.armGate !== "function") throw new Error("ARM service requires ocoService");
    if (typeof clock !== "function") throw new Error("clock must be a function");
    this.lifecycleCoordinator = lifecycleCoordinator;
    this.permissionPipeline = permissionPipeline;
    this.reviewService = reviewService;
    this.reviewRepository = reviewRepository;
    this.permissionAttemptRepository = permissionAttemptRepository;
    this.riskEvaluationRepository = riskEvaluationRepository;
    this.armOperationRepository = armOperationRepository;
    this.armLifecycleAuthority = armLifecycleAuthority;
    this.handoffRepository = handoffRepository;
    this.deliveryRepository = deliveryRepository;
    this.ocoService = ocoService;
    this.clock = clock;
    this.busy = new Set();
  }

  async arm(command = {}) {
    const operationId = text(command.operationId);
    const candidateId = text(command.candidateId);
    const contractVersion = Number(command.contractVersion);
    const reviewPackageId = text(command.reviewPackageId);
    const selectedQuantity = Number(command.selectedQuantity);
    const confirmedDirection = upper(command.confirmedDirection);
    if (!operationId || !candidateId || !Number.isInteger(contractVersion) || contractVersion < 1 || !reviewPackageId || !Number.isFinite(selectedQuantity) || selectedQuantity <= 0 || !["LONG", "SHORT"].includes(confirmedDirection)) {
      throw armError("ARM requires operationId, exact candidate/version, reviewPackageId, selectedQuantity, and confirmedDirection", "INVALID_ARM_REQUEST");
    }

    const entityKey = `${candidateId}:v${contractVersion}`;
    if (this.busy.has(entityKey)) throw armError("ARM is already in progress for candidate", "ARM_IN_PROGRESS");
    this.busy.add(entityKey);
    let reservedGroup = null;
    try {
      const request = {
        candidateId,
        contractVersion,
        reviewPackageId,
        selectedQuantity,
        confirmedDirection,
        accountId: text(command.accountId),
        entryMode: upper(command.entryMode),
        triggerPrice: command.triggerPrice ?? null,
        operatorStructuralAssessment: command.operatorStructuralAssessment ?? null,
        operatorPermissionAssessment: command.operatorPermissionAssessment ?? null,
      };
      let operation = this.armOperationRepository.beginRequest({ operationId, request });
      if (["AUTHORIZED", "COMPLETED"].includes(operation.status)) return this.#completeAuthorization(operation, true);
      if (["REVIEW_REQUIRED", "REJECTED"].includes(operation.status)) return { status: operation.status, operation };

      const precheck = this.reviewService.readiness(candidateId, contractVersion, reviewPackageId);
      if (!precheck.armEligible) {
        operation = this.armOperationRepository.reject(operationId, { reasonCode: precheck.reasonCode, details: { review: precheck.review } });
        return { status: "REJECTED", operation };
      }
      if (Number(precheck.review.selectedQuantity.value) !== selectedQuantity) {
        operation = this.armOperationRepository.reject(operationId, { reasonCode: "ARM_QUANTITY_CONFIRMATION_MISMATCH" });
        return { status: "REJECTED", operation };
      }
      if (upper(precheck.candidate.direction) !== confirmedDirection) {
        operation = this.armOperationRepository.reject(operationId, { reasonCode: "ARM_DIRECTION_CONFIRMATION_MISMATCH" });
        return { status: "REJECTED", operation };
      }
      const reviewAccountId = text(precheck.review.currentPackage.material.accountId);
      if (text(command.accountId) !== reviewAccountId) {
        operation = this.armOperationRepository.reject(operationId, { reasonCode: "ARM_ACCOUNT_CONFIRMATION_MISMATCH" });
        return { status: "REJECTED", operation };
      }
      if (!upper(command.entryMode)) {
        operation = this.armOperationRepository.reject(operationId, { reasonCode: "ARM_ENTRY_MODE_REQUIRED" });
        return { status: "REJECTED", operation };
      }

      let gate = await this.ocoService.armGate({ candidateId, contractVersion, review: precheck.review });
      if (!gate.allowed) {
        operation = this.armOperationRepository.reject(operationId, { reasonCode: gate.reasonCode, details: { conflicts: gate.conflicts || [], executionOwnership: gate.executionOwnership || null } });
        return { status: "REJECTED", operation };
      }

      const revalidation = this.lifecycleCoordinator.revalidatePermission({
        operationId: `${operationId}:REVALIDATE_PERMISSION`,
        candidateId,
        contractVersion,
        expectedState: canonicalLifecycleState(precheck.candidate.lifecycleState),
        expectedRevision: precheck.candidate.stateRevision,
        source: "OPERATOR",
        reason: "FINAL_ARM_REVALIDATION",
        provenance: { authority: PRETRADE_ARM_SERVICE_AUTHORITY, armOperationId: operationId, reviewPackageId },
      });

      const permission = await this.permissionPipeline.evaluate({
        operationId: `${operationId}:ARM_PERMISSION`,
        candidateId,
        contractVersion,
        expectedState: "PERMISSION_EVALUATING",
        expectedRevision: revalidation.stateRevision,
        accountId: reviewAccountId,
        entryMode: upper(command.entryMode),
        triggerPrice: command.triggerPrice ?? null,
        operatorStructuralAssessment: command.operatorStructuralAssessment ?? null,
        operatorPermissionAssessment: command.operatorPermissionAssessment ?? null,
      });

      const postPermissionCandidate = this.lifecycleCoordinator.candidateSnapshot(candidateId, contractVersion);
      const postState = canonicalLifecycleState(postPermissionCandidate.lifecycleState);
      if (!["READY", "CAUTION"].includes(postState)) {
        const reasonCode = postState === "PASS" ? "ARM_REVALIDATION_PASS" : permission.permissionAttempt?.result?.reasonCode || "ARM_REVALIDATION_BLOCKED";
        operation = this.armOperationRepository.reject(operationId, { reasonCode, details: { lifecycleState: postState, permissionStatus: permission.status } });
        return { status: "REJECTED", operation, candidate: postPermissionCandidate };
      }

      const refreshed = this.reviewService.refresh({
        operationId: `${operationId}:REFRESH_REVIEW`,
        candidateId,
        contractVersion,
      });
      const refreshedReview = refreshed.review;
      if (refreshedReview.currentPackage.reviewPackageId !== reviewPackageId) {
        operation = this.armOperationRepository.markReviewRequired(operationId, {
          reasonCode: "ARM_REVIEW_PACKAGE_CHANGED",
          details: { previousReviewPackageId: reviewPackageId, currentReviewPackageId: refreshedReview.currentPackage.reviewPackageId },
        });
        return { status: "REVIEW_REQUIRED", operation, review: refreshedReview, candidate: refreshed.candidate };
      }

      const readiness = this.reviewService.readiness(candidateId, contractVersion, reviewPackageId);
      if (!readiness.armEligible || Number(readiness.review.selectedQuantity?.value) !== selectedQuantity) {
        operation = this.armOperationRepository.markReviewRequired(operationId, {
          reasonCode: readiness.reasonCode || "ARM_REVIEW_STATE_CHANGED",
          details: { review: readiness.review },
        });
        return { status: "REVIEW_REQUIRED", operation, review: readiness.review, candidate: readiness.candidate };
      }

      gate = await this.ocoService.armGate({ candidateId, contractVersion, review: readiness.review });
      if (!gate.allowed) {
        operation = this.armOperationRepository.reject(operationId, { reasonCode: gate.reasonCode, details: { conflicts: gate.conflicts || [], executionOwnership: gate.executionOwnership || null } });
        return { status: "REJECTED", operation };
      }
      reservedGroup = gate.group ? this.ocoService.beginArmCommit({
        group: gate.group,
        operationId,
        winner: { candidateId, contractVersion },
      }) : null;

      const riskEvaluationId = text(readiness.review.currentPackage.evidence.riskEvaluationId);
      const riskEvaluation = this.riskEvaluationRepository.getById(riskEvaluationId);
      this.#assertFreshRisk(riskEvaluation);
      if (text(riskEvaluation.account?.accountId) !== reviewAccountId) throw armError("fresh risk evaluation account changed", "ARM_ACCOUNT_CHANGED");
      if (text(riskEvaluation.dss?.dssEvaluationId) !== text(readiness.review.currentPackage.evidence.dssEvaluationId)) throw armError("fresh risk evaluation DSS changed", "ARM_DSS_CHANGED");

      const candidate = this.lifecycleCoordinator.candidateSnapshot(candidateId, contractVersion);
      const authorizedAt = this.#time();
      const handoffId = `handoff-${digest({ operationId, candidateId, contractVersion }).slice(0, 40)}`;
      const ocoSiblings = reservedGroup ? reservedGroup.members.filter((member) => !(member.candidateId === candidateId && Number(member.contractVersion) === contractVersion)) : [];
      operation = this.armOperationRepository.authorize(operationId, {
        candidateId,
        contractVersion,
        candidateContentHash: candidate.contentHash,
        symbol: candidate.symbol,
        direction: candidate.direction,
        reviewPackageId,
        permissionAttemptId: readiness.review.currentPackage.evidence.permissionAttemptId,
        permissionState: canonicalLifecycleState(candidate.lifecycleState),
        permissionStateRevision: candidate.stateRevision,
        dssEvaluationId: readiness.review.currentPackage.evidence.dssEvaluationId,
        riskEvaluationId,
        accountId: reviewAccountId,
        selectedQuantity,
        authorizedAt,
        handoffId,
        handoffCreatedAt: authorizedAt,
        ocoGroupId: reservedGroup?.groupId || null,
        ocoSiblings,
        executionOwnershipProof: gate.executionOwnership,
      });
      return this.#completeAuthorization(operation, false);
    } catch (error) {
      if (reservedGroup) {
        const operation = this.armOperationRepository.getByOperationId(operationId);
        if (!operation || operation.status === "REQUESTED") {
          try { this.ocoService.releaseArmCommit({ group: reservedGroup, operationId }); } catch { /* recovery will reconcile */ }
        }
      }
      throw error;
    } finally {
      this.busy.delete(entityKey);
    }
  }

  recoverAll() {
    const ocoRecovery = this.ocoService.recoverCommitting(this.armOperationRepository);
    const results = [];
    for (const operation of this.armOperationRepository.snapshot().operations.filter((item) => item.status === "AUTHORIZED")) {
      try {
        results.push({ operationId: operation.operationId, status: "RECOVERED", result: this.#completeAuthorization(operation, true) });
      } catch (error) {
        results.push({ operationId: operation.operationId, status: "RECOVERY_BLOCKED", code: error.code || "ARM_RECOVERY_ERROR", message: error.message });
      }
    }
    return { ocoRecovery, operations: results };
  }

  #completeAuthorization(operation, recovery) {
    const proof = armAuthorizationProof(operation);
    if (!proof) throw armError("ARM operation has no durable authorization proof", "ARM_AUTHORIZATION_NOT_PROVEN");
    const current = this.lifecycleCoordinator.candidateSnapshot(proof.candidateId, proof.contractVersion);
    const currentState = canonicalLifecycleState(current.lifecycleState);

    let armTransition;
    if (currentState === "ARMED") {
      this.#assertExistingArmMatchesProof(current, proof);
      armTransition = {
        operationId: `${proof.operationId}:CANDIDATE_ARM`,
        candidateId: proof.candidateId,
        contractVersion: proof.contractVersion,
        lifecycleState: "ARMED",
        stateRevision: current.stateRevision,
        recoveredExistingAuthorization: true,
      };
    } else {
      const expectedState = recovery && currentState === "EXPIRED" ? "EXPIRED" : proof.permissionState;
      const expectedRevision = recovery && currentState === "EXPIRED" ? current.stateRevision : proof.permissionStateRevision;
      armTransition = this.armLifecycleAuthority.authorizeFromCommit({
        operationId: `${proof.operationId}:CANDIDATE_ARM`,
        candidateId: proof.candidateId,
        contractVersion: proof.contractVersion,
        expectedState,
        expectedRevision,
        recovery,
        armCommit: proof,
        reason: recovery ? "ARM_RECOVERY_FORWARD_COMPLETE" : "OPERATOR_ARM",
        provenance: { armOperationId: proof.operationId, reviewPackageId: proof.reviewPackageId },
      });
    }

    const armedCandidate = this.lifecycleCoordinator.candidateSnapshot(proof.candidateId, proof.contractVersion);
    if (armedCandidate.lifecycleState !== "ARMED") throw armError("candidate ARM transition did not establish ARMED", "ARM_CANDIDATE_COMMIT_FAILED");
    const riskEvaluation = this.riskEvaluationRepository.getById(proof.riskEvaluationId);
    const expectedHandoff = buildExecutionBoardHandoff({
      handoffId: proof.handoffId,
      createdAt: proof.handoffCreatedAt,
      candidate: armedCandidate,
      riskEvaluation,
    });

    let handoff;
    try {
      handoff = this.handoffRepository.getById(proof.handoffId);
      if (!deepEqual(handoff, expectedHandoff)) throw armError("existing handoff conflicts with durable ARM proof", "ARM_HANDOFF_CONFLICT");
    } catch (error) {
      if (error?.code !== "EXECUTION_BOARD_HANDOFF_NOT_FOUND") throw error;
      this.handoffRepository.record(expectedHandoff);
      handoff = this.handoffRepository.getById(proof.handoffId);
    }
    const delivery = this.deliveryRepository.register(proof.handoffId);

    let ocoGroup = null;
    if (proof.ocoGroupId) {
      ocoGroup = this.ocoService.completeWinner({
        groupId: proof.ocoGroupId,
        operationId: proof.operationId,
        winner: { candidateId: proof.candidateId, contractVersion: proof.contractVersion },
      });
    }

    const completed = this.armOperationRepository.markCompleted(proof.operationId);
    return {
      status: "COMPLETED",
      duplicateOperation: operation.status === "COMPLETED",
      operation: completed,
      armTransition,
      candidate: this.lifecycleCoordinator.candidateSnapshot(proof.candidateId, proof.contractVersion),
      handoff,
      delivery,
      ocoGroup,
      brokerWriteAuthority: false,
    };
  }

  #assertExistingArmMatchesProof(candidate, proof) {
    const arm = candidate?.arm;
    if (
      text(candidate?.contentHash) !== text(proof.candidateContentHash)
      || upper(candidate?.direction) !== upper(proof.direction)
      || text(candidate?.authorizedDssEvaluationId) !== text(proof.dssEvaluationId)
      || text(candidate?.authorizedRiskEvaluationId) !== text(proof.riskEvaluationId)
      || !arm
      || text(arm.armOperationId) !== text(proof.operationId)
      || text(arm.reviewPackageId) !== text(proof.reviewPackageId)
      || text(arm.handoffId) !== text(proof.handoffId)
      || text(arm.executionAccountId) !== text(proof.accountId)
      || Number(arm.selectedQuantity) !== Number(proof.selectedQuantity)
      || timestampMs(arm.authorizedAt) !== timestampMs(proof.authorizedAt)
    ) {
      throw armError("existing ARMED candidate conflicts with durable ARM authorization proof", "ARM_RECOVERY_EXISTING_AUTHORIZATION_CONFLICT");
    }
  }

  #assertFreshRisk(riskEvaluation) {
    if (upper(riskEvaluation?.status) !== "VALID") throw armError("ARM requires VALID fresh risk evaluation", "ARM_RISK_EVALUATION_NOT_VALID");
    const nowMs = timestampMs(this.#time());
    const quoteMs = timestampMs(riskEvaluation.entry?.quoteObservedAt);
    const accountMs = timestampMs(riskEvaluation.account?.snapshotObservedAt);
    if (nowMs === null || quoteMs === null || accountMs === null) throw armError("ARM risk freshness provenance is incomplete", "ARM_RISK_EVALUATION_STALE");
    if (Math.max(0, nowMs - quoteMs) > 5_000 || Math.max(0, nowMs - accountMs) > 15_000) throw armError("ARM risk evaluation is stale", "ARM_RISK_EVALUATION_STALE");
  }

  #time() {
    const parsed = Date.parse(String(this.clock() ?? ""));
    if (!Number.isFinite(parsed)) throw armError("ARM service clock returned invalid timestamp", "ARM_CLOCK_INVALID");
    return new Date(parsed).toISOString();
  }
}
