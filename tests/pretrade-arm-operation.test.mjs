import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeArmOperationRepository, armAuthorizationProof } from "../schwab-bridge/pretrade-arm-operation-repository.mjs";

const NOW = "2026-09-06T13:00:00.000Z";

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-arm-op-")), "arm-ops.json");
}

function request(overrides = {}) {
  return {
    candidateId: "candidate-1",
    contractVersion: 1,
    reviewPackageId: "review-1",
    selectedQuantity: 25,
    confirmedDirection: "LONG",
    accountId: "acct-1",
    entryMode: "MARKETABLE_NOW",
    ...overrides,
  };
}

function authorization(overrides = {}) {
  return {
    candidateId: "candidate-1",
    contractVersion: 1,
    candidateContentHash: "hash-1",
    symbol: "NVDA",
    direction: "LONG",
    reviewPackageId: "review-1",
    permissionAttemptId: "permission-1",
    permissionState: "READY",
    permissionStateRevision: 7,
    dssEvaluationId: "dss-1",
    riskEvaluationId: "risk-1",
    accountId: "acct-1",
    selectedQuantity: 25,
    authorizedAt: NOW,
    handoffId: "handoff-1",
    handoffCreatedAt: NOW,
    ...overrides,
  };
}

test("REQUESTED ARM operation is durable but is not authorization proof", () => {
  const repo = new PreTradeArmOperationRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const requested = repo.beginRequest({ operationId: "arm-op-1", request: request() });
  assert.equal(requested.status, "REQUESTED");
  assert.equal(armAuthorizationProof(requested), null);

  const reloaded = new PreTradeArmOperationRepository({ filePath: repo.filePath, clock: () => NOW });
  reloaded.load();
  assert.equal(reloaded.getByOperationId("arm-op-1").status, "REQUESTED");
});

test("same ARM operationId is idempotent only for identical immutable request", () => {
  const repo = new PreTradeArmOperationRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  const first = repo.beginRequest({ operationId: "arm-op-1", request: request() });
  const retry = repo.beginRequest({ operationId: "arm-op-1", request: request() });
  assert.equal(retry.requestHash, first.requestHash);
  assert.throws(
    () => repo.beginRequest({ operationId: "arm-op-1", request: request({ selectedQuantity: 30 }) }),
    (error) => error.code === "ARM_OPERATION_ID_CONFLICT",
  );
});

test("REVIEW_REQUIRED and REJECTED operations can never become authorization proof", () => {
  const repo = new PreTradeArmOperationRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  repo.beginRequest({ operationId: "review-op", request: request() });
  const reviewRequired = repo.markReviewRequired("review-op", { reasonCode: "ARM_REVIEW_PACKAGE_CHANGED" });
  assert.equal(armAuthorizationProof(reviewRequired), null);
  assert.throws(() => repo.authorize("review-op", authorization()), (error) => error.code === "ARM_OPERATION_STATE_CONFLICT");

  repo.beginRequest({ operationId: "reject-op", request: request() });
  const rejected = repo.reject("reject-op", { reasonCode: "EXECUTION_SYMBOL_OWNED" });
  assert.equal(armAuthorizationProof(rejected), null);
});

test("AUTHORIZED freezes exact recovery payload and COMPLETED preserves it", () => {
  const repo = new PreTradeArmOperationRepository({ filePath: tempFile(), clock: () => NOW });
  repo.load();
  repo.beginRequest({ operationId: "arm-op-1", request: request() });
  const authorized = repo.authorize("arm-op-1", authorization());
  const proof = armAuthorizationProof(authorized);
  assert.equal(proof.authority, "PRETRADE_ARM_OPERATION");
  assert.equal(proof.status, "AUTHORIZED");
  assert.equal(proof.selectedQuantity, 25);
  assert.equal(proof.handoffId, "handoff-1");

  const completed = repo.markCompleted("arm-op-1");
  assert.equal(completed.status, "COMPLETED");
  assert.deepEqual(armAuthorizationProof(completed), proof);
});
