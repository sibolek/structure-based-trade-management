import crypto from "node:crypto";
import { assertCanonicalCandidateIntegrity } from "./pretrade-candidate-contract.mjs";
import { canonicalLifecycleState } from "./pretrade-state.mjs";
import { mapRiskSizingToPermission } from "./risk-sizing-permission-handoff.mjs";
import {
  buildPermissionAttempt,
  permissionAttemptHash,
  PRETRADE_PERMISSION_PIPELINE_AUTHORITY,
} from "./pretrade-permission-attempt.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function pipelineError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function dssStatus(result) {
  return upper(result?.status ?? result?.evaluation?.status);
}

function errorReasons(error, fallback) {
  const reasons = Array.isArray(error?.reasonCodes) ? error.reasonCodes.map(upper).filter(Boolean) : [];
  return reasons.length ? reasons : [fallback];
}

function defaultDecisionPolicy() {
  return { outcome: "READY", reasonCodes: [] };
}

export class PreTradePermissionPipeline {
  constructor({
    store,
    lifecycleCoordinator,
    structuralValidityService,
    dssPermissionService,
    riskSizingPermissionService,
    riskEvaluationRepository,
    attemptRepository,
    decisionPolicy = defaultDecisionPolicy,
    clock = () => new Date().toISOString(),
    idFactory = () => crypto.randomUUID(),
  } = {}) {
    if (!store || typeof store.snapshot !== "function") throw new Error("permission pipeline requires PRETRADE store");
    if (!lifecycleCoordinator || typeof lifecycleCoordinator.publishPermissionOutcome !== "function" || typeof lifecycleCoordinator.setPermissionBlocker !== "function") {
      throw new Error("permission pipeline requires lifecycle coordinator");
    }
    if (!structuralValidityService || typeof structuralValidityService.evaluate !== "function" || typeof structuralValidityService.dssInputs !== "function") {
      throw new Error("permission pipeline requires structural validity service");
    }
    if (!dssPermissionService || typeof dssPermissionService.evaluate !== "function") throw new Error("permission pipeline requires DSS permission service");
    if (!riskSizingPermissionService || typeof riskSizingPermissionService.evaluate !== "function") throw new Error("permission pipeline requires Phase 4 permission service");
    if (!riskEvaluationRepository || typeof riskEvaluationRepository.getById !== "function") throw new Error("permission pipeline requires risk evaluation repository");
    if (!attemptRepository || typeof attemptRepository.record !== "function" || typeof attemptRepository.getByOperationId !== "function") {
      throw new Error("permission pipeline requires permission attempt repository");
    }
    if (typeof decisionPolicy !== "function") throw new Error("decisionPolicy must be a function");
    if (typeof clock !== "function") throw new Error("clock must be a function");
    if (typeof idFactory !== "function") throw new Error("idFactory must be a function");

    this.store = store;
    this.lifecycleCoordinator = lifecycleCoordinator;
    this.structuralValidityService = structuralValidityService;
    this.dssPermissionService = dssPermissionService;
    this.riskSizingPermissionService = riskSizingPermissionService;
    this.riskEvaluationRepository = riskEvaluationRepository;
    this.attemptRepository = attemptRepository;
    this.decisionPolicy = decisionPolicy;
    this.clock = clock;
    this.idFactory = idFactory;
    this.busy = new Set();
  }

