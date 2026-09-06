import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeArmLifecycleAuthority } from "../schwab-bridge/pretrade-arm-lifecycle-authority.mjs";

const NOW = "2026-09-06T15:00:00.000Z";

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-arm-life-")), "state.json");
}

function proposal() {
  return {
    candidateId: "arm-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-06",
    generatedAt: "2026-09-06T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout retest",
    thesis: "Continuation if retest holds",
    trigger: { type: "MANUAL_CONFIRMATION", evaluatorVersion: 1 },
    structuralInvalidation: { price: 179.5, rule: "break below retest", referenceType: "SWING_LOW", reason: "thesis fails" },
    targets: [181, 182],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-06T14:00:00.000Z",
      validUntil: "2026-09-06T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
  };
}

function harness({ state = "READY", clock = () => NOW } = {}) {
  const store = new PreTradeStore({ filePath: tempFile(), clock });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => "ingress-1" });
  ingress.importBundle({ source: "SOD_A_PLUS_TRADES", bundleId: "bundle-1", candidates: [proposal()] });
  const candidate = store.state.candidates[0];
  candidate.lifecycleState = state;
  candidate.stateRevision = 3;
  candidate.currentDssEvaluationId = "dss-1";
  candidate.currentDssEvaluationStale = false;
  candidate.currentPermissionOutcome = { outcome: state === "CAUTION" ? "CAUTION" : "READY", permissionEvaluationId: "permission-1" };
  store.save();
  const authority = new PreTradeArmLifecycleAuthority({ store, clock, idFactory: () => "arm-event-1" });
  return { store, authority, candidateHash: candidate.contentHash };
}

function proof(candidateHash, overrides = {}) {
  return {
    authority: "PRETRADE_ARM_OPERATION",
    status: "AUTHORIZED",
    operationId: "arm-op-1",
    candidateId: "arm-NVDA-1",
    contractVersion: 1,
    candidateContentHash: candidateHash,
    symbol: "NVDA",
    direction: "LONG",
    reviewPackageId: "review-1",
    permissionAttemptId: "permission-1",
    permissionState: "READY",
    permissionStateRevision: 3,
    dssEvaluationId: "dss-1",
    riskEvaluationId: "risk-1",
    accountId: "acct-1",
    selectedQuantity: 25,
    authorizedAt: NOW,
    handoffId: "handoff-1",
    ...overrides,
  };
}

test("browser-like fabricated ARM payload without durable operation authority cannot transition candidate", () => {
  const h = harness();
  assert.throws(
    () => h.authority.authorizeFromCommit({
      operationId: "fake-arm",
      candidateId: "arm-NVDA-1",
      contractVersion: 1,
      expectedState: "READY",
      expectedRevision: 3,
      armCommit: { ...proof(h.candidateHash), authority: "BROWSER" },
    }),
    (error) => error.code === "ARM_COMMIT_AUTHORITY_REQUIRED",
  );
  assert.equal(h.store.state.candidates[0].lifecycleState, "READY");
});

test("durably authorized proof freezes ARMED provenance and lifecycle event atomically", () => {
  const h = harness();
  const result = h.authority.authorizeFromCommit({
    operationId: "arm-op-1:CANDIDATE_ARM",
    candidateId: "arm-NVDA-1",
    contractVersion: 1,
    expectedState: "READY",
    expectedRevision: 3,
    armCommit: proof(h.candidateHash),
  });
  assert.equal(result.lifecycleState, "ARMED");
  assert.equal(result.stateRevision, 4);
  const candidate = h.store.state.candidates[0];
  assert.equal(candidate.authorizedDssEvaluationId, "dss-1");
  assert.equal(candidate.authorizedRiskEvaluationId, "risk-1");
  assert.equal(candidate.arm.selectedQuantity, 25);
  assert.equal(candidate.arm.reviewPackageId, "review-1");
  assert.equal(candidate.lifecycleJournal.events.at(-1).eventType, "ARM_AUTHORIZED");
});

test("ARM proof must still match current permission attempt and DSS at commit boundary", () => {
  const h = harness();
  h.store.state.candidates[0].currentDssEvaluationId = "dss-2";
  h.store.save();
  assert.throws(
    () => h.authority.authorizeFromCommit({ operationId: "arm-op-1:CANDIDATE_ARM", candidateId: "arm-NVDA-1", contractVersion: 1, expectedState: "READY", expectedRevision: 3, armCommit: proof(h.candidateHash) }),
    (error) => error.code === "ARM_COMMIT_DSS_MISMATCH",
  );
});

test("recovery may forward-complete an expired candidate only when durable authorization occurred inside validity", () => {
  const recoveryClock = () => "2026-09-06T20:01:00.000Z";
  const h = harness({ state: "EXPIRED", clock: recoveryClock });
  h.store.state.candidates[0].stateRevision = 4;
  h.store.save();
  const inside = proof(h.candidateHash, {
    permissionState: "READY",
    permissionStateRevision: 3,
    authorizedAt: "2026-09-06T19:59:59.000Z",
  });
  const result = h.authority.authorizeFromCommit({
    operationId: "arm-op-1:CANDIDATE_ARM",
    candidateId: "arm-NVDA-1",
    contractVersion: 1,
    expectedState: "EXPIRED",
    expectedRevision: 4,
    recovery: true,
    armCommit: inside,
  });
  assert.equal(result.lifecycleState, "ARMED");
});
