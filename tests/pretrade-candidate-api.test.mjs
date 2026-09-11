import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPreTradeCandidateApiHandler } from "../schwab-bridge/pretrade-candidate-api.mjs";
import {
  AUTOMATED_UNTOUCHED_ONLY,
  FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL,
  MANUAL_AUTHORIZED,
  MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID,
  MANUAL_SUPERSESSION_REVIEW_REQUIRED,
  PreTradeCandidateIngress,
} from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import {
  candidateContractHash,
  normalizeCanonicalCandidateProposal,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";

function candidate(overrides = {}) {
  return {
    candidateId: "api-manual-supersession-nvda",
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-10",
    generatedAt: "2026-09-10T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "VWAP reclaim continuation",
    timeframe: "2m",
    thesis: "Continuation after reclaim and hold.",
    trigger: { type: "MANUAL_CONFIRMATION", prompt: "Confirm reclaim" },
    structuralInvalidation: {
      price: 224.5,
      rule: "break below reclaim low",
      referenceType: "SWING_LOW",
      reason: "long thesis invalid",
    },
    targets: [{ targetId: "T1", label: "T1", price: 226.5 }],
    managementContract: { mode: "SINGLE_ENTRY", allowReAdd: false },
    validity: {
      validFrom: "2026-09-10T13:30:00.000Z",
      validUntil: "2026-09-12T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function bundle(candidates, overrides = {}) {
  return {
    source: SOURCE,
    bundleId: "api-manual-supersession",
    ingressPolicy: MANUAL_AUTHORIZED,
    candidates,
    ...overrides,
  };
}

async function startCandidateApi() {
  const store = new PreTradeStore({
    filePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-candidate-api-")), "state.json"),
    clock: () => "2026-09-10T13:01:00.000Z",
  });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => "2026-09-10T13:02:00.000Z",
    idFactory: () => "candidate-api-event",
  });
  ingress.importBundle(bundle([candidate()], {
    bundleId: "api-manual-supersession-v1",
    ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
  }));
  const lifecycleCoordinator = new PreTradeLifecycleCoordinator({ store });
  lifecycleCoordinator.reconcileAllValidity({ source: "TEST_SETUP_VALIDITY_RECONCILIATION" });
  const handler = createPreTradeCandidateApiHandler({
    candidateIngress: ingress,
    lifecycleCoordinator,
    ocoService: {
      reconcileBlockedHandoffRetirements: () => [],
      reconcileClosedNoArm: () => [],
    },
  });
  const server = http.createServer(async (req, res) => {
    if (await handler(req, res)) return;
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    store,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function postJson(baseUrl, pathname, payload, { headers = {} } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(pathname, baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": body.length,
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          json: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("candidate API rejects forged authority and requires a persisted PRETRADE review", async () => {
  const api = await startCandidateApi();
  try {
    const prior = api.store.snapshot().candidates[0];
    const proposed = candidate({
      contractVersion: 2,
      generatedAt: "2026-09-10T13:05:00.000Z",
      thesis: "Fabricated caller tries to self-authorize supersession.",
    });
    const { normalized, errors } = normalizeCanonicalCandidateProposal(proposed, { bundleSource: SOURCE });
    assert.deepEqual(errors, []);
    const fabricated = {
      authorizationId: "fabricated-perfect-match",
      candidateId: proposed.candidateId,
      priorContractVersion: 1,
      priorLifecycleState: "WAITING",
      priorStateRevision: 0,
      priorContentHash: prior.contentHash,
      proposedContractVersion: 2,
      proposedContentHash: candidateContractHash(normalized),
      decision: "AUTHORIZED",
    };
    const forgedImport = await postJson(api.url, "/api/candidates/import", {
      ...bundle([proposed], { bundleId: "api-manual-supersession-v2" }),
      manualSupersessionAuthorizations: [fabricated],
    });
    assert.equal(forgedImport.statusCode, 400);
    assert.equal(forgedImport.json.code, FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL);
    assert.deepEqual(api.store.snapshot().candidates, [prior]);

    const fabricatedAuthorization = await postJson(api.url, "/api/candidates/manual-supersession-authorize", {
      ...fabricated,
      operatorConfirmed: true,
    });
    assert.equal(fabricatedAuthorization.statusCode, 400);
    assert.equal(fabricatedAuthorization.json.code, MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID);
    assert.equal(api.store.snapshot().manualSupersessionAuthorizations.length, 0);

    const missingReview = await postJson(api.url, "/api/candidates/manual-supersession-authorize", {
      reviewId: "fabricated-review-id",
      operatorConfirmed: true,
    });
    assert.equal(missingReview.statusCode, 400);
    assert.equal(missingReview.json.code, MANUAL_SUPERSESSION_REVIEW_REQUIRED);

    const review = await postJson(api.url, "/api/candidates/manual-supersession-review", bundle([proposed], {
      bundleId: "api-manual-supersession-v2",
    }));
    assert.equal(review.statusCode, 200);
    assert.equal(review.json.status, "ACTION_REQUIRED");
    assert.ok(review.json.reviews[0].reviewId);
    assert.ok(review.json.reviews[0].substantiveDiff.some((item) => item.path === "thesis"));
    assert.equal(api.store.snapshot().manualSupersessionReviews[0].reviewId, review.json.reviews[0].reviewId);

    const authorization = await postJson(api.url, "/api/candidates/manual-supersession-authorize", {
      reviewId: review.json.reviews[0].reviewId,
      operatorConfirmed: true,
    });
    assert.equal(authorization.statusCode, 200);
    assert.equal(authorization.json.reviewId, review.json.reviews[0].reviewId);
    assert.ok(authorization.json.authorizationId.startsWith("manual-supersession-authorization-"));

    const authorizedImport = await postJson(api.url, "/api/candidates/import", bundle([proposed], {
      bundleId: "api-manual-supersession-v2",
    }));
    assert.equal(authorizedImport.statusCode, 200);
    assert.equal(authorizedImport.json.outcomes[0].status, "ACCEPTED");
    assert.equal(api.store.snapshot().candidates.find((item) => item.contractVersion === 1).lifecycleState, "SUPERSEDED");
    const admitted = api.store.snapshot().candidates.find((item) => item.contractVersion === 2);
    assert.equal(admitted.lifecycleState, "WAITING");
    assert.equal(admitted.stateRevision, 0);
    assert.equal(admitted.armAuthorized, false);
    assert.equal(admitted.currentDssEvaluationId, null);
    assert.equal(admitted.currentPermissionOutcome, null);
    assert.equal(admitted.arm, null);
    assert.equal(Object.prototype.hasOwnProperty.call(admitted, "handoff"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(admitted, "executionState"), false);
  } finally {
    await api.close();
  }
});

test("candidate API fails closed for malformed, non-local, and unsupported review commands", async () => {
  const api = await startCandidateApi();
  try {
    const malformedReview = await postJson(api.url, "/api/candidates/manual-supersession-review", {});
    assert.equal(malformedReview.statusCode, 400);
    assert.equal(malformedReview.json.code, "INVALID_BUNDLE");

    const unconfirmed = await postJson(api.url, "/api/candidates/manual-supersession-authorize", {
      reviewId: "not-authoritative",
      operatorConfirmed: false,
    });
    assert.equal(unconfirmed.statusCode, 400);
    assert.equal(unconfirmed.json.code, "MANUAL_SUPERSESSION_CONFIRMATION_REQUIRED");

    const nonLocal = await postJson(api.url, "/api/candidates/manual-supersession-authorize", {
      reviewId: "not-authoritative",
      operatorConfirmed: true,
    }, { headers: { origin: "https://example.com" } });
    assert.equal(nonLocal.statusCode, 403);
    assert.equal(nonLocal.json.error, "origin not allowed");

    const unsupported = await postJson(api.url, "/api/candidates/manual-supersession-unknown", {});
    assert.equal(unsupported.statusCode, 404);
    assert.equal(api.store.snapshot().manualSupersessionReviews.length, 0);
    assert.equal(api.store.snapshot().manualSupersessionAuthorizations.length, 0);
  } finally {
    await api.close();
  }
});

test("candidate API exposes exact decision observation and durable explicit decline", async () => {
  const api = await startCandidateApi();
  try {
    const prior = structuredClone(api.store.snapshot().candidates[0]);
    const proposed = candidate({
      contractVersion: 2,
      generatedAt: "2026-09-10T13:05:00.000Z",
      thesis: "Operator explicitly declines this reviewed revision.",
    });
    const { normalized, errors } = normalizeCanonicalCandidateProposal(proposed, { bundleSource: SOURCE });
    assert.deepEqual(errors, []);
    const review = await postJson(api.url, "/api/candidates/manual-supersession-review", bundle([proposed], {
      bundleId: "api-decline-v2",
    }));
    assert.equal(review.statusCode, 200);
    const reviewId = review.json.reviews[0].reviewId;

    const unresolved = await postJson(api.url, "/api/candidates/manual-supersession-observe", { candidate: normalized });
    assert.equal(unresolved.statusCode, 200);
    assert.equal(unresolved.json.status, "UNRESOLVED");
    assert.equal(unresolved.json.reviewId, reviewId);

    const declined = await postJson(api.url, "/api/candidates/manual-supersession-decline", {
      reviewId,
      operatorDeclined: true,
    });
    assert.equal(declined.statusCode, 200);
    assert.equal(declined.json.decision, "DECLINED");
    assert.ok(declined.json.declineId.startsWith("manual-supersession-decline-"));

    const observed = await postJson(api.url, "/api/candidates/manual-supersession-observe", { candidate: normalized });
    assert.equal(observed.statusCode, 200);
    assert.equal(observed.json.status, "DECLINED");
    assert.equal(observed.json.reviewId, reviewId);
    assert.equal(observed.json.declineId, declined.json.declineId);

    const authorizeAfterDecline = await postJson(api.url, "/api/candidates/manual-supersession-authorize", {
      reviewId,
      operatorConfirmed: true,
    });
    assert.equal(authorizeAfterDecline.statusCode, 400);
    const importAfterDecline = await postJson(api.url, "/api/candidates/import", bundle([proposed], {
      bundleId: "api-decline-v2",
    }));
    assert.equal(importAfterDecline.statusCode, 200);
    assert.equal(importAfterDecline.json.outcomes[0].status, "ACTION_REQUIRED");
    assert.deepEqual(api.store.snapshot().candidates, [prior]);
    assert.equal(api.store.snapshot().manualSupersessionAuthorizations.length, 0);
    assert.equal(api.store.snapshot().manualSupersessionDeclines.length, 1);
  } finally {
    await api.close();
  }
});
