import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeTriggerEngine } from "../schwab-bridge/pretrade-trigger-engine.mjs";
import { PreTradeTriggerPersistenceAuthority } from "../schwab-bridge/pretrade-trigger-persistence-authority.mjs";
import { PreTradeTriggerPersistenceMonitor } from "../schwab-bridge/pretrade-trigger-persistence-monitor.mjs";
import { createPreTradeTriggerApiHandler } from "../schwab-bridge/pretrade-trigger-api.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "trigger-api-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "AD_HOC_CHATGPT",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Trigger API test",
    thesis: "Objective trigger path",
    trigger: {
      evaluatorVersion: 1,
      relevance: { type: "QUOTE_COMPARISON", side: "LAST", operator: "GTE", value: 99 },
      satisfaction: { type: "BAR_CLOSE_COMPARISON", timeframe: "2m", operator: "GTE", value: 100 },
      persistence: { type: "BAR_BOUND", timeframe: "2m" },
    },
    structuralInvalidation: {
      price: 98,
      rule: "break below setup structure",
      referenceType: "SWING_LOW",
      reason: "thesis invalid",
    },
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-05T13:30:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function fixture(candidateInput = candidate()) {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-trigger-api-")), "state.json");
  let now = "2026-09-05T14:00:00.000Z";
  let id = 0;
  const clock = () => now;
  const store = new PreTradeStore({ filePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => `ingress-${++id}` });
  const imported = ingress.importBundle({ source: candidateInput.source, bundleId: "trigger-api", candidates: [candidateInput] });
  assert.equal(imported.outcomes[0].status, "ACCEPTED");
  const lifecycleCoordinator = new PreTradeLifecycleCoordinator({ store, clock, idFactory: () => `lifecycle-${++id}` });
  const triggerEngine = new PreTradeTriggerEngine({ store, lifecycleCoordinator, clock, idFactory: () => `trigger-${++id}` });
  const persistenceAuthority = new PreTradeTriggerPersistenceAuthority({ store, clock, idFactory: () => `persist-${++id}` });
  const persistenceMonitor = new PreTradeTriggerPersistenceMonitor({ store, persistenceAuthority, clock });
  const handler = createPreTradeTriggerApiHandler({ triggerEngine, persistenceMonitor, lifecycleCoordinator });
  return { store, lifecycleCoordinator, handler, setNow(value) { now = value; } };
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
  return { baseUrl: `http://127.0.0.1:${address.port}`, stop: () => new Promise((resolve) => server.close(resolve)) };
}

