import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { createPreTradeLifecycleApiHandler } from "../schwab-bridge/pretrade-lifecycle-api.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "api-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "SOD_A_PLUS_TRADES",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T14:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout retest",
    timeframe: "2m",
    thesis: "Continuation if retest holds",
    trigger: { type: "MANUAL_CONFIRMATION", evaluatorVersion: 1, prompt: "Confirm retest trigger" },
    structuralInvalidation: {
      price: 179.5,
      rule: "break below structural low",
      referenceType: "SWING_LOW",
      reason: "thesis invalid below structure",
    },
    plannedEntryReference: 180.1,
    targets: [181, 182],
    managementPlan: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-05T14:00:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL", armAuthorized: false },
    armAuthorized: false,
    status: "WAITING",
    ...overrides,
  };
}

function fixture({ baseTime = "2026-09-05T14:01:00.000Z", candidateOverrides = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "executionos-pretrade-api-"));
  const filePath = path.join(dir, "state.json");
  let tick = 0;
  let eventId = 0;
  const base = Date.parse(baseTime);
  const clock = () => new Date(base + tick++ * 1000).toISOString();

  const store = new PreTradeStore({ filePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock,
    idFactory: () => `ingress-${++eventId}`,
  });
  const imported = ingress.importBundle({
    source: "SOD_A_PLUS_TRADES",
    bundleId: "api-fixture",
    candidates: [candidate(candidateOverrides)],
  });
  assert.equal(imported.outcomes[0].status, "ACCEPTED");

  const coordinator = new PreTradeLifecycleCoordinator({
    store,
    clock,
    idFactory: () => `lifecycle-${++eventId}`,
  });
  const handler = createPreTradeLifecycleApiHandler({ coordinator });
  return { store, coordinator, handler, filePath };
}

