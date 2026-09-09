import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  candidateDirectoriesFromInbox,
  processCandidatePublication,
} from "../schwab-bridge/candidate-feeder.mjs";
import { AUTOMATED_UNTOUCHED_ONLY, PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { buildCanonicalSodCandidateBundle } from "../schwab-bridge/sod-candidate-export.mjs";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";

function sodDraft({ explicitCandidateId = true, overrides = {} } = {}) {
  return {
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T13:00:00.000Z",
    bundleId: "sod-2026-09-09-a-plus-trades-v1",
    validity: {
      validFrom: "2026-09-09T12:55:00.000Z",
      validUntil: "2026-09-09T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
    },
    candidates: [{
      ...(explicitCandidateId
        ? { candidateId: "sod-2026-09-09-nvda-pml-sweep-vwap-reclaim-long" }
        : {}),
      contractVersion: 1,
      symbol: "NVDA",
      direction: "LONG",
      setup: "PML sweep VWAP reclaim",
      timeframe: "2m",
      morningPriority: 1,
      rating: "A+",
      thesis: "Sweep of premarket low followed by a confirmed VWAP reclaim supports continuation.",
      trigger: {
        type: "MANUAL_CONFIRMATION",
        description: "Confirm reclaim and hold above VWAP with valid 2m structure.",
      },
      structuralInvalidation: {
        price: 178.5,
        rule: "Acceptance below the sweep/reclaim structure invalidates the long thesis.",
        referenceType: "PRICE",
        reason: "The reclaim failed.",
        sourceTimeframe: "2m",
      },
      targets: [
        { label: "T1", price: 181 },
        { label: "T2", price: 182 },
      ],
      managementContract: {
        mode: "SINGLE_ENTRY",
        allowReAdd: false,
        allowFlatReEntry: false,
        source: "SOD_A_PLUS_TRADES",
      },
      plan: {
        bestLocation: "Sweep/reclaim structure near PML and VWAP.",
        noTradeZone: "Do not chase above the reclaim without a pullback.",
      },
      ...overrides,
    }],
  };
}

async function tempCandidateRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-candidate-feeder-sod-"));
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

async function startCanonicalPretradeStub({ dropFirstImportResponse = false } = {}) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-candidate-feeder-store-"));
  const store = new PreTradeStore({ filePath: path.join(stateRoot, "state.json") });
  store.load();
  let eventCounter = 0;
  let clockCounter = 0;
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => new Date(Date.parse("2026-09-09T13:01:00.000Z") + (clockCounter++ * 1000)).toISOString(),
    idFactory: () => `candidate-feeder-sod-event-${++eventCounter}`,
  });
  const importBodies = [];

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
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/candidates/import") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      importBodies.push(body);
      const parsed = JSON.parse(body.toString("utf8"));
      const result = ingress.importBundle(parsed);

      if (dropFirstImportResponse && importBodies.length === 1) {
        req.socket.destroy();
        return;
      }

      jsonResponse(res, 200, {
        ...result,
        validityReconciliation: [],
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/candidates") {
      jsonResponse(res, 200, store.snapshot());
      return;
    }

    jsonResponse(res, 404, { error: "not found" });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    store,
    importBodies,
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

test("automated SOD publication carries restrictive policy and requires explicit stable identity", () => {
  const automated = buildCanonicalSodCandidateBundle(sodDraft(), { automatedPublication: true });
  assert.equal(automated.ingressPolicy, AUTOMATED_UNTOUCHED_ONLY);
  assert.equal(
    automated.candidates[0].candidateId,
    "sod-2026-09-09-nvda-pml-sweep-vwap-reclaim-long",
  );

  assert.throws(
    () => buildCanonicalSodCandidateBundle(sodDraft({ explicitCandidateId: false }), {
      automatedPublication: true,
    }),
    (error) => (
      error.code === "SOD_CANDIDATE_EXPORT_INVALID"
      && /requires explicit stable candidateId/i.test(error.message)
    ),
  );
});

test("manual SOD export preserves legacy fallback identity behavior and does not claim automated policy", () => {
  const manual = buildCanonicalSodCandidateBundle(sodDraft({ explicitCandidateId: false }));
  assert.equal(manual.ingressPolicy, undefined);
  assert.match(manual.candidates[0].candidateId, /^sod-2026-09-09-nvda-long-/);
});

test("real automated SOD exporter output passes feeder and canonical ingress byte-for-byte", async () => {
  const { inbox, directories } = await tempCandidateRoot();
  const bundle = buildCanonicalSodCandidateBundle(sodDraft(), { automatedPublication: true });
  const exactBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  const filePath = path.join(inbox, "sod-2026-09-09-a-plus-trades-v1.json");
  await fs.writeFile(filePath, exactBytes);
  const pretrade = await startCanonicalPretradeStub();

  try {
    const result = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });

    assert.equal(result.status, "ARCHIVED");
    assert.equal(pretrade.importBodies.length, 1);
    assert.deepEqual(pretrade.importBodies[0], exactBytes);
    assert.equal(result.receipt.candidates[0].ingressStatus, "ACCEPTED");
    assert.equal(result.receipt.candidates[0].currentLifecycleState, "WAITING");
    assert.equal(pretrade.store.snapshot().candidates.length, 1);
    await fs.stat(path.join(directories.archive, path.basename(filePath)));
  } finally {
    await pretrade.close();
  }
});

