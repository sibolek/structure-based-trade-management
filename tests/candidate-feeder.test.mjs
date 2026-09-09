import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  acquireSingleInstanceLock,
  candidateDirectoriesFromInbox,
  drainCandidateInbox,
  processCandidatePublication,
  validateCandidateBundle,
  verifyPretradeHealth,
} from "../schwab-bridge/candidate-feeder.mjs";
import { AUTOMATED_UNTOUCHED_ONLY } from "../schwab-bridge/pretrade-candidate-ingress.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-09-nvda-vwap-reclaim-long",
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T14:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "VWAP reclaim",
    timeframe: "2m",
    thesis: "Continuation after reclaim and hold.",
    trigger: { type: "MANUAL_CONFIRMATION", prompt: "Confirm reclaim" },
    structuralInvalidation: {
      price: 178.5,
      rule: "break below reclaim low",
      referenceType: "SWING_LOW",
      reason: "long thesis invalid",
    },
    targets: [181, 182],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-09T13:30:00.000Z",
      validUntil: "2026-09-09T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL", armAuthorized: false },
    armAuthorized: false,
    status: "WAITING",
    ...overrides,
  };
}

function bundle(candidates = [candidate()], overrides = {}) {
  return {
    source: SOURCE,
    bundleId: "candidate-feed-2026-09-09-140000Z",
    ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
    candidates,
    ...overrides,
  };
}

async function tempCandidateRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-candidate-feeder-"));
  const inbox = path.join(root, "inbox");
  await fs.mkdir(inbox, { recursive: true });
  return { root, inbox, directories: candidateDirectoriesFromInbox(inbox) };
}

function jsonResponse(res, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": body.length,
  });
  res.end(body);
}

async function startPretradeStub({
  healthOverrides = {},
  importHandler = null,
  snapshotCandidates = null,
} = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      jsonResponse(res, 200, {
        ok: true,
        service: "executionos-v24-pretrade",
        candidateIngressAuthority: true,
        candidateContractVersioning: true,
        candidateAutomatedIngressPolicy: AUTOMATED_UNTOUCHED_ONLY,
        readOnlyBrokerBoundary: true,
        brokerWriteAuthority: false,
        ...healthOverrides,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/candidates/import") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      requests.push(body);
      if (importHandler) {
        const response = await importHandler(body);
        jsonResponse(res, response.statusCode ?? 200, response.body);
        return;
      }
      const parsed = JSON.parse(body.toString("utf8"));
      jsonResponse(res, 200, {
        importedAt: "2026-09-09T14:00:01.000Z",
        ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
        outcomes: parsed.candidates.map((item) => ({
          candidateId: item.candidateId,
          contractVersion: item.contractVersion,
          status: "ACCEPTED",
          lifecycleState: "WAITING",
          stateRevision: 0,
          reasons: [],
        })),
        validityReconciliation: [],
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/candidates") {
      jsonResponse(res, 200, {
        candidates: snapshotCandidates || [{
          candidateId: candidate().candidateId,
          contractVersion: 1,
          lifecycleState: "WAITING",
          stateRevision: 0,
        }],
      });
      return;
    }

    jsonResponse(res, 404, { error: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

const fastStable = {
  initialDelayMs: 0,
  intervalMs: 0,
  stableChecks: 1,
  maxChecks: 3,
  parseAttempts: 1,
  parseRetryDelayMs: 0,
};

test("bundle validation requires canonical source explicit IDs unique IDs versions and restrictive policy", () => {
  const valid = bundle();
  assert.deepEqual(validateCandidateBundle(valid, Buffer.from(JSON.stringify(valid))), []);

  const invalid = bundle([
    candidate({ candidateId: "dup" }),
    candidate({ candidateId: "dup", contractVersion: 0, source: "OTHER" }),
  ], {
    source: "OTHER",
    ingressPolicy: "PERMISSIVE",
    bundleId: "",
  });
  const errors = validateCandidateBundle(invalid, Buffer.from(JSON.stringify(invalid)));
  assert.ok(errors.some((item) => item.includes("bundle source")));
  assert.ok(errors.some((item) => item.includes("bundleId")));
  assert.ok(errors.some((item) => item.includes("ingressPolicy")));
  assert.ok(errors.some((item) => item.includes("duplicate candidateId")));
  assert.ok(errors.some((item) => item.includes("contractVersion")));
  assert.ok(errors.some((item) => item.includes("candidate source")));
});

test("bundle validation rejects payloads above PRETRADE body limit", () => {
  const proposed = bundle();
  const errors = validateCandidateBundle(proposed, Buffer.alloc(1024 * 1024 + 1));
  assert.ok(errors.some((item) => item.includes("exceeds")));
});

test("health preflight requires exact PRETRADE identity restrictive capability and read-only broker boundary", async () => {
  const good = await startPretradeStub();
  try {
    const health = await verifyPretradeHealth(good.url);
    assert.equal(health.candidateAutomatedIngressPolicy, AUTOMATED_UNTOUCHED_ONLY);
    assert.equal(health.brokerWriteAuthority, false);
  } finally {
    await good.close();
  }

  const incompatible = await startPretradeStub({
    healthOverrides: { candidateAutomatedIngressPolicy: null },
  });
  try {
    await assert.rejects(
      () => verifyPretradeHealth(incompatible.url),
      (error) => error.code === "PRETRADE_HEALTH_CAPABILITY_MISMATCH" && error.retryable === true,
    );
  } finally {
    await incompatible.close();
  }
});

test("candidate publication is posted byte-for-byte then verified and archived with receipt", async () => {
  const { inbox, directories } = await tempCandidateRoot();
  const filePath = path.join(inbox, "candidate-feed-001.json");
  const exactBytes = Buffer.from(`${JSON.stringify(bundle(), null, 2)}\n`);
  await fs.writeFile(filePath, exactBytes);
  const pretrade = await startPretradeStub();

  try {
    const result = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });
    assert.equal(result.status, "ARCHIVED");
    assert.equal(pretrade.requests.length, 1);
    assert.deepEqual(pretrade.requests[0], exactBytes);
    await assert.rejects(() => fs.stat(filePath), { code: "ENOENT" });
    const archived = await fs.readFile(path.join(directories.archive, path.basename(filePath)));
    assert.deepEqual(archived, exactBytes);
    assert.equal(result.receipt.pretradeServiceVerified, true);
    assert.equal(result.receipt.brokerWriteAuthority, false);
    assert.equal(result.receipt.candidates[0].ingressStatus, "ACCEPTED");
    assert.equal(result.receipt.candidates[0].currentLifecycleState, "WAITING");
    assert.equal(result.receipt.candidates[0].verified, true);
    assert.ok(result.receiptPath.endsWith(".receipt.json"));
  } finally {
    await pretrade.close();
  }
});

test("accepted candidate may verify as EXPIRED after ingress validity reconciliation", async () => {
  const { inbox } = await tempCandidateRoot();
  const filePath = path.join(inbox, "expired.json");
  await fs.writeFile(filePath, JSON.stringify(bundle()));
  const pretrade = await startPretradeStub({
    snapshotCandidates: [{
      candidateId: candidate().candidateId,
      contractVersion: 1,
      lifecycleState: "EXPIRED",
      stateRevision: 1,
    }],
  });

  try {
    const result = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });
    assert.equal(result.status, "ARCHIVED");
    assert.equal(result.receipt.candidates[0].currentLifecycleState, "EXPIRED");
    assert.equal(result.receipt.candidates[0].verified, true);
  } finally {
    await pretrade.close();
  }
});

test("mixed canonical outcome verifies accepted candidate then quarantines immutable publication", async () => {
  const { inbox, directories } = await tempCandidateRoot();
  const second = candidate({ candidateId: "sod-2026-09-09-amd-vwap-reclaim-long", symbol: "AMD" });
  const proposed = bundle([candidate(), second]);
  const filePath = path.join(inbox, "mixed.json");
  await fs.writeFile(filePath, JSON.stringify(proposed));
  const pretrade = await startPretradeStub({
    importHandler: async () => ({
      body: {
        ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
        outcomes: [
          { candidateId: candidate().candidateId, contractVersion: 1, status: "ACCEPTED", reasons: [] },
          { candidateId: second.candidateId, contractVersion: 1, status: "REJECTED", reasons: ["AUTOMATED_VERSION_GAP"] },
        ],
      },
    }),
    snapshotCandidates: [{
      candidateId: candidate().candidateId,
      contractVersion: 1,
      lifecycleState: "WAITING",
      stateRevision: 0,
    }],
  });

  try {
    const result = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });
    assert.equal(result.status, "QUARANTINED");
    assert.equal(result.receipt.candidates[0].verified, true);
    assert.equal(result.receipt.candidates[1].ingressStatus, "REJECTED");
    await fs.stat(path.join(directories.quarantine, "mixed.json"));
  } finally {
    await pretrade.close();
  }
});

