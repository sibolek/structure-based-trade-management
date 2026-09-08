import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPretradeApiClient } from "../src/pretrade/pretrade-api-client.js";
import { projectPretradeWorkspace } from "../src/pretrade/pretrade-ui-projection.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function candidate(id, lifecycleState, { handoffId = null, symbol = "NVDA" } = {}) {
  return {
    candidateId: id,
    contractVersion: 1,
    contentHash: `hash-${id}`,
    symbol,
    direction: "LONG",
    lifecycleState,
    stateRevision: 3,
    arm: handoffId ? {
      handoffId,
      selectedQuantity: 25,
      executionAccountId: "acct-1",
    } : null,
  };
}

test("PRETRADE projection classifies active, terminal, ARMED execution, and released ownership without mutating state", () => {
  const waiting = candidate("waiting", "WAITING");
  const ready = candidate("ready", "READY");
  const pass = candidate("pass", "PASS");
  const live = candidate("live", "ARMED", { handoffId: "handoff-live" });
  const done = candidate("done", "ARMED", { handoffId: "handoff-done" });
  const state = {
    candidates: [waiting, ready, pass, live, done],
    reviews: [{ candidateId: "ready", contractVersion: 1, currentPackage: { reviewPackageId: "review-1" } }],
    ocoGroups: [],
  };
  const before = structuredClone(state);
  const executionStore = {
    candidates: [],
    liveTrades: [],
    history: [{ origin: "V24_HANDOFF", v24: { handoffId: "handoff-done" } }],
    v24Installations: [],
    v24Retirements: [],
    v24Lifecycles: [{ handoffId: "handoff-live", symbol: "NVDA", status: "LIVE" }],
  };

  const projection = projectPretradeWorkspace(state, executionStore);
  assert.deepEqual(projection.active.map((item) => item.candidate.candidateId), ["waiting", "ready"]);
  assert.equal(projection.active.find((item) => item.candidate.candidateId === "ready").review.currentPackage.reviewPackageId, "review-1");
  assert.deepEqual(projection.authorizedExecution.map((item) => item.candidate.candidateId), ["live"]);
  assert.equal(projection.authorizedExecution[0].execution.executionState, "LIVE");
  assert.deepEqual(projection.history.map((item) => item.candidate.candidateId), ["pass", "done"]);
  assert.equal(projection.history.find((item) => item.candidate.candidateId === "done").execution.executionState, "HISTORY");
  assert.deepEqual(state, before);
});

test("ARMED candidate with unavailable downstream projection remains Authorized / Execution and is never guessed into History", () => {
  const armed = candidate("armed", "ARMED", { handoffId: "handoff-unknown" });
  const projection = projectPretradeWorkspace({ candidates: [armed] }, null);
  assert.equal(projection.authorizedExecution.length, 1);
  assert.equal(projection.history.length, 0);
  assert.equal(projection.authorizedExecution[0].execution.executionState, "UNAVAILABLE");
  assert.equal(projection.authorizedExecution[0].execution.projectionAvailable, false);
});

test("RETIRED downstream handoff releases an ARMED PRETRADE record into History", () => {
  const armed = candidate("retired", "ARMED", { handoffId: "handoff-retired" });
  const executionStore = {
    candidates: [], liveTrades: [], history: [], v24Installations: [], v24Lifecycles: [],
    v24Retirements: [{ handoffId: "handoff-retired", status: "RETIRED" }],
  };
  const projection = projectPretradeWorkspace({ candidates: [armed] }, executionStore);
  assert.equal(projection.authorizedExecution.length, 0);
  assert.equal(projection.history.length, 1);
  assert.equal(projection.history[0].execution.executionState, "RETIRED");
});

test("unrecognized PRETRADE state stays operator-visible with a fail-closed warning", () => {
  const unknown = candidate("unknown", "MYSTERY_STATE");
  const projection = projectPretradeWorkspace({ candidates: [unknown] }, {});
  assert.equal(projection.active.length, 1);
  assert.equal(projection.active[0].projectionWarning, "UNRECOGNIZED_LIFECYCLE_STATE");
});

function fakeClientHarness(payload = { brokerWriteAuthority: false }) {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() { return structuredClone(payload); },
    };
  };
  let counter = 0;
  const client = createPretradeApiClient({
    baseUrl: "http://127.0.0.1:8788/",
    fetchImpl,
    idFactory: (action) => `${action}-${++counter}`,
    clock: () => "2026-09-06T15:00:00.000Z",
  });
  return { client, requests };
}

test("intent-only client sends exact lifecycle and manual-trigger identity without generic state authority", async () => {
  const { client, requests } = fakeClientHarness();
  const waiting = candidate("ui-1", "WAITING");
  await client.activate(waiting);
  const activeRequest = requests[0];
  assert.equal(activeRequest.url, "http://127.0.0.1:8788/api/candidates/ui-1/versions/1/commands/activate");
  const activeBody = JSON.parse(activeRequest.options.body);
  assert.equal(activeBody.expectedState, "WAITING");
  assert.equal(activeBody.expectedRevision, 3);
  assert.equal(activeBody.activationMode, "MANUAL");

  const triggerCandidate = { ...waiting, lifecycleState: "PRETRADE_TRIGGER_EVALUATING", stateRevision: 4 };
  await client.confirmManualTrigger(triggerCandidate, "manual-node");
  const triggerBody = JSON.parse(requests[1].options.body);
  assert.equal(triggerBody.evidence.type, "MANUAL_EVENT");
  assert.equal(triggerBody.evidence.nodeId, "manual-node");
  assert.equal(triggerBody.evidence.confirmed, true);
  assert.equal(triggerBody.evidence.observedAt, "2026-09-06T15:00:00.000Z");

  assert.equal(client.setState, undefined);
  assert.equal(client.publishPermission, undefined);
  assert.equal(client.beginPermission, undefined);
  assert.equal(client.setPermissionBlocker, undefined);
});

test("permission and ARM client preserve accepted operatorPermissionAssessment field and explicit ARM confirmation", async () => {
  const { client, requests } = fakeClientHarness();
  const evaluating = candidate("ui-2", "PERMISSION_EVALUATING");
  const structural = { status: "VALID", actor: "OPERATOR", evidenceReference: "chart" };
  const permission = { outcome: "READY", actor: "OPERATOR", note: "context" };

  await client.evaluatePermission(evaluating, {
    accountId: "acct-1",
    entryMode: "MARKETABLE_NOW",
    operatorStructuralAssessment: structural,
    operatorPermissionAssessment: permission,
  });
  const permissionBody = JSON.parse(requests[0].options.body);
  assert.deepEqual(permissionBody.operatorStructuralAssessment, structural);
  assert.deepEqual(permissionBody.operatorPermissionAssessment, permission);
  assert.equal("operatorContextAssessment" in permissionBody, false);

  const ready = { ...evaluating, lifecycleState: "READY", direction: "LONG" };
  await client.arm(ready, {
    reviewPackageId: "review-1",
    selectedQuantity: 25,
    accountId: "acct-1",
    entryMode: "MARKETABLE_NOW",
    operatorStructuralAssessment: structural,
    operatorPermissionAssessment: permission,
  });
  const armBody = JSON.parse(requests[1].options.body);
  assert.equal(armBody.confirmArm, true);
  assert.equal(armBody.confirmedDirection, "LONG");
  assert.equal(armBody.selectedQuantity, 25);
  assert.equal(armBody.accountId, "acct-1");
  assert.deepEqual(armBody.operatorPermissionAssessment, permission);
  assert.equal("operatorContextAssessment" in armBody, false);
});

test("client exposes exact review and OCO intents only", async () => {
  const { client, requests } = fakeClientHarness();
  const ready = candidate("ui-3", "READY");
  await client.refreshReview(ready);
  await client.selectQuantity(ready, "review-1", 10);
  await client.acknowledgeCaution({ ...ready, lifecycleState: "CAUTION" }, "review-1");
  await client.createOco({ groupId: "oco-1", accountId: "acct-1", members: [ready, { ...ready, candidateId: "ui-4" }] });
  await client.dissolveOco("oco-1");

  assert.match(requests[0].url, /\/review\/refresh$/);
  assert.match(requests[1].url, /\/review\/quantity$/);
  assert.match(requests[2].url, /\/review\/caution-ack$/);
  assert.equal(requests[3].url, "http://127.0.0.1:8788/api/oco-groups");
  assert.match(requests[4].url, /\/api\/oco-groups\/oco-1\/dissolve$/);
  assert.equal(client.resolveOcoWinner, undefined);
  assert.equal(client.commitOcoWinner, undefined);
});

test("client preserves structured server errors and fails closed on broker-write authority", async () => {
  const failing = createPretradeApiClient({
    baseUrl: "http://127.0.0.1:8788",
    idFactory: () => "id",
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      async json() { return { error: "stale", code: "STALE_STATE_REVISION", details: { expected: 2, actual: 3 } }; },
    }),
  });
  await assert.rejects(
    failing.snapshot(),
    (error) => error.code === "STALE_STATE_REVISION" && error.status === 409 && error.details.actual === 3,
  );

  const unsafe = createPretradeApiClient({
    baseUrl: "http://127.0.0.1:8788",
    idFactory: () => "id",
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { brokerWriteAuthority: true }; } }),
  });
  await assert.rejects(unsafe.health(), (error) => error.code === "PRETRADE_BROKER_WRITE_AUTHORITY_VIOLATION");
});

test("React PRETRADE workspace is intent-only and renders all three frozen projections", () => {
  const app = source("src/App.jsx");
  const workspace = source("src/components/PreTradeWorkspace.jsx");
  const executionHook = source("src/hooks/useExecutionBoardProjection.js");
  const client = source("src/pretrade/pretrade-api-client.js");

  assert.match(app, /PreTradeWorkspace/);
  assert.doesNotMatch(app, /PreTradeWaitingBoard/);
  assert.match(workspace, /Active/);
  assert.match(workspace, /Authorized \/ Execution/);
  assert.match(workspace, /History/);
  assert.match(workspace, /executionOwnershipAuthorityConnected/);
  assert.match(workspace, /EXECUTION_OWNERSHIP_AUTHORITY_UNAVAILABLE/);
  assert.match(workspace, /ARM \{candidate\.symbol\} \{candidate\.direction\}/);
  assert.match(workspace, /type="button"/);
  assert.match(workspace, /operatorPermissionAssessment/);
  assert.match(workspace, /structuralEvidenceMissing/);
  assert.match(workspace, /Structure evidence \/ reference — required for VALID/);
  assert.match(workspace, /Structure evidence is required when STRUCTURE = VALID/);
  assert.doesNotMatch(workspace, /operatorContextAssessment/);
  assert.doesNotMatch(workspace, /localStorage\.setItem/);
  assert.doesNotMatch(workspace, /transactExecutionBoardStore/);
  assert.match(executionHook, /readExecutionBoardStore/);
  assert.match(executionHook, /subscribeExecutionBoardStore/);
  assert.doesNotMatch(executionHook, /transactExecutionBoardStore/);
  assert.doesNotMatch(executionHook, /localStorage\.setItem/);
  assert.doesNotMatch(client, /commands\/set-state/);
  assert.doesNotMatch(client, /commands\/publish-permission/);
  assert.doesNotMatch(client, /commands\/set-permission-blocker/);
});