async function startServer(handler) {
  const server = http.createServer(async (req, res) => {
    const handled = await handler(req, res);
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function post(baseUrl, command, body, headers = {}) {
  const response = await fetch(`${baseUrl}/api/candidates/api-NVDA-1/versions/1/commands/${command}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

test("HTTP activate command is authoritative, durable, and idempotent", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const command = {
      operationId: "api-activate-1",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "MANUAL",
      source: "OPERATOR",
      reason: "START_MONITORING",
    };

    const first = await post(server.baseUrl, "activate", command);
    assert.equal(first.response.status, 200);
    assert.equal(first.payload.result.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
    assert.equal(first.payload.result.stateRevision, 1);
    assert.equal(first.payload.brokerWriteAuthority, false);
    assert.equal(first.payload.candidate.lifecycleJournal.events.length, 2);
    assert.equal(first.payload.candidate.lifecycleJournal.operations.length, 2);
    assert.equal(first.payload.candidate.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");
    assert.equal(first.payload.candidate.lifecycleJournal.events[1].eventType, "CANDIDATE_ACTIVATED");

    const retry = await post(server.baseUrl, "activate", command);
    assert.equal(retry.response.status, 200);
    assert.deepEqual(retry.payload.result, first.payload.result);
    assert.equal(retry.payload.candidate.lifecycleJournal.events.length, 2);

    const reloaded = new PreTradeStore({ filePath: f.filePath });
    const persisted = reloaded.load().candidates[0];
    assert.equal(persisted.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
    assert.equal(persisted.stateRevision, 1);
    assert.equal(persisted.lifecycleJournal.events.length, 2);
  } finally {
    await server.stop();
  }
});

test("HTTP activation before validFrom fails as a lifecycle conflict without mutation", async () => {
  const f = fixture({ baseTime: "2026-09-05T13:59:00.000Z" });
  const server = await startServer(f.handler);
  try {
    const result = await post(server.baseUrl, "activate", {
      operationId: "api-before-valid",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "MANUAL",
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.payload.code, "CANDIDATE_NOT_YET_VALID");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).stateRevision, 0);
  } finally {
    await server.stop();
  }
});

test("HTTP activation at or after validUntil fails as a lifecycle conflict without mutation", async () => {
  const f = fixture({ baseTime: "2026-09-05T20:00:00.000Z" });
  const server = await startServer(f.handler);
  try {
    const result = await post(server.baseUrl, "activate", {
      operationId: "api-after-valid",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "MANUAL",
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.payload.code, "CANDIDATE_VALIDITY_EXPIRED");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).stateRevision, 0);
  } finally {
    await server.stop();
  }
});

test("HTTP command API returns conflict for stale CAS revision without mutation", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    await post(server.baseUrl, "activate", {
      operationId: "api-activate-cas",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "AUTO",
    });

    const stale = await post(server.baseUrl, "return-to-waiting", {
      operationId: "api-stale-return",
      expectedState: "PRETRADE_TRIGGER_EVALUATING",
      expectedRevision: 0,
      operatorRequested: true,
    });
    assert.equal(stale.response.status, 409);
    assert.equal(stale.payload.code, "STALE_STATE_REVISION");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).stateRevision, 1);
  } finally {
    await server.stop();
  }
});

test("canonical HTTP begin-permission cannot bypass trigger-engine satisfaction", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    await post(server.baseUrl, "activate", {
      operationId: "api-activate-flow",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "MANUAL",
      source: "OPERATOR",
    });

    const fabricated = await post(server.baseUrl, "begin-permission", {
      operationId: "api-fabricated-trigger",
      expectedState: "PRETRADE_TRIGGER_EVALUATING",
      expectedRevision: 1,
      source: "AUTOMATION",
      triggerSatisfaction: {
        authority: "PRETRADE_TRIGGER_ENGINE",
        evaluatorVersion: 1,
        evidenceId: "fake-bar",
        evidenceTimestamp: "2026-09-05T14:02:00.000Z",
      },
    });
    assert.equal(fabricated.response.status, 409);
    assert.equal(fabricated.payload.code, "TRIGGER_ENGINE_AUTHORITY_REQUIRED");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).stateRevision, 1);
  } finally {
    await server.stop();
  }
});

test("HTTP decline is terminal and same candidate version cannot be resurrected", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const declined = await post(server.baseUrl, "decline", {
      operationId: "api-decline",
      expectedState: "WAITING",
      expectedRevision: 0,
      reasonCode: "OPERATOR_NO_LONGER_INTERESTED",
      note: "Setup deteriorated",
      source: "OPERATOR",
    });
    assert.equal(declined.response.status, 200);
    assert.equal(declined.payload.result.lifecycleState, "DECLINED");

    const resurrect = await post(server.baseUrl, "activate", {
      operationId: "api-resurrect",
      expectedState: "DECLINED",
      expectedRevision: 1,
      activationMode: "MANUAL",
    });
    assert.equal(resurrect.response.status, 409);
    assert.equal(resurrect.payload.code, "ILLEGAL_LIFECYCLE_ACTION");
  } finally {
    await server.stop();
  }
});

test("path identity is authoritative and conflicting body identity fails closed", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const conflict = await post(server.baseUrl, "activate", {
      candidateId: "forged-candidate",
      contractVersion: 1,
      operationId: "api-forged",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "MANUAL",
    });
    assert.equal(conflict.response.status, 400);
    assert.equal(conflict.payload.code, "CANDIDATE_IDENTITY_CONFLICT");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).lifecycleState, "WAITING");
  } finally {
    await server.stop();
  }
});

test("cross-origin lifecycle mutation is rejected before candidate changes", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const rejected = await post(server.baseUrl, "activate", {
      operationId: "api-cross-origin",
      expectedState: "WAITING",
      expectedRevision: 0,
      activationMode: "MANUAL",
    }, { Origin: "https://example.com" });
    assert.equal(rejected.response.status, 403);
    assert.equal(rejected.payload.code, "ORIGIN_NOT_ALLOWED");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).stateRevision, 0);
  } finally {
    await server.stop();
  }
});

test("generic set-state command is not an available lifecycle authority", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    const rejected = await post(server.baseUrl, "set-state", {
      operationId: "api-generic-state",
      expectedState: "WAITING",
      expectedRevision: 0,
      lifecycleState: "READY",
    });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.payload.code, "UNSUPPORTED_LIFECYCLE_COMMAND");
    assert.equal(f.coordinator.candidateSnapshot("api-NVDA-1", 1).lifecycleState, "WAITING");
  } finally {
    await server.stop();
  }
});