test("capability mismatch leaves valid immutable file pending and performs no POST", async () => {
  const { inbox } = await tempCandidateRoot();
  const filePath = path.join(inbox, "pending.json");
  await fs.writeFile(filePath, JSON.stringify(bundle()));
  const pretrade = await startPretradeStub({
    healthOverrides: { brokerWriteAuthority: true },
  });

  try {
    const result = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });
    assert.equal(result.status, "PENDING_RETRY");
    assert.equal(result.error.code, "PRETRADE_HEALTH_CAPABILITY_MISMATCH");
    assert.equal(pretrade.requests.length, 0);
    await fs.stat(filePath);
  } finally {
    await pretrade.close();
  }
});

test("stable malformed JSON is quarantined with a cloud-visible receipt", async () => {
  const { inbox, directories } = await tempCandidateRoot();
  const filePath = path.join(inbox, "malformed.json");
  await fs.writeFile(filePath, "{ definitely-not-json");
  const result = await processCandidatePublication(filePath, {
    inboxPath: inbox,
    stableFileOptions: fastStable,
  });
  assert.equal(result.status, "QUARANTINED");
  assert.equal(result.receipt.error.code, "MALFORMED_CANDIDATE_JSON");
  await fs.stat(path.join(directories.quarantine, "malformed.json"));
  await fs.stat(result.receiptPath);
});

test("invalid local envelope is quarantined before any PRETRADE request", async () => {
  const { inbox, directories } = await tempCandidateRoot();
  const filePath = path.join(inbox, "invalid-envelope.json");
  await fs.writeFile(filePath, JSON.stringify(bundle([], { ingressPolicy: null })));
  const result = await processCandidatePublication(filePath, {
    inboxPath: inbox,
    stableFileOptions: fastStable,
  });
  assert.equal(result.status, "QUARANTINED");
  assert.equal(result.receipt.error.code, "INVALID_CANDIDATE_BUNDLE");
  await fs.stat(path.join(directories.quarantine, "invalid-envelope.json"));
});

test("single-instance lock rejects a concurrent live owner and recovers a stale dead PID", async () => {
  const { directories } = await tempCandidateRoot();
  const release = await acquireSingleInstanceLock(directories.lockFile);
  try {
    await assert.rejects(
      () => acquireSingleInstanceLock(directories.lockFile),
      (error) => error.code === "CANDIDATE_FEEDER_ALREADY_RUNNING",
    );
  } finally {
    await release();
  }

  await fs.writeFile(directories.lockFile, JSON.stringify({ pid: 99999999, acquiredAt: "2026-09-09T00:00:00Z" }));
  const releaseRecovered = await acquireSingleInstanceLock(directories.lockFile);
  await releaseRecovered();
  await assert.rejects(() => fs.stat(directories.lockFile), { code: "ENOENT" });
});

test("inbox drain processes all eligible JSON publications in deterministic filename order", async () => {
  const { inbox } = await tempCandidateRoot();
  const names = ["003.json", "001.json", "002.json"];
  for (const name of names) {
    const id = `candidate-${name}`;
    await fs.writeFile(path.join(inbox, name), JSON.stringify(bundle([candidate({ candidateId: id })], { bundleId: `bundle-${name}` })));
  }

  const importedOrder = [];
  const allCandidates = [];
  const pretrade = await startPretradeStub({
    importHandler: async (body) => {
      const proposed = JSON.parse(body.toString("utf8"));
      const item = proposed.candidates[0];
      importedOrder.push(proposed.bundleId);
      allCandidates.push({
        candidateId: item.candidateId,
        contractVersion: item.contractVersion,
        lifecycleState: "WAITING",
        stateRevision: 0,
      });
      return {
        body: {
          ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
          outcomes: [{
            candidateId: item.candidateId,
            contractVersion: item.contractVersion,
            status: "ACCEPTED",
            reasons: [],
          }],
        },
      };
    },
    snapshotCandidates: allCandidates,
  });

  try {
    const result = await drainCandidateInbox({
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });
    assert.equal(result.filesDiscovered, 3);
    assert.deepEqual(importedOrder, ["bundle-001.json", "bundle-002.json", "bundle-003.json"]);
    assert.deepEqual(result.results.map((item) => item.status), ["ARCHIVED", "ARCHIVED", "ARCHIVED"]);
  } finally {
    await pretrade.close();
  }
});