  async evaluate(command = {}) {
    const operationId = text(command.operationId);
    const candidateId = text(command.candidateId);
    const contractVersion = Number(command.contractVersion);
    if (!operationId) throw pipelineError("operationId is required", "PERMISSION_OPERATION_ID_REQUIRED");
    if (!candidateId || !Number.isInteger(contractVersion) || contractVersion < 1) {
      throw pipelineError("candidateId and integer contractVersion >= 1 are required", "INVALID_PERMISSION_CANDIDATE_IDENTITY");
    }

    const key = `${candidateId}:v${contractVersion}`;
    if (this.busy.has(key)) throw pipelineError("permission evaluation is already in progress for candidate", "PERMISSION_EVALUATION_IN_PROGRESS");
    this.busy.add(key);
    try {
      const operationPayload = {
        candidateId,
        contractVersion,
        accountId: text(command.accountId),
        entryMode: upper(command.entryMode),
        triggerPrice: command.triggerPrice ?? null,
        operatorStructuralAssessment: command.operatorStructuralAssessment ?? null,
      };
      const operationHash = permissionAttemptHash(operationPayload);
      const prior = this.attemptRepository.getByOperationId(operationId);
      if (prior) {
        if (text(prior.operationHash) !== operationHash) {
          throw pipelineError("operationId is already bound to different permission inputs", "PERMISSION_OPERATION_ID_CONFLICT");
        }
        return this.#completeAttempt(prior, true);
      }

      const candidate = this.#candidate(candidateId, contractVersion);
      assertCanonicalCandidateIntegrity(candidate);
      candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
      if (candidate.lifecycleState !== "PERMISSION_EVALUATING") {
        throw pipelineError(`permission evaluation is not allowed while candidate is ${candidate.lifecycleState}`, "PERMISSION_NOT_ALLOWED_IN_STATE");
      }
      if (command.expectedState !== undefined && canonicalLifecycleState(command.expectedState) !== candidate.lifecycleState) {
        throw pipelineError("permission expected lifecycle state is stale", "STALE_LIFECYCLE_STATE");
      }
      if (command.expectedRevision !== undefined && Number(command.expectedRevision) !== Number(candidate.stateRevision || 0)) {
        throw pipelineError("permission expected stateRevision is stale", "STALE_STATE_REVISION");
      }
      if (!candidate.triggerSatisfaction || candidate.triggerSatisfaction.authority !== "PRETRADE_TRIGGER_ENGINE") {
        throw pipelineError("authoritative trigger satisfaction is required", "TRIGGER_SATISFACTION_NOT_AUTHORITATIVE");
      }
      if (!operationPayload.accountId) throw pipelineError("exact accountId is required", "PERMISSION_ACCOUNT_REQUIRED");
      if (!operationPayload.entryMode) throw pipelineError("entryMode is required", "PERMISSION_ENTRY_MODE_REQUIRED");

      const startedAt = this.#time();
      const permissionAttemptId = text(this.idFactory());
      if (!permissionAttemptId) throw pipelineError("idFactory returned an empty permissionAttemptId", "PERMISSION_ATTEMPT_ID_INVALID");

      const structuralValidity = await this.structuralValidityService.evaluate({
        candidate: clone(candidate),
        operatorAssessment: command.operatorStructuralAssessment ?? null,
      });

      let dssResult = null;
      let riskEvaluation = null;
      let result;
      const structuralStatus = upper(structuralValidity.status);

      if (structuralStatus === "INVALID") {
        result = {
          kind: "OUTCOME",
          outcome: "PASS",
          reasonCode: "STRUCTURAL_INVALID",
          reasonCodes: structuralValidity.reasonCodes,
        };
      } else if (structuralStatus === "BLOCKED") {
        result = {
          kind: "BLOCKED_RETRYABLE",
          reasonCode: structuralValidity.reasonCodes?.[0] || "STRUCTURAL_VALIDITY_BLOCKED",
          reasonCodes: structuralValidity.reasonCodes,
        };
      } else {
        const dssInputs = this.structuralValidityService.dssInputs(candidate, structuralValidity);
        try {
          dssResult = await this.dssPermissionService.evaluate({
            sourceId: candidate.source,
            candidateId,
            contractVersion,
            ...dssInputs,
          });
        } catch (error) {
          dssResult = {
            action: "FAILED",
            status: upper(error?.status) === "BLOCKED" ? "BLOCKED" : "ERROR",
            reasonCodes: errorReasons(error, upper(error?.status) === "BLOCKED" ? "DSS_BLOCKED" : "DSS_ERROR"),
            errorCode: text(error?.code) || null,
          };
        }

        const phase3Status = dssStatus(dssResult);
        if (phase3Status === "BLOCKED") {
          result = {
            kind: "BLOCKED_RETRYABLE",
            reasonCode: dssResult.reasonCodes?.[0] || dssResult.evaluation?.reasonCodes?.[0] || "DSS_BLOCKED",
            reasonCodes: dssResult.reasonCodes || dssResult.evaluation?.reasonCodes || ["DSS_BLOCKED"],
          };
        } else if (phase3Status !== "VALID") {
          result = {
            kind: "BLOCKED_INTEGRITY",
            reasonCode: dssResult.reasonCodes?.[0] || dssResult.evaluation?.reasonCodes?.[0] || "DSS_ERROR",
            reasonCodes: dssResult.reasonCodes || dssResult.evaluation?.reasonCodes || ["DSS_ERROR"],
          };
        } else {
          let phase4Result;
          try {
            phase4Result = await this.riskSizingPermissionService.evaluate({
              sourceId: candidate.source,
              candidateId,
              contractVersion,
              accountId: operationPayload.accountId,
              entryMode: operationPayload.entryMode,
              triggerPrice: operationPayload.triggerPrice,
            });
          } catch (error) {
            phase4Result = {
              status: "ERROR",
              reasonCodes: errorReasons(error, text(error?.code) || "PHASE4_ERROR"),
              riskEvaluationId: null,
              dssEvaluationId: dssResult.dssEvaluationId,
            };
          }

          if (text(phase4Result.riskEvaluationId)) {
            riskEvaluation = this.riskEvaluationRepository.getById(phase4Result.riskEvaluationId);
          }
          const mapped = mapRiskSizingToPermission(phase4Result);
          if (mapped.consequence === "PASS") {
            result = {
              kind: "OUTCOME",
              outcome: "PASS",
              reasonCode: mapped.permissionReason || "STOP_RISK_CONFLICT",
              reasonCodes: mapped.reasonCodes,
            };
          } else if (mapped.consequence === "BLOCKED") {
            result = {
              kind: "BLOCKED_RETRYABLE",
              reasonCode: mapped.reasonCodes?.[0] || "PHASE4_BLOCKED",
              reasonCodes: mapped.reasonCodes,
            };
          } else if (mapped.consequence === "ERROR") {
            result = {
              kind: "BLOCKED_INTEGRITY",
              reasonCode: mapped.reasonCodes?.[0] || "PHASE4_ERROR",
              reasonCodes: mapped.reasonCodes,
            };
          } else {
            const decision = await this.decisionPolicy({
              candidate: clone(candidate),
              structuralValidity: clone(structuralValidity),
              dssResult: clone(dssResult),
              riskEvaluation: clone(riskEvaluation),
            });
            const outcome = upper(decision?.outcome || "READY");
            const reasonCodes = [...new Set((decision?.reasonCodes || []).map(upper).filter(Boolean))];
            if (!["READY", "CAUTION", "PASS"].includes(outcome)) {
              throw pipelineError("decisionPolicy returned an unsupported outcome", "INVALID_PERMISSION_DECISION_POLICY_RESULT");
            }
            if (outcome === "CAUTION" && reasonCodes.length === 0) {
              throw pipelineError("CAUTION requires at least one reasonCode", "INVALID_PERMISSION_DECISION_POLICY_RESULT");
            }
            result = {
              kind: "OUTCOME",
              outcome,
              reasonCode: text(decision?.reasonCode) || (outcome === "PASS" ? "PERMISSION_POLICY_PASS" : null),
              reasonCodes,
            };
          }
        }
      }

      const completedAt = this.#time();
      const attempt = buildPermissionAttempt({
        permissionAttemptId,
        operationId,
        operationHash,
        candidate,
        triggerSatisfaction: candidate.triggerSatisfaction,
        structuralValidity,
        dssResult,
        riskEvaluation,
        result,
        startedAt,
        completedAt,
      });
      const persisted = this.attemptRepository.record(attempt);
      return this.#completeAttempt(persisted, false);
    } finally {
      this.busy.delete(key);
    }
  }

  recoverAll() {
    const attempts = this.attemptRepository.snapshot().attempts || [];
    const latest = new Map();
    for (const attempt of attempts) {
      const key = `${attempt.candidate.candidateId}:v${attempt.candidate.contractVersion}`;
      const prior = latest.get(key);
      if (!prior || Date.parse(attempt.completedAt) >= Date.parse(prior.completedAt)) latest.set(key, attempt);
    }
    return [...latest.values()].map((attempt) => {
      try {
        return { status: "RECOVERED", permissionAttemptId: attempt.permissionAttemptId, result: this.#completeAttempt(attempt, true) };
      } catch (error) {
        return {
          status: "RECOVERY_BLOCKED",
          permissionAttemptId: attempt.permissionAttemptId,
          candidateId: attempt.candidate.candidateId,
          contractVersion: attempt.candidate.contractVersion,
          code: error.code || "PERMISSION_RECOVERY_ERROR",
          message: error.message,
        };
      }
    });
  }

  #completeAttempt(attempt, duplicateOperation) {
    const candidate = this.#candidate(attempt.candidate.candidateId, attempt.candidate.contractVersion);
    candidate.lifecycleState = canonicalLifecycleState(candidate.lifecycleState);
    const result = attempt.result;

    if (result.kind === "OUTCOME") {
      const outcome = upper(result.outcome);
      if (
        candidate.lifecycleState === outcome
        && text(candidate.currentPermissionOutcome?.permissionEvaluationId) === text(attempt.permissionAttemptId)
      ) {
        return {
          status: "ESTABLISHED",
          duplicateOperation,
          permissionAttempt: clone(attempt),
          lifecycle: this.lifecycleCoordinator.candidateSnapshot(candidate.candidateId, candidate.contractVersion),
        };
      }
      if (candidate.lifecycleState !== "PERMISSION_EVALUATING") {
        throw pipelineError(`cannot complete permission attempt while candidate is ${candidate.lifecycleState}`, "PERMISSION_ATTEMPT_STATE_CONFLICT");
      }
      const transition = this.lifecycleCoordinator.publishPermissionOutcome({
        operationId: `PERMISSION_OUTCOME:${attempt.permissionAttemptId}`,
        candidateId: candidate.candidateId,
        contractVersion: candidate.contractVersion,
        expectedState: "PERMISSION_EVALUATING",
        expectedRevision: Number(candidate.stateRevision || 0),
        outcome,
        permissionEvaluationId: attempt.permissionAttemptId,
        source: PRETRADE_PERMISSION_PIPELINE_AUTHORITY,
        reason: result.reasonCode,
        provenance: {
          permissionAttemptId: attempt.permissionAttemptId,
          operationId: attempt.operationId,
          structuralEvaluationId: attempt.structuralValidity?.structuralEvaluationId || null,
          dssEvaluationId: attempt.dss?.dssEvaluationId || null,
          riskEvaluationId: attempt.phase4?.riskEvaluationId || null,
          reasonCodes: result.reasonCodes,
        },
      });
      return { status: "COMPLETED", duplicateOperation, permissionAttempt: clone(attempt), transition };
    }

    const blockerStatus = result.kind === "BLOCKED_RETRYABLE" ? "BLOCKED_RETRYABLE" : "BLOCKED_INTEGRITY";
    if (
      candidate.lifecycleState === "PERMISSION_EVALUATING"
      && candidate.permissionBlocker?.provenance?.permissionAttemptId === attempt.permissionAttemptId
    ) {
      return {
        status: "ESTABLISHED",
        duplicateOperation,
        permissionAttempt: clone(attempt),
        lifecycle: this.lifecycleCoordinator.candidateSnapshot(candidate.candidateId, candidate.contractVersion),
      };
    }
    if (candidate.lifecycleState !== "PERMISSION_EVALUATING") {
      throw pipelineError(`cannot establish permission blocker while candidate is ${candidate.lifecycleState}`, "PERMISSION_ATTEMPT_STATE_CONFLICT");
    }
    const transition = this.lifecycleCoordinator.setPermissionBlocker({
      operationId: `PERMISSION_BLOCKER:${attempt.permissionAttemptId}`,
      candidateId: candidate.candidateId,
      contractVersion: candidate.contractVersion,
      expectedState: "PERMISSION_EVALUATING",
      expectedRevision: Number(candidate.stateRevision || 0),
      blockerStatus,
      reasonCode: result.reasonCode || result.reasonCodes?.[0] || "PERMISSION_BLOCKED",
      source: PRETRADE_PERMISSION_PIPELINE_AUTHORITY,
      provenance: {
        permissionAttemptId: attempt.permissionAttemptId,
        operationId: attempt.operationId,
        structuralEvaluationId: attempt.structuralValidity?.structuralEvaluationId || null,
        dssEvaluationId: attempt.dss?.dssEvaluationId || null,
        riskEvaluationId: attempt.phase4?.riskEvaluationId || null,
        reasonCodes: result.reasonCodes,
      },
    });
    return { status: "BLOCKED", duplicateOperation, permissionAttempt: clone(attempt), transition };
  }

  #candidate(candidateId, contractVersion) {
    const candidate = this.store.snapshot().candidates?.find((item) => (
      text(item?.candidateId) === text(candidateId)
      && Number(item?.contractVersion) === Number(contractVersion)
    ));
    if (!candidate) throw pipelineError(`candidate ${candidateId} v${contractVersion} was not found`, "CANDIDATE_NOT_FOUND");
    return candidate;
  }

  #time() {
    const normalized = timestamp(this.clock());
    if (!normalized) throw pipelineError("permission pipeline clock returned an invalid timestamp", "PERMISSION_PIPELINE_CLOCK_INVALID");
    return normalized;
  }
}