async function post(baseUrl, body, headers = {}) {
  const response = await fetch(`${baseUrl}/api/candidates/trigger-api-NVDA-1/versions/1/trigger/evidence`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

test("HTTP trigger evidence separates relevance from satisfaction and reaches permission only on matching completed bar", async () => {
  const f = fixture();
  const server = await startServer(f.handler);
  try {
    let result = await post(server.baseUrl, {
      expectedState: "WAITING",
      expectedRevision: 0,
      evidence: { type: "QUOTE_EVENT", evidenceId: "q1", observedAt: "2026-09-05T14:00:00.000Z", symbol: "NVDA", last: 99.5 },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.result.status, "ACTIVATED");
    assert.equal(result.payload.candidate.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
    assert.equal(result.payload.brokerWriteAuthority, false);

    result = await post(server.baseUrl, {
      expectedState: "PRETRADE_TRIGGER_EVALUATING",
      expectedRevision: 2,
      evidence: {
        type: "BAR_CLOSE",
        evidenceId: "b1",
        observedAt: "2026-09-05T14:02:01.000Z",
        barTimestamp: "2026-09-05T14:02:00.000Z",
        timeframe: "2m",
        symbol: "NVDA",
        close: 100.5,
        complete: true,
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.result.status, "SATISFIED");
    assert.equal(result.payload.candidate.lifecycleState, "PERMISSION_EVALUATING");
    assert.equal(result.payload.candidate.triggerSatisfaction.authority, "PRETRADE_TRIGGER_ENGINE");
  } finally {
    await server.stop();
  }
});

test("HTTP manual trigger confirmation advances only after explicit operator activation", async () => {
  const f = fixture(candidate({
    trigger: { evaluatorVersion: 1, type: "MANUAL_CONFIRMATION", prompt: "Confirm structure" },
  }));
  f.lifecycleCoordinator.activateCandidate({
    operationId: "operator-activate",
    candidateId: "trigger-api-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "MANUAL",
    source: "OPERATOR",
  });
  const server = await startServer(f.handler);
  try {
    const result = await post(server.baseUrl, {
      expectedState: "PRETRADE_TRIGGER_EVALUATING",
      expectedRevision: 1,
      evidence: {
        type: "MANUAL_EVENT",
        evidenceId: "manual-1",
        observedAt: "2026-09-05T14:00:00.000Z",
        candidateId: "trigger-api-NVDA-1",
        contractVersion: 1,
        nodeId: "satisfaction",
        confirmed: true,
        actor: "OPERATOR",
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.result.status, "SATISFIED");
    assert.equal(result.payload.candidate.lifecycleState, "PERMISSION_EVALUATING");
  } finally {
    await server.stop();
  }
});

test("HTTP trigger route switches to persistence monitor after satisfaction", async () => {
  const f = fixture(candidate({
    trigger: { evaluatorVersion: 1, type: "QUOTE_COMPARISON", side: "LAST", operator: "GTE", value: 100 },
  }));
  f.lifecycleCoordinator.activateCandidate({
    operationId: "operator-activate",
    candidateId: "trigger-api-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "MANUAL",
    source: "OPERATOR",
  });
  const server = await startServer(f.handler);
  try {
    let result = await post(server.baseUrl, {
      evidence: { type: "QUOTE_EVENT", evidenceId: "q-satisfy", observedAt: "2026-09-05T14:00:00.000Z", symbol: "NVDA", last: 100.5 },
    });
    assert.equal(result.payload.candidate.lifecycleState, "PERMISSION_EVALUATING");

    result = await post(server.baseUrl, {
      expectedState: "PERMISSION_EVALUATING",
      expectedRevision: 3,
      evidence: { type: "QUOTE_EVENT", evidenceId: "q-expire", observedAt: "2026-09-05T14:00:01.000Z", symbol: "NVDA", last: 99.5 },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.result.status, "EXPIRED_TO_TRIGGER_EVALUATING");
    assert.equal(result.payload.candidate.lifecycleState, "PRETRADE_TRIGGER_EVALUATING");
    assert.equal(result.payload.candidate.triggerSatisfaction, null);
  } finally {
    await server.stop();
  }
});

test("HTTP trigger evidence rejects forming bars, path identity conflicts, and cross-origin mutation", async () => {
  const f = fixture();
  f.lifecycleCoordinator.activateCandidate({
    operationId: "operator-activate",
    candidateId: "trigger-api-NVDA-1",
    contractVersion: 1,
    expectedState: "WAITING",
    expectedRevision: 0,
    activationMode: "MANUAL",
  });
  const server = await startServer(f.handler);
  try {
    let result = await post(server.baseUrl, {
      candidateId: "forged",
      evidence: { type: "QUOTE_EVENT", evidenceId: "q-forged", observedAt: "2026-09-05T14:00:00.000Z", last: 100 },
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.code, "CANDIDATE_IDENTITY_CONFLICT");

    result = await post(server.baseUrl, {
      evidence: {
        type: "BAR_CLOSE",
        evidenceId: "forming",
        observedAt: "2026-09-05T14:02:00.000Z",
        barTimestamp: "2026-09-05T14:02:00.000Z",
        timeframe: "2m",
        close: 101,
        complete: false,
      },
    });
    assert.equal(result.response.status, 400);
    assert.equal(result.payload.code, "INCOMPLETE_TRIGGER_BAR_EVIDENCE");

    result = await post(server.baseUrl, {
      evidence: { type: "QUOTE_EVENT", evidenceId: "cross", observedAt: "2026-09-05T14:00:01.000Z", last: 100 },
    }, { Origin: "https://example.com" });
    assert.equal(result.response.status, 403);
    assert.equal(result.payload.code, "ORIGIN_NOT_ALLOWED");
  } finally {
    await server.stop();
  }
});