test("changing local publication remains pending and never reaches PRETRADE", async () => {
  const { inbox } = await tempCandidateRoot();
  const bundle = buildCanonicalSodCandidateBundle(sodDraft(), { automatedPublication: true });
  const base = JSON.stringify(bundle);
  const filePath = path.join(inbox, "changing.json");
  await fs.writeFile(filePath, base);
  let mutation = 0;

  const result = await processCandidatePublication(filePath, {
    inboxPath: inbox,
    stableFileOptions: {
      initialDelayMs: 0,
      intervalMs: 1,
      stableChecks: 1,
      maxChecks: 3,
      parseAttempts: 1,
      parseRetryDelayMs: 0,
      sleepFn: async () => {
        mutation += 1;
        await fs.writeFile(filePath, `${base}${" ".repeat(mutation)}`);
      },
    },
  });

  assert.equal(result.status, "PENDING_RETRY");
  assert.equal(result.error.code, "CANDIDATE_FILE_NOT_STABLE");
  await fs.stat(filePath);
});

test("PRETRADE offline leaves valid automated SOD publication pending", async () => {
  const { inbox } = await tempCandidateRoot();
  const bundle = buildCanonicalSodCandidateBundle(sodDraft(), { automatedPublication: true });
  const filePath = path.join(inbox, "offline.json");
  await fs.writeFile(filePath, JSON.stringify(bundle));

  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const { port } = closed.address();
  await new Promise((resolve, reject) => closed.close((error) => (error ? reject(error) : resolve())));

  const result = await processCandidatePublication(filePath, {
    inboxPath: inbox,
    pretradeUrl: `http://127.0.0.1:${port}`,
    stableFileOptions: fastStable,
  });

  assert.equal(result.status, "PENDING_RETRY");
  assert.equal(result.error.retryable, true);
  assert.match(result.error.code, /^PRETRADE_/);
  await fs.stat(filePath);
});

test("unknown POST outcome safely resolves as DUPLICATE on exact immutable retry", async () => {
  const { inbox, directories } = await tempCandidateRoot();
  const bundle = buildCanonicalSodCandidateBundle(sodDraft(), { automatedPublication: true });
  const exactBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  const filePath = path.join(inbox, "unknown-post.json");
  await fs.writeFile(filePath, exactBytes);
  const pretrade = await startCanonicalPretradeStub({ dropFirstImportResponse: true });

  try {
    const first = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });
    assert.equal(first.status, "PENDING_RETRY");
    assert.equal(pretrade.store.snapshot().candidates.length, 1);
    await fs.stat(filePath);

    const second = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
    });
    assert.equal(second.status, "ARCHIVED");
    assert.equal(second.receipt.candidates[0].ingressStatus, "DUPLICATE");
    assert.equal(second.receipt.candidates[0].verified, true);
    assert.equal(pretrade.importBodies.length, 2);
    assert.deepEqual(pretrade.importBodies[0], exactBytes);
    assert.deepEqual(pretrade.importBodies[1], exactBytes);
    await fs.stat(path.join(directories.archive, path.basename(filePath)));
  } finally {
    await pretrade.close();
  }
});

test("archive finalization failure stays retryable and later duplicate replay completes safely", async () => {
  const { inbox, directories } = await tempCandidateRoot();
  const bundle = buildCanonicalSodCandidateBundle(sodDraft(), { automatedPublication: true });
  const exactBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  const filePath = path.join(inbox, "archive-recovery.json");
  await fs.writeFile(filePath, exactBytes);
  await fs.mkdir(directories.archive, { recursive: true });
  const collisionPath = path.join(directories.archive, path.basename(filePath));
  await fs.writeFile(collisionPath, "different immutable bytes");
  const pretrade = await startCanonicalPretradeStub();
  let tick = 0;
  const clock = () => new Date(Date.parse("2026-09-09T13:10:00.000Z") + (tick++ * 1000)).toISOString();

  try {
    const first = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
      clock,
    });
    assert.equal(first.status, "PENDING_RETRY");
    assert.equal(first.error.code, "CANDIDATE_FEEDER_FINALIZATION_ERROR");
    assert.equal(pretrade.store.snapshot().candidates.length, 1);
    await fs.stat(filePath);

    await fs.unlink(collisionPath);

    const second = await processCandidatePublication(filePath, {
      inboxPath: inbox,
      pretradeUrl: pretrade.url,
      stableFileOptions: fastStable,
      clock,
    });
    assert.equal(second.status, "ARCHIVED");
    assert.equal(second.receipt.candidates[0].ingressStatus, "DUPLICATE");
    assert.deepEqual(await fs.readFile(collisionPath), exactBytes);
  } finally {
    await pretrade.close();
  }
});