import { buildPreTradeReviewPackage } from "./pretrade-review.mjs";
import { canonicalLifecycleState } from "./pretrade-state.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function serviceError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

export class PreTradeReviewService {
  constructor({ lifecycleCoordinator, permissionAttemptRepository, reviewRepository, clock = () => new Date().toISOString() } = {}) {
    if (!lifecycleCoordinator || typeof lifecycleCoordinator.candidateSnapshot !== "function") {
      throw new Error("PreTradeReviewService requires lifecycleCoordinator.candidateSnapshot()");
    }
    if (!permissionAttemptRepository || typeof permissionAttemptRepository.getById !== "function") {
      throw new Error("PreTradeReviewService requires permissionAttemptRepository.getById()");
    }
    if (!reviewRepository || typeof reviewRepository.syncPackage !== "function") {
      throw new Error("PreTradeReviewService requires reviewRepository");
    }
    if (typeof clock !== "function") throw new Error("clock must be a function");
    this.lifecycleCoordinator = lifecycleCoordinator;
    this.permissionAttemptRepository = permissionAttemptRepository;
    this.reviewRepository = reviewRepository;
    this.clock = clock;
  }

  refresh({ operationId, candidateId, contractVersion } = {}) {
    const candidate = this.lifecycleCoordinator.candidateSnapshot(candidateId, contractVersion);
    const state = canonicalLifecycleState(candidate.lifecycleState);
    if (!["READY", "CAUTION"].includes(state)) {
      throw serviceError(`candidate is not reviewable while ${state}`, "REVIEW_NOT_ALLOWED_IN_STATE");
    }
    const permissionAttemptId = text(candidate.currentPermissionOutcome?.permissionEvaluationId);
    if (!permissionAttemptId) throw serviceError("candidate has no current permission attempt", "REVIEW_PERMISSION_ATTEMPT_REQUIRED");
    const permissionAttempt = this.permissionAttemptRepository.getById(permissionAttemptId);
    const reviewPackage = buildPreTradeReviewPackage({
      candidate,
      permissionAttempt,
      generatedAt: this.clock(),
    });
    const review = this.reviewRepository.syncPackage({ operationId, reviewPackage });
    return { review, candidate };
  }

  selectQuantity({ operationId, candidateId, contractVersion, reviewPackageId, selectedQuantity } = {}) {
    this.#assertCurrentReviewPackage(candidateId, contractVersion, reviewPackageId);
    return this.reviewRepository.selectQuantity({
      operationId,
      candidateId,
      contractVersion,
      reviewPackageId,
      selectedQuantity,
    });
  }

  acknowledgeCaution({ operationId, candidateId, contractVersion, reviewPackageId, acknowledged = true } = {}) {
    this.#assertCurrentReviewPackage(candidateId, contractVersion, reviewPackageId);
    return this.reviewRepository.acknowledgeCaution({
      operationId,
      candidateId,
      contractVersion,
      reviewPackageId,
      acknowledged,
    });
  }

  readiness(candidateId, contractVersion, expectedReviewPackageId = null) {
    const candidate = this.lifecycleCoordinator.candidateSnapshot(candidateId, contractVersion);
    const state = canonicalLifecycleState(candidate.lifecycleState);
    if (!["READY", "CAUTION"].includes(state)) {
      return { armEligible: false, reasonCode: "REVIEW_NOT_ALLOWED_IN_STATE", candidate, review: null };
    }
    const review = this.reviewRepository.get(candidateId, contractVersion);
    if (!review) return { armEligible: false, reasonCode: "REVIEW_NOT_FOUND", candidate, review: null };
    if (expectedReviewPackageId && review.currentPackage.reviewPackageId !== expectedReviewPackageId) {
      return { armEligible: false, reasonCode: "STALE_REVIEW_PACKAGE", candidate, review };
    }
    const currentPermissionAttemptId = text(candidate.currentPermissionOutcome?.permissionEvaluationId);
    if (review.currentPackage.evidence.permissionAttemptId !== currentPermissionAttemptId) {
      return { armEligible: false, reasonCode: "REVIEW_EVIDENCE_STALE", candidate, review };
    }
    if (!review.selectedQuantity || review.selectedQuantity.reviewPackageId !== review.currentPackage.reviewPackageId) {
      return { armEligible: false, reasonCode: "SELECTED_QUANTITY_REQUIRED", candidate, review };
    }
    if (state === "CAUTION") {
      if (!review.cautionAcknowledgment || review.cautionAcknowledgment.reviewPackageId !== review.currentPackage.reviewPackageId) {
        return { armEligible: false, reasonCode: "CAUTION_ACK_REQUIRED", candidate, review };
      }
    }
    return { armEligible: true, reasonCode: null, candidate, review };
  }

  #assertCurrentReviewPackage(candidateId, contractVersion, reviewPackageId) {
    const candidate = this.lifecycleCoordinator.candidateSnapshot(candidateId, contractVersion);
    if (!["READY", "CAUTION"].includes(canonicalLifecycleState(candidate.lifecycleState))) {
      throw serviceError("review mutation requires READY or CAUTION", "REVIEW_NOT_ALLOWED_IN_STATE");
    }
    const review = this.reviewRepository.get(candidateId, contractVersion);
    if (!review) throw serviceError("candidate has no current review package", "REVIEW_NOT_FOUND");
    if (review.currentPackage.reviewPackageId !== text(reviewPackageId)) {
      throw serviceError("reviewPackageId is stale", "STALE_REVIEW_PACKAGE");
    }
    const permissionAttemptId = text(candidate.currentPermissionOutcome?.permissionEvaluationId);
    if (review.currentPackage.evidence.permissionAttemptId !== permissionAttemptId) {
      throw serviceError("review package no longer matches current permission evidence", "REVIEW_EVIDENCE_STALE");
    }
  }
}
