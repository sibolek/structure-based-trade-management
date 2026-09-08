import assert from "node:assert/strict";
import test from "node:test";

import { PreTradeArmService } from "../schwab-bridge/pretrade-arm-service.mjs";

const candidate = {
  candidateId: "candidate-1",
  contractVersion: 1,
  contentHash: "hash-1",
  symbol: "MESU26",
  direction: "LONG",
  lifecycleState: "READY",
  stateRevision: 3,
};

const review = {
  currentPackage: {
    reviewPackageId: "review-1",
    material: { accountId: "acct-1" },
    evidence: { permissionAttemptId: "permission-1" },
  },
  selectedQuantity: { value: 2, reviewPackageId: "review-1" },
};

const persistedPermissionAttempt = {
  candidate: {
    candidateId: "candidate-1",
    contractVersion: 1,
    candidateContentHash: "hash-1",
  },
  structuralValidity: {
    source: "OPERATOR",
    status: "VALID",
    resolvedPrice: 7713,
    evidenceReference: "TradingView MES 2m/5m chart",
    reasonCodes: [],
    provenance: { actor: "OPERATOR", note: null },
  },
  permissionDecision: {
    source: "OPERATOR",
    outcome: "READY",
    reasonCode: null,
    reasonCodes: [],
    provenance: { actor: "OPERATOR", note: "setup/context reviewed" },
  },
};

function serviceHarness() {
  let capturedPermissionCommand = null;
  const sentinel = new Error("stop-after-capture");

  const service = new PreTradeArmService({
    lifecycleCoordinator: {
      revalidatePermission() { return { stateRevision: 4 }; },
      candidateSnapshot() { return structuredClone(candidate); },
    },
    permissionPipeline: {
      async evaluate(command) {
        capturedPermissionCommand = structuredClone(command);
        throw sentinel;
      },
    },
    reviewService: {
      readiness() {
        return { armEligible: true, candidate: structuredClone(candidate), review: structuredClone(review) };
      },
    },
    reviewRepository: { get() { return structuredClone(review); } },
    permissionAttemptRepository: {
      getById(id) {
        assert.equal(id, "permission-1");
        return structuredClone(persistedPermissionAttempt);
      },
    },
    riskEvaluationRepository: { getById() { throw new Error("not reached"); } },
    armOperationRepository: {
      beginRequest({ operationId, request }) { return { operationId, status: "REQUESTED", request }; },
      getByOperationId() { return null; },
    },
    armLifecycleAuthority: { authorizeFromCommit() { throw new Error("not reached"); } },
    handoffRepository: { record() { throw new Error("not reached"); } },
    deliveryRepository: { register() { throw new Error("not reached"); } },
    ocoService: {
      async armGate() { return { allowed: true, group: null, executionOwnership: { status: "FREE" } }; },
      releaseArmCommit() {},
    },
    clock: () => "2026-09-08T02:45:00.000Z",
  });

  return { service, sentinel, captured: () => capturedPermissionCommand };
}

test("ARM replays persisted reviewed operator assessments after browser-local draft state is lost", async () => {
  const h = serviceHarness();

  await assert.rejects(
    h.service.arm({
      operationId: "arm-1",
      candidateId: "candidate-1",
      contractVersion: 1,
      reviewPackageId: "review-1",
      selectedQuantity: 2,
      confirmedDirection: "LONG",
      accountId: "acct-1",
      entryMode: "MARKETABLE_NOW",
      operatorStructuralAssessment: null,
      operatorPermissionAssessment: null,
    }),
    (error) => error === h.sentinel,
  );

  const command = h.captured();
  assert.equal(command.operatorStructuralAssessment.status, "VALID");
  assert.equal(command.operatorStructuralAssessment.resolvedPrice, 7713);
  assert.equal(command.operatorStructuralAssessment.evidenceReference, "TradingView MES 2m/5m chart");
  assert.equal(command.operatorPermissionAssessment.outcome, "READY");
  assert.equal(command.operatorPermissionAssessment.note, "setup/context reviewed");
});
