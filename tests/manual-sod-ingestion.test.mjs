import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCanonicalContractAuthority,
  candidateContractHash,
  CANDIDATE_STRUCTURAL_LIMITS,
  normalizeCanonicalCandidateProposal,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import {
  AUTOMATED_UNTOUCHED_ONLY,
  MANUAL_AUTHORIZED,
  MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED,
  PreTradeCandidateIngress,
} from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import {
  parseManualIngestionEnvelopeBytes,
  preflightManualSubmission,
  processManualProposalFile,
  drainManualProposalInbox,
  recoverClaimedManualSubmissions,
  reconcileManualSubmission,
  validateManualIngestionEnvelope,
  validateRawManualJson,
  acquireSubmissionJournalLock,
  manualIngestionDirectories,
} from "../schwab-bridge/manual-sod-ingestion.mjs";
import {
  drainCandidateInbox,
  validateCandidateBundle,
} from "../schwab-bridge/candidate-feeder.mjs";
import { createPreTradeCandidateApiHandler } from "../schwab-bridge/pretrade-candidate-api.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";

function candidate(overrides = {}) {
  return {
    candidateId: "manual-2026-09-10-nvda-vwap-reclaim-long",
    symbol: "NVDA",
    direction: "LONG",
    setup: "VWAP reclaim continuation",
    timeframe: "2m",
    thesis: "Continuation after a confirmed VWAP reclaim.",
    trigger: { type: "MANUAL_CONFIRMATION", prompt: "Confirm reclaim and hold" },
    structuralInvalidation: {
      price: 224.5,
      rule: "acceptance below reclaim structure",
      referenceType: "SWING_LOW",
      reason: "long thesis invalid below reclaimed structure",
    },
    targets: [{ targetId: "T1", label: "T1", price: 226.5 }],
    managementContract: { mode: "SINGLE_ENTRY", allowReAdd: false },
    validity: {
      validFrom: "2026-09-10T13:30:00.000Z",
      validUntil: "2026-09-10T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    ingestionSchemaVersion: 1,
    submission: {
      submissionId: "manual-submission-001",
      submissionType: "MANUAL_SOD",
      preparedAt: "2026-09-10T13:00:00.000Z",
    },
    source: SOURCE,
    sourceDate: "2026-09-10",
    bundleId: "manual-sod-2026-09-10-a-plus-trades",
    validity: {
      validFrom: "2026-09-10T13:30:00.000Z",
      validUntil: "2026-09-10T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
    },
    candidates: [candidate()],
    ...overrides,
  };
}

function canonicalPrior(input = candidate(), overrides = {}) {
  const { normalized, errors } = normalizeCanonicalCandidateProposal({
    ...input,
    contractVersion: overrides.contractVersion ?? 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-10",
    generatedAt: "2026-09-10T13:00:00.000Z",
  }, { bundleSource: SOURCE });
  assert.deepEqual(errors, []);
  const hash = candidateContractHash(normalized);
  return {
    ...normalized,
    contentHash: hash,
    contractAuthority: buildCanonicalContractAuthority({
      contentHash: hash,
      bundleSource: SOURCE,
      bundleId: "prior-bundle",
      acceptedAt: "2026-09-10T13:01:00.000Z",
    }),
    lifecycleState: overrides.lifecycleState ?? "WAITING",
    stateRevision: overrides.stateRevision ?? 0,
    lifecycleJournal: { events: [], operations: [] },
    armAuthorized: false,
  };
}

async function tempDirs() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-manual-ingestion-"));
  const manualInbox = path.join(root, "Manual Proposal Inbox");
  const candidateInbox = path.join(root, "Candidate Inbox");
  await fs.mkdir(manualInbox, { recursive: true });
  await fs.mkdir(candidateInbox, { recursive: true });
  return { root, manualInbox, candidateInbox };
}

function jsonResponse(res, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": body.length,
  });
  res.end(body);
}

async function startPretradeSnapshotStub({ candidates = [] } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (req.method === "GET" && req.url === "/api/candidates") {
      jsonResponse(res, 200, { candidates });
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
  maxChecks: 2,
  parseAttempts: 1,
  parseRetryDelayMs: 0,
};

async function startPretradeAuthority(store, ingress) {
  const lifecycleCoordinator = new PreTradeLifecycleCoordinator({
    store,
    clock: () => "2026-09-10T13:20:00.000Z",
  });
  const handler = createPreTradeCandidateApiHandler({
    candidateIngress: ingress,
    lifecycleCoordinator,
    ocoService: {
      reconcileBlockedHandoffRetirements: () => [],
      reconcileClosedNoArm: () => [],
    },
  });
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      jsonResponse(res, 200, {
        ok: true,
        service: "executionos-v24-pretrade",
        candidateIngressAuthority: true,
        candidateContractVersioning: true,
        candidateAutomatedIngressPolicy: AUTOMATED_UNTOUCHED_ONLY,
        candidateManualIngressPolicy: MANUAL_AUTHORIZED,
        readOnlyBrokerBoundary: true,
        brokerWriteAuthority: false,
      });
      return;
    }
    if (await handler(req, res)) return;
    if (req.method === "GET" && req.url === "/api/candidates") {
      jsonResponse(res, 200, { candidates: store.snapshot().candidates });
      return;
    }
    jsonResponse(res, 404, { error: "not found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function readJournalEvents(root, submissionId) {
  const eventDir = path.join(root, "manual-ingestion-journal", submissionId, "events");
  const names = (await fs.readdir(eventDir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await fs.readFile(path.join(eventDir, name), "utf8"))));
}

async function journaledCanonicalBundle(root, submissionId) {
  const events = await readJournalEvents(root, submissionId);
  return events.findLast((event) => event.eventType === "PREFLIGHTED")?.canonicalBundle;
}

test("A envelope contract is closed and standalone trade cards require exactly one candidate", () => {
  assert.deepEqual(validateManualIngestionEnvelope(envelope()), []);
  assert.match(validateManualIngestionEnvelope(envelope({ extra: true })).join(" "), /unknown envelope field/);
  assert.match(validateManualIngestionEnvelope(envelope({
    submission: { ...envelope().submission, extra: true },
  })).join(" "), /unknown submission field/);
  assert.match(validateManualIngestionEnvelope(envelope({
    submission: { ...envelope().submission, submissionType: "MANUAL_STANDALONE_TRADE_CARD" },
    candidates: [candidate(), candidate({ candidateId: "second-id", symbol: "AMD" })],
  })).join(" "), /exactly one candidate/);
});

test("B strict JSON duplicate keys and structural safety fail closed", () => {
  assert.throws(
    () => parseManualIngestionEnvelopeBytes(Buffer.from('{"ingestionSchemaVersion":1,"ingestionSchemaVersion":1}')),
    (error) => error.code === "MANUAL_INGESTION_DUPLICATE_KEYS",
  );
  const tooDeep = envelope();
  let cursor = {};
  tooDeep.candidates[0].scenarioTree = cursor;
  for (let i = 0; i < CANDIDATE_STRUCTURAL_LIMITS.maxDepth + 2; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.match(validateManualIngestionEnvelope(tooDeep).join(" "), /nesting depth limit/);
});

test("B decoded duplicate JSON keys are rejected at every nesting level", () => {
  for (const raw of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"\\u0061":1,"a":2}',
    '{"outer":{"a":1,"\\u0061":2}}',
    '{"😀":1,"\\ud83d\\ude00":2}',
  ]) {
    assert.throws(
      () => parseManualIngestionEnvelopeBytes(Buffer.from(raw)),
      (error) => error.code === "MANUAL_INGESTION_DUPLICATE_KEYS",
      raw,
    );
  }

  assert.doesNotThrow(() => validateRawManualJson('{"a":1,"A":2,"á":3,"á":4}'));
  assert.throws(
    () => parseManualIngestionEnvelopeBytes(Buffer.from('{"bad\\q":1}')),
    (error) => error.code === "MANUAL_INGESTION_INVALID_JSON",
  );
});

test("B raw resource validation enforces limits before materializing the full JSON object", () => {
  assert.throws(
    () => validateRawManualJson(`"${"x".repeat(20)}"`, { limits: { ...CANDIDATE_STRUCTURAL_LIMITS, maxStringBytes: 10 } }),
    (error) => error.code === "MANUAL_INGESTION_STRUCTURAL_LIMIT",
  );
  assert.throws(
    () => validateRawManualJson(" ".repeat(50), { limits: { ...CANDIDATE_STRUCTURAL_LIMITS, maxSerializedBytes: 10 } }),
    (error) => error.code === "MANUAL_INGESTION_RAW_TOO_LARGE",
  );
  assert.throws(
    () => validateRawManualJson("[[[0]]]", { limits: { ...CANDIDATE_STRUCTURAL_LIMITS, maxDepth: 2 } }),
    (error) => error.code === "MANUAL_INGESTION_STRUCTURAL_LIMIT",
  );
  assert.throws(
    () => validateRawManualJson('{"a":1,"b":2}', { limits: { ...CANDIDATE_STRUCTURAL_LIMITS, maxObjectKeys: 1 } }),
    (error) => error.code === "MANUAL_INGESTION_STRUCTURAL_LIMIT",
  );
  assert.throws(
    () => validateRawManualJson("[1,2]", { limits: { ...CANDIDATE_STRUCTURAL_LIMITS, maxArrayLength: 1 } }),
    (error) => error.code === "MANUAL_INGESTION_STRUCTURAL_LIMIT",
  );
  assert.throws(
    () => validateRawManualJson("123456", { limits: { ...CANDIDATE_STRUCTURAL_LIMITS, maxStringBytes: 3 } }),
    (error) => error.code === "MANUAL_INGESTION_STRUCTURAL_LIMIT",
  );
  assert.throws(
    () => validateRawManualJson("[1,,2]"),
    (error) => error.code === "MANUAL_INGESTION_INVALID_JSON",
  );
  const raw = JSON.stringify(envelope({
    candidates: [candidate({ tradeNotes: "representative rich but bounded SOD/trade-card note" })],
  }));
  assert.doesNotThrow(() => validateRawManualJson(raw));
  assert.equal(parseManualIngestionEnvelopeBytes(Buffer.from(raw)).candidates[0].tradeNotes, "representative rich but bounded SOD/trade-card note");
});

test("C manual candidate authority fields are rejected before canonical publication", () => {
  const errors = validateManualIngestionEnvelope(envelope({
    candidates: [candidate({
      contractVersion: 2,
      selectedQuantity: 10,
      forceImport: true,
      manualSupersessionDeclines: [{ decision: "DECLINED" }],
    })],
  }));
  assert.match(errors.join(" "), /contractVersion/);
  assert.match(errors.join(" "), /selectedQuantity/);
  assert.match(errors.join(" "), /forceImport/);
  assert.match(errors.join(" "), /manualSupersessionDeclines/);
});

test("D E optional content is preserved, hashed, and managementPlan remains independent", () => {
  const proposed = envelope({
    candidates: [candidate({
      managementContract: { mode: "SINGLE_ENTRY" },
      managementPlan: { operatorNotes: "Scale only after first target" },
      orderFlowContext: { imbalance: "bullish" },
      scenarioTree: [{ name: "base", action: "wait" }],
      tradeNotes: "Human notes are substantive but non-operational.",
    })],
  });
  const preflight = preflightManualSubmission(proposed, []);
  assert.equal(preflight.status, "PREFLIGHTED");
  const normalized = preflight.canonicalBundle.candidates[0];
  assert.deepEqual(normalized.managementContract, { mode: "SINGLE_ENTRY" });
  assert.deepEqual(normalized.managementPlan, { operatorNotes: "Scale only after first target" });
  assert.deepEqual(normalized.orderFlowContext, { imbalance: "bullish" });
  assert.equal(preflight.lineage[0].classification, "NEW");

  const changed = preflightManualSubmission(envelope({
    candidates: [candidate({ orderFlowContext: { imbalance: "mixed" } })],
  }), [canonicalPrior(candidate({ orderFlowContext: { imbalance: "bullish" } }))]);
  assert.equal(changed.lineage[0].classification, "REVISED");
});

test("F G T trusted fields and semantic schema are materialized by ExecutionOS lineage", () => {
  const candidateWithoutValidity = candidate();
  delete candidateWithoutValidity.validity;
  const preflight = preflightManualSubmission(envelope({
    validity: {
      validFrom: "2026-09-10T14:00:00.000Z",
      validUntil: "2026-09-10T20:00:00.000Z",
      timezone: "America/Denver",
      session: "RTH",
    },
    candidates: [candidateWithoutValidity],
  }), []);
  const normalized = preflight.canonicalBundle.candidates[0];
  assert.equal(normalized.source, SOURCE);
  assert.equal(normalized.sourceDate, "2026-09-10");
  assert.equal(normalized.generatedAt, "2026-09-10T13:00:00.000Z");
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.contractVersion, 1);
  assert.equal(normalized.validity.validFrom, "2026-09-10T14:00:00.000Z");
});

test("H O P Q durable claim, replay, journal, recovery evidence, and receipts are immutable records", async () => {
  const { manualInbox, candidateInbox, root } = await tempDirs();
  const store = new PreTradeStore({ filePath: path.join(root, "pretrade-state.json") });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock: () => "2026-09-10T13:05:30.000Z" });
  const pretrade = await startPretradeAuthority(store, ingress);
  const filePath = path.join(manualInbox, "manual.json");
  await fs.writeFile(filePath, `${JSON.stringify(envelope(), null, 2)}\n`);
  try {
    const result = await processManualProposalFile(filePath, {
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:05:00.000Z",
      idFactory: () => "publication-1",
      stableFileOptions: fastStable,
    });
    assert.equal(result.status, "RECOVERY_REQUIRED");
    assert.equal(result.recoveryReason, "PUBLICATION_AWAITING_CANDIDATE_FEEDER");
    assert.ok(result.publication.finalPath.startsWith(candidateInbox));
    assert.ok(fsSync.existsSync(result.movedTo));
    assert.deepEqual(await fs.readdir(path.join(root, "manual-ingestion-receipts")).catch(() => []), []);

    const claim = JSON.parse(await fs.readFile(path.join(root, "manual-ingestion-journal", "manual-submission-001", "claim.json"), "utf8"));
    assert.equal(claim.submissionId, "manual-submission-001");
    const journalEntries = await fs.readdir(path.join(root, "manual-ingestion-journal", "manual-submission-001", "events"));
    assert.ok(journalEntries.some((name) => name.includes("RECEIVED")));
    assert.ok(journalEntries.some((name) => name.includes("PUBLISHED")));

    const pending = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:05:45.000Z",
    });
    assert.equal(pending.results[0].status, "RECOVERY_REQUIRED");
    assert.equal(pending.results[0].reason, "CANDIDATE_FEEDER_ADMISSION_PENDING");

    const replayPath = path.join(manualInbox, "manual-replay.json");
    await fs.writeFile(replayPath, `${JSON.stringify(envelope(), null, 2)}\n`);
    const replayPending = await processManualProposalFile(replayPath, {
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:06:00.000Z",
      idFactory: () => "must-not-publish",
      stableFileOptions: fastStable,
    });
    assert.equal(replayPending.replay, true);
    assert.equal(replayPending.status, "RECOVERY_REQUIRED");
    assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 1);

    const fed = await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:07:00.000Z",
      stableFileOptions: fastStable,
    });
    assert.equal(fed.results[0].status, "ARCHIVED");
    assert.equal(fed.results[0].receipt.candidates[0].ingressStatus, "ACCEPTED");

    const recovered = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:08:00.000Z",
    });
    const final = recovered.results[0].result;
    assert.equal(final.status, "SUCCESS");
    assert.equal(final.receipt.candidateOutcomes[0].status, "ACCEPTED");
    assert.ok(fsSync.existsSync(final.receiptPath));
    assert.equal(store.snapshot().candidates.length, 1);
    assert.equal(store.snapshot().candidates[0].contentHash, final.receipt.candidateOutcomes[0].contentHash);

    const finalReplay = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:09:00.000Z",
    });
    assert.equal(finalReplay.results[0].result.receiptPath, final.receiptPath);
    assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 0);
  } finally {
    await pretrade.close();
  }
});

test("O single submission journal writer lock prevents concurrent processors", async () => {
  const { manualInbox } = await tempDirs();
  const directories = manualIngestionDirectories(manualInbox);
  const release = await acquireSubmissionJournalLock({
    journalDir: directories.journal,
    submissionId: "manual-submission-001",
    clock: () => "2026-09-10T13:00:00.000Z",
  });
  try {
    await assert.rejects(
      () => acquireSubmissionJournalLock({
        journalDir: directories.journal,
        submissionId: "manual-submission-001",
        clock: () => "2026-09-10T13:00:00.000Z",
      }),
      (error) => error.code === "MANUAL_SUBMISSION_LOCK_HELD",
    );
  } finally {
    await release();
  }

  const staleLock = path.join(directories.journal, "stale-submission", ".lock");
  await fs.mkdir(staleLock, { recursive: true });
  await fs.writeFile(path.join(staleLock, "owner.json"), JSON.stringify({
    pid: 99999999,
    lockId: "dead-owner",
    acquiredAt: "2026-09-10T12:00:00.000Z",
  }));
  const reclaimed = await acquireSubmissionJournalLock({
    journalDir: directories.journal,
    submissionId: "stale-submission",
    clock: () => "2026-09-10T13:01:00.000Z",
  });
  await reclaimed();

  const corruptLock = path.join(directories.journal, "corrupt-submission", ".lock");
  await fs.mkdir(corruptLock, { recursive: true });
  await fs.writeFile(path.join(corruptLock, "owner.json"), "{not-json");
  await assert.rejects(
    () => acquireSubmissionJournalLock({
      journalDir: directories.journal,
      submissionId: "corrupt-submission",
      clock: () => "2026-09-10T13:02:00.000Z",
    }),
    (error) => error.code === "MANUAL_SUBMISSION_LOCK_UNVERIFIABLE",
  );
});

test("I L M N manual revised candidates require bound authorization and commit atomically in PRETRADE", () => {
  const statePath = path.join(fsSync.mkdtempSync(path.join(os.tmpdir(), "executionos-manual-pretrade-")), "state.json");
  const store = new PreTradeStore({ filePath: statePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => "2026-09-10T13:10:00.000Z",
    idFactory: () => crypto.randomUUID(),
  });
  const prior = canonicalPrior();
  store.state.candidates.push(structuredClone(prior));

  const revised = preflightManualSubmission(envelope({
    candidates: [candidate({ thesis: "Revised after stronger reclaim." })],
  }), [prior]);
  assert.equal(revised.status, "ACTION_REQUIRED");
  assert.equal(revised.plan[0].preflightStatus, "ACTION_REQUIRED");

  const noAuth = ingress.importBundle(revised.canonicalBundle, { ingressPolicy: MANUAL_AUTHORIZED });
  assert.equal(noAuth.outcomes[0].status, "ACTION_REQUIRED");
  assert.deepEqual(noAuth.outcomes[0].reasons, [MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED]);
  assert.equal(store.snapshot().candidates.length, 1);

  const proposed = revised.canonicalBundle.candidates[0];
  const review = ingress.createManualSupersessionReview(revised.canonicalBundle);
  const auth = ingress.authorizeManualSupersession({
    reviewId: review.reviews[0].reviewId,
    operatorConfirmed: true,
  });
  assert.equal(auth.reviewId, review.reviews[0].reviewId);
  const accepted = ingress.importBundle(revised.canonicalBundle, {
    ingressPolicy: MANUAL_AUTHORIZED,
  });
  assert.equal(accepted.outcomes[0].status, "ACCEPTED");
  const state = store.snapshot();
  assert.equal(state.candidates.find((item) => item.contractVersion === 1).lifecycleState, "SUPERSEDED");
  assert.equal(state.candidates.find((item) => item.contractVersion === 2).lifecycleState, "WAITING");

  const terminalPrior = canonicalPrior(undefined, { lifecycleState: "ARMED", stateRevision: 1 });
  const terminalStore = new PreTradeStore({ filePath: path.join(fsSync.mkdtempSync(path.join(os.tmpdir(), "executionos-terminal-")), "state.json") });
  terminalStore.load();
  terminalStore.state.candidates.push(terminalPrior);
  const terminalIngress = new PreTradeCandidateIngress({ store: terminalStore });
  const blocked = terminalIngress.importBundle(revised.canonicalBundle, {
    ingressPolicy: MANUAL_AUTHORIZED,
  });
  assert.equal(blocked.outcomes[0].status, "REJECTED");
});

test("J K R feeder transport accepts recognized manual policy and rejects legacy/no-policy bundles", () => {
  const preflight = preflightManualSubmission(envelope(), []);
  assert.deepEqual(validateCandidateBundle(preflight.canonicalBundle, Buffer.from(JSON.stringify(preflight.canonicalBundle))), []);
  assert.match(validateCandidateBundle({ ...preflight.canonicalBundle, ingressPolicy: null }, Buffer.from("{}")).join(" "), /ingressPolicy/);
  assert.match(validateManualIngestionEnvelope(candidate()).join(" "), /ingestionSchemaVersion|submission|candidates/);
});

test("R Manual Proposal Inbox drain ignores unrelated directories and archives or quarantines source artifacts", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const unrelated = path.join(root, "Downloads");
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, "ignored.json"), JSON.stringify(envelope({ submission: { ...envelope().submission, submissionId: "ignored" } })));
  await fs.writeFile(path.join(manualInbox, "valid.json"), `${JSON.stringify(envelope(), null, 2)}\n`);
  await fs.writeFile(path.join(manualInbox, "bad.json"), '{"submission":{"submissionId":"bad"},"submission":{"submissionId":"bad"}}');

  const drained = await drainManualProposalInbox({
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: [],
    recover: false,
    clock: () => "2026-09-10T13:10:00.000Z",
    idFactory: () => "publication-drain",
    stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
  });
  assert.equal(drained.filesDiscovered, 2);
  assert.equal(drained.results.filter((item) => item.status === "RECOVERY_REQUIRED").length, 1);
  assert.equal(drained.results.filter((item) => item.status === "FAILED").length, 1);
  assert.ok(fsSync.existsSync(path.join(unrelated, "ignored.json")));
  assert.ok((await fs.readdir(path.join(root, "manual-ingestion-archive"))).some((name) => name === "valid.json"));
  assert.ok((await fs.readdir(path.join(root, "manual-ingestion-quarantine"))).some((name) => name === "bad.json"));
});

test("R production drain reads authoritative PRETRADE snapshot before lineage preflight", async () => {
  const { manualInbox, candidateInbox } = await tempDirs();
  const prior = canonicalPrior();
  await fs.writeFile(path.join(manualInbox, "revised.json"), `${JSON.stringify(envelope({
    candidates: [candidate({ thesis: "Substantive revision discovered from PRETRADE snapshot." })],
  }), null, 2)}\n`);
  const pretrade = await startPretradeSnapshotStub({ candidates: [prior] });
  try {
    const drained = await drainManualProposalInbox({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      recover: false,
      clock: () => "2026-09-10T13:10:00.000Z",
      stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
    });
    assert.equal(drained.results[0].status, "ACTION_REQUIRED");
    assert.equal(drained.results[0].receipt.preflightPlan[0].classification, "REVISED");
    assert.equal(drained.results[0].receipt.preflightPlan[0].contractVersion, 2);
    assert.equal((await fs.readdir(candidateInbox)).length, 0);
    assert.ok(pretrade.requests.some((request) => request.method === "GET" && request.url === "/api/candidates"));
  } finally {
    await pretrade.close();
  }
});

test("R ACTION_REQUIRED and admission-pending partial submissions leave the hot inbox", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const prior = canonicalPrior();
  await fs.writeFile(path.join(manualInbox, "action.json"), JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId: "action-required" },
    candidates: [candidate({ thesis: "Revision requiring supersession." })],
  })));
  await fs.writeFile(path.join(manualInbox, "partial.json"), JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId: "partial-success" },
    candidates: [
      candidate({ candidateId: "manual-2026-09-10-amd-vwap-reclaim-long", symbol: "AMD" }),
      candidate({ candidateId: "manual-invalid", symbol: "" }),
    ],
  })));

  const action = await processManualProposalFile(path.join(manualInbox, "action.json"), {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: [prior],
    clock: () => "2026-09-10T13:11:00.000Z",
    stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
  });
  const partial = await processManualProposalFile(path.join(manualInbox, "partial.json"), {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: [],
    clock: () => "2026-09-10T13:12:00.000Z",
    idFactory: () => "partial-publication",
    stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
  });
  assert.equal(action.status, "ACTION_REQUIRED");
  assert.equal(partial.status, "RECOVERY_REQUIRED");
  assert.equal(partial.recoveryReason, "PUBLICATION_AWAITING_CANDIDATE_FEEDER");
  const archived = await fs.readdir(path.join(root, "manual-ingestion-archive"));
  assert.ok(archived.includes("action.json"));
  assert.ok(archived.includes("partial.json"));

  const receiptFilesBeforeAdmission = await fs.readdir(path.join(root, "manual-ingestion-receipts"));
  const receiptsBeforeAdmission = await Promise.all(receiptFilesBeforeAdmission.map(async (name) => (
    JSON.parse(await fs.readFile(path.join(root, "manual-ingestion-receipts", name), "utf8"))
  )));
  assert.equal(receiptsBeforeAdmission.some((receipt) => receipt.submissionId === "partial-success"), false);

  const store = new PreTradeStore({ filePath: path.join(root, "pretrade-state.json") });
  store.load();
  store.state.candidates.push(structuredClone(prior));
  store.save();
  const ingress = new PreTradeCandidateIngress({ store, clock: () => "2026-09-10T13:12:15.000Z" });
  const pretrade = await startPretradeAuthority(store, ingress);
  try {
    const fed = await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:12:20.000Z",
      stableFileOptions: fastStable,
    });
    assert.equal(fed.results[0].status, "ARCHIVED");
    const recoveredPartial = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:12:30.000Z",
    });
    const partialRecovery = recoveredPartial.results.find((item) => item.submissionId === "partial-success");
    assert.equal(partialRecovery.status, "RECOVERED");
    assert.equal(partialRecovery.result.status, "PARTIAL_SUCCESS");
    assert.equal(partialRecovery.result.receipt.candidateOutcomes[0].status, "ACCEPTED");
    assert.equal(partialRecovery.result.receipt.candidateOutcomes[1].status, "REJECTED");
  } finally {
    await pretrade.close();
  }
});

test("P published candidate remains admission-pending after source leaves hot inbox", async () => {
  const { manualInbox, candidateInbox } = await tempDirs();
  const filePath = path.join(manualInbox, "recover.json");
  await fs.writeFile(filePath, JSON.stringify(envelope()));
  const first = await processManualProposalFile(filePath, {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: [],
    clock: () => "2026-09-10T13:13:00.000Z",
    idFactory: () => "recover-publication",
    stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
  });
  assert.equal(first.status, "RECOVERY_REQUIRED");
  const recovered = await recoverClaimedManualSubmissions({
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    pretradeCandidates: [],
    clock: () => "2026-09-10T13:14:00.000Z",
  });
  assert.equal(recovered.results[0].status, "RECOVERY_REQUIRED");
  assert.equal(recovered.results[0].reason, "CANDIDATE_FEEDER_ADMISSION_PENDING");
  assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 1);
});

test("P recovery observes authoritative PRETRADE admission after candidate feeder consumed publication", async () => {
  const { manualInbox, candidateInbox } = await tempDirs();
  const filePath = path.join(manualInbox, "pretrade-recovery.json");
  await fs.writeFile(filePath, JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId: "pretrade-recovery" },
  })));
  const first = await processManualProposalFile(filePath, {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: [],
    clock: () => "2026-09-10T13:15:00.000Z",
    idFactory: () => "pretrade-recovery-publication",
    stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
  });
  assert.equal(first.status, "RECOVERY_REQUIRED");
  const publishedBundle = JSON.parse(await fs.readFile(first.publication.finalPath, "utf8"));
  const admittedCandidate = {
    ...publishedBundle.candidates[0],
    contentHash: candidateContractHash(publishedBundle.candidates[0]),
  };
  await fs.rm(first.publication.finalPath);

  const staleLock = path.join(manualIngestionDirectories(manualInbox).journal, "pretrade-recovery", ".lock");
  await fs.mkdir(staleLock, { recursive: true });
  await fs.writeFile(path.join(staleLock, "owner.json"), JSON.stringify({
    pid: 99999999,
    lockId: "dead-recovery-owner",
    acquiredAt: "2026-09-10T13:15:01.000Z",
  }));

  const pretrade = await startPretradeSnapshotStub({ candidates: [admittedCandidate] });
  try {
    const recovered = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:16:00.000Z",
    });
    assert.equal(recovered.results[0].status, "RECOVERED");
    assert.equal(recovered.results[0].result.status, "SUCCESS");
    assert.equal(recovered.results[0].result.receipt.recovery.pretradeAdmissionObserved, true);
  } finally {
    await pretrade.close();
  }
});

test("ordinary NEW publication resolves FAILED when PRETRADE wins the race with conflicting content", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const submissionId = "new-conflict-race";
  const store = new PreTradeStore({ filePath: path.join(root, "pretrade-state.json") });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock: () => "2026-09-10T13:17:00.000Z" });
  const pretrade = await startPretradeAuthority(store, ingress);
  const filePath = path.join(manualInbox, "new-conflict-race.json");
  await fs.writeFile(filePath, JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId },
    bundleId: "manual-new-conflict-race",
  })));
  try {
    const pending = await processManualProposalFile(filePath, {
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:16:00.000Z",
      idFactory: () => "new-conflict-publication",
      stableFileOptions: fastStable,
    });
    assert.equal(pending.status, "RECOVERY_REQUIRED");
    assert.deepEqual(await fs.readdir(path.join(root, "manual-ingestion-receipts")).catch(() => []), []);

    const conflicting = canonicalPrior(candidate({ thesis: "A different v1 won the PRETRADE race." }));
    store.state.candidates.push(conflicting);
    store.save();
    const fed = await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:18:00.000Z",
      stableFileOptions: fastStable,
    });
    assert.equal(fed.results[0].status, "QUARANTINED");
    assert.equal(fed.results[0].receipt.candidates[0].ingressStatus, "CONFLICT");
    assert.ok(fsSync.existsSync(path.join(root, "quarantine", pending.publication.finalName)));

    const recovered = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:19:00.000Z",
    });
    const final = recovered.results[0].result;
    assert.equal(final.status, "FAILED");
    assert.equal(final.receipt.candidateOutcomes[0].status, "CONFLICT");
    assert.equal(final.receipt.candidateOutcomes[0].candidateFeederEvidence.ingressStatus, "CONFLICT");
    assert.equal(store.snapshot().candidates.length, 1);
    assert.equal(store.snapshot().candidates[0].contentHash, conflicting.contentHash);
  } finally {
    await pretrade.close();
  }
});

test("exact PRETRADE race is reconciled as DUPLICATE only after feeder verification", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const submissionId = "new-exact-duplicate";
  const store = new PreTradeStore({ filePath: path.join(root, "pretrade-state.json") });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock: () => "2026-09-10T13:20:00.000Z" });
  const pretrade = await startPretradeAuthority(store, ingress);
  const filePath = path.join(manualInbox, "new-exact-duplicate.json");
  await fs.writeFile(filePath, JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId },
    bundleId: "manual-new-exact-duplicate",
  })));
  try {
    const pending = await processManualProposalFile(filePath, {
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:20:00.000Z",
      idFactory: () => "new-duplicate-publication",
      stableFileOptions: fastStable,
    });
    assert.equal(pending.status, "RECOVERY_REQUIRED");
    const publishedBundle = JSON.parse(await fs.readFile(pending.publication.finalPath, "utf8"));
    assert.equal(ingress.importBundle(publishedBundle, { ingressPolicy: MANUAL_AUTHORIZED }).outcomes[0].status, "ACCEPTED");

    const fed = await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:21:00.000Z",
      stableFileOptions: fastStable,
    });
    assert.equal(fed.results[0].status, "ARCHIVED");
    assert.equal(fed.results[0].receipt.candidates[0].ingressStatus, "DUPLICATE");

    const recovered = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:22:00.000Z",
    });
    assert.equal(recovered.results[0].result.status, "SUCCESS");
    assert.equal(recovered.results[0].result.receipt.candidateOutcomes[0].status, "DUPLICATE");
    assert.equal(store.snapshot().candidates.length, 1);
  } finally {
    await pretrade.close();
  }
});

test("mixed NEW PRETRADE conflict and acceptance reconcile as PARTIAL_SUCCESS", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const submissionId = "mixed-new-conflict-accepted";
  const candidateA = candidate();
  const candidateB = candidate({
    candidateId: "manual-2026-09-10-amd-vwap-reclaim-long",
    symbol: "AMD",
  });
  const store = new PreTradeStore({ filePath: path.join(root, "pretrade-state.json") });
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock: () => "2026-09-10T13:23:00.000Z" });
  const pretrade = await startPretradeAuthority(store, ingress);
  const filePath = path.join(manualInbox, "mixed-new-conflict-accepted.json");
  await fs.writeFile(filePath, JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId },
    bundleId: "manual-mixed-new-conflict-accepted",
    candidates: [candidateA, candidateB],
  })));
  try {
    const pending = await processManualProposalFile(filePath, {
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:23:00.000Z",
      idFactory: () => "mixed-new-publication",
      stableFileOptions: fastStable,
    });
    assert.equal(pending.status, "RECOVERY_REQUIRED");
    const conflictingA = canonicalPrior(candidate({ thesis: "Conflicting NVDA v1 won first." }));
    store.state.candidates.push(conflictingA);
    store.save();

    const fed = await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:24:00.000Z",
      stableFileOptions: fastStable,
    });
    assert.equal(fed.results[0].status, "QUARANTINED");
    assert.deepEqual(fed.results[0].receipt.candidates.map((item) => item.ingressStatus), ["CONFLICT", "ACCEPTED"]);

    const recovered = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:25:00.000Z",
    });
    const final = recovered.results[0].result;
    assert.equal(final.status, "PARTIAL_SUCCESS");
    assert.equal(final.receipt.candidateOutcomes.find((item) => item.candidateId === candidateA.candidateId).status, "CONFLICT");
    assert.equal(final.receipt.candidateOutcomes.find((item) => item.candidateId === candidateB.candidateId).status, "ACCEPTED");
    assert.equal(store.snapshot().candidates.filter((item) => item.candidateId === candidateB.candidateId).length, 1);
  } finally {
    await pretrade.close();
  }
});

test("ACTION_REQUIRED resumes from archived journal evidence through Candidate Feeder and preserves ordered receipt history", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const submissionId = "authorized-resume";
  const statePath = path.join(root, "pretrade-state.json");
  const store = new PreTradeStore({ filePath: statePath });
  store.load();
  const prior = canonicalPrior();
  store.state.candidates.push(structuredClone(prior));
  store.save();
  let ingressId = 0;
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => "2026-09-10T13:20:00.000Z",
    idFactory: () => `authorized-resume-ingress-${++ingressId}`,
  });
  const filePath = path.join(manualInbox, "authorized-resume.json");
  await fs.writeFile(filePath, JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId },
    candidates: [candidate({ thesis: "Exact journaled revision resumes after authorization." })],
  })));

  const initial = await processManualProposalFile(filePath, {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: store.snapshot().candidates,
    clock: () => "2026-09-10T13:21:00.000Z",
    stableFileOptions: fastStable,
  });
  assert.equal(initial.status, "ACTION_REQUIRED");
  assert.ok(fsSync.existsSync(initial.receiptPath));
  assert.ok(fsSync.existsSync(initial.movedTo));
  assert.equal((await fs.readdir(candidateInbox)).length, 0);

  const unchangedReplay = await recoverClaimedManualSubmissions({
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    pretradeCandidates: store.snapshot().candidates,
    clock: () => "2026-09-10T13:21:30.000Z",
  });
  assert.equal(unchangedReplay.results[0].result.status, "ACTION_REQUIRED");
  assert.equal(unchangedReplay.results[0].result.receiptPath, initial.receiptPath);

  const exactJournaledBundle = await journaledCanonicalBundle(root, submissionId);
  const review = ingress.createManualSupersessionReview(exactJournaledBundle).reviews[0];
  ingress.authorizeManualSupersession({ reviewId: review.reviewId, operatorConfirmed: true });
  const pretrade = await startPretradeAuthority(store, ingress);
  try {
    const firstResume = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:22:00.000Z",
      idFactory: () => "authorized-resume-publication",
    });
    assert.equal(firstResume.results[0].status, "RECOVERY_REQUIRED");
    assert.equal(firstResume.results[0].reason, "PUBLICATION_AWAITING_CANDIDATE_FEEDER");
    assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 1);

    const eventDirectory = path.join(root, "manual-ingestion-journal", submissionId, "events");
    const publishedEventName = (await fs.readdir(eventDirectory)).find((name) => name.includes("-PUBLISHED-"));
    await fs.rm(path.join(eventDirectory, publishedEventName));
    const recoveredPublication = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:22:30.000Z",
      idFactory: () => "must-not-duplicate-publication",
    });
    assert.equal(recoveredPublication.results[0].reason, "PUBLICATION_AWAITING_CANDIDATE_FEEDER");
    assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 1);

    const beforeFeeder = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:23:00.000Z",
    });
    assert.equal(beforeFeeder.results[0].reason, "CANDIDATE_FEEDER_ADMISSION_PENDING");
    assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 1);

    const fed = await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:24:00.000Z",
      stableFileOptions: fastStable,
    });
    assert.equal(fed.filesDiscovered, 1);
    assert.equal(fed.results[0].status, "ARCHIVED");
    const resolved = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:25:00.000Z",
    });
    const final = resolved.results[0].result;
    assert.equal(final.status, "SUCCESS");
    assert.equal(final.receipt.candidateOutcomes[0].status, "ACCEPTED");
    assert.notEqual(final.receiptPath, initial.receiptPath);
    assert.ok(fsSync.existsSync(initial.receiptPath));
    assert.ok(fsSync.existsSync(final.receiptPath));

    const finalState = store.snapshot();
    const oldVersion = finalState.candidates.find((item) => item.contractVersion === 1);
    const newVersion = finalState.candidates.find((item) => item.contractVersion === 2);
    assert.equal(oldVersion.lifecycleState, "SUPERSEDED");
    assert.equal(newVersion.lifecycleState, "WAITING");
    assert.equal(newVersion.stateRevision, 0);
    assert.equal(newVersion.armAuthorized, false);
    assert.equal(newVersion.currentDssEvaluationId, null);
    assert.equal(newVersion.currentPermissionOutcome, null);
    assert.equal(newVersion.arm, null);

    const replay = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:26:00.000Z",
    });
    assert.equal(replay.results[0].result.receiptPath, final.receiptPath);
    assert.equal(replay.results[0].result.status, "SUCCESS");
    assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 0);

    const ambiguousCopy = path.join(path.dirname(final.receiptPath), `000-unlinked-${path.basename(final.receiptPath)}`);
    await fs.copyFile(final.receiptPath, ambiguousCopy);
    const corrupt = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeCandidates: store.snapshot().candidates,
      clock: () => "2026-09-10T13:27:00.000Z",
    });
    assert.equal(corrupt.results[0].status, "RECOVERY_BLOCKED");
    assert.equal(corrupt.results[0].error.code, "MANUAL_RECEIPT_ORDERING_CORRUPT");
  } finally {
    await pretrade.close();
  }
});

test("durable explicit decline resolves ACTION_REQUIRED after restart without publication or PRETRADE mutation", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const submissionId = "declined-resume";
  const statePath = path.join(root, "pretrade-state.json");
  const store = new PreTradeStore({ filePath: statePath });
  store.load();
  const prior = canonicalPrior();
  store.state.candidates.push(structuredClone(prior));
  store.save();
  const ingress = new PreTradeCandidateIngress({ store, clock: () => "2026-09-10T13:30:00.000Z" });
  const filePath = path.join(manualInbox, "declined-resume.json");
  await fs.writeFile(filePath, JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId },
    candidates: [candidate({ thesis: "Reviewed proposal deliberately declined." })],
  })));
  const initial = await processManualProposalFile(filePath, {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: store.snapshot().candidates,
    clock: () => "2026-09-10T13:31:00.000Z",
    stableFileOptions: fastStable,
  });
  const exactJournaledBundle = await journaledCanonicalBundle(root, submissionId);
  const review = ingress.createManualSupersessionReview(exactJournaledBundle).reviews[0];
  ingress.declineManualSupersession({ reviewId: review.reviewId, operatorDeclined: true });

  const restartedStore = new PreTradeStore({ filePath: statePath });
  restartedStore.load();
  const restartedIngress = new PreTradeCandidateIngress({ store: restartedStore });
  const pretrade = await startPretradeAuthority(restartedStore, restartedIngress);
  try {
    const resolved = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:32:00.000Z",
    });
    const final = resolved.results[0].result;
    assert.equal(final.status, "SUCCESS");
    assert.equal(final.receipt.candidateOutcomes[0].status, "SUPERSESSION_DECLINED");
    assert.notEqual(final.receiptPath, initial.receiptPath);
    assert.ok(fsSync.existsSync(initial.receiptPath));
    assert.equal((await fs.readdir(candidateInbox)).length, 0);
    const persistedPrior = restartedStore.snapshot().candidates[0];
    assert.equal(restartedStore.snapshot().candidates.length, 1);
    assert.equal(persistedPrior.candidateId, prior.candidateId);
    assert.equal(persistedPrior.contractVersion, 1);
    assert.equal(persistedPrior.contentHash, prior.contentHash);
    assert.equal(persistedPrior.lifecycleState, "WAITING");
    assert.equal(persistedPrior.stateRevision, 0);
    assert.equal(restartedStore.snapshot().manualSupersessionAuthorizations.length, 0);
    assert.equal(restartedStore.snapshot().manualSupersessionDeclines.length, 1);

    await fs.rm(final.receiptPath);
    const replay = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:33:00.000Z",
    });
    assert.equal(replay.results[0].result.receiptPath, final.receiptPath);
    assert.ok(fsSync.existsSync(final.receiptPath));
    assert.equal(replay.results[0].result.receipt.candidateOutcomes[0].status, "SUPERSESSION_DECLINED");
  } finally {
    await pretrade.close();
  }
});

test("mixed NEW and multiple REVISED candidates resume independently without duplicate publication", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const submissionId = "mixed-resume";
  const candidateB = candidate();
  const candidateC = candidate({ candidateId: "manual-2026-09-10-amd-vwap-reclaim-long", symbol: "AMD" });
  const candidateA = candidate({ candidateId: "manual-2026-09-10-msft-vwap-reclaim-long", symbol: "MSFT" });
  const priorB = canonicalPrior(candidateB);
  const priorC = canonicalPrior(candidateC);
  const store = new PreTradeStore({ filePath: path.join(root, "pretrade-state.json") });
  store.load();
  store.state.candidates.push(structuredClone(priorB), structuredClone(priorC));
  store.save();
  let ingressId = 0;
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => "2026-09-10T13:40:00.000Z",
    idFactory: () => `mixed-ingress-${++ingressId}`,
  });
  await fs.writeFile(path.join(manualInbox, "mixed-resume.json"), JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId },
    candidates: [
      candidateA,
      { ...candidateB, thesis: "Authorized B revision." },
      { ...candidateC, thesis: "Still unresolved C revision." },
    ],
  })));
  const initial = await processManualProposalFile(path.join(manualInbox, "mixed-resume.json"), {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: store.snapshot().candidates,
    clock: () => "2026-09-10T13:41:00.000Z",
    idFactory: () => "mixed-new-publication",
    stableFileOptions: fastStable,
  });
  assert.equal(initial.status, "ACTION_REQUIRED");
  const pretrade = await startPretradeAuthority(store, ingress);
  try {
    const fedNew = await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:42:00.000Z",
      stableFileOptions: fastStable,
    });
    assert.equal(fedNew.results[0].status, "ARCHIVED");
    const exactJournaledBundle = await journaledCanonicalBundle(root, submissionId);
    const reviews = ingress.createManualSupersessionReview(exactJournaledBundle).reviews;
    const reviewB = reviews.find((item) => item.binding?.candidateId === candidateB.candidateId);
    const reviewC = reviews.find((item) => item.binding?.candidateId === candidateC.candidateId);
    ingress.authorizeManualSupersession({ reviewId: reviewB.reviewId, operatorConfirmed: true });

    await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:43:00.000Z",
      idFactory: () => "mixed-revised-publication",
    });
    const resumedBundlePath = (await fs.readdir(candidateInbox)).find((name) => name.endsWith(".json"));
    const resumedBundle = JSON.parse(await fs.readFile(path.join(candidateInbox, resumedBundlePath), "utf8"));
    assert.deepEqual(resumedBundle.candidates.map((item) => item.candidateId), [candidateB.candidateId]);
    await drainCandidateInbox({
      inboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:44:00.000Z",
      stableFileOptions: fastStable,
    });

    const partiallyResolved = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:45:00.000Z",
    });
    const actionReceipt = partiallyResolved.results[0].result;
    assert.equal(actionReceipt.status, "ACTION_REQUIRED");
    assert.equal(actionReceipt.receipt.candidateOutcomes.find((item) => item.candidateId === candidateB.candidateId).status, "ACCEPTED");
    assert.equal(actionReceipt.receipt.candidateOutcomes.find((item) => item.candidateId === candidateC.candidateId).status, "ACTION_REQUIRED");
    const unchangedAction = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:45:30.000Z",
    });
    assert.equal(unchangedAction.results[0].result.receiptPath, actionReceipt.receiptPath);
    assert.equal((await fs.readdir(candidateInbox)).filter((name) => name.endsWith(".json")).length, 0);

    ingress.declineManualSupersession({ reviewId: reviewC.reviewId, operatorDeclined: true });
    const final = await recoverClaimedManualSubmissions({
      manualInboxPath: manualInbox,
      candidateInboxPath: candidateInbox,
      pretradeUrl: pretrade.url,
      clock: () => "2026-09-10T13:46:00.000Z",
    });
    assert.equal(final.results[0].result.status, "SUCCESS");
    assert.equal(final.results[0].result.receipt.candidateOutcomes.find((item) => item.candidateId === candidateC.candidateId).status, "SUPERSESSION_DECLINED");
    const finalCandidates = store.snapshot().candidates;
    assert.equal(finalCandidates.filter((item) => item.candidateId === candidateA.candidateId).length, 1);
    assert.equal(finalCandidates.filter((item) => item.candidateId === candidateB.candidateId).length, 2);
    assert.equal(finalCandidates.filter((item) => item.candidateId === candidateC.candidateId).length, 1);
    assert.equal(finalCandidates.find((item) => item.candidateId === candidateC.candidateId).lifecycleState, "WAITING");
  } finally {
    await pretrade.close();
  }
});

test("stale PRETRADE authorization is invalidated before resume publication", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const submissionId = "stale-authorization-resume";
  const store = new PreTradeStore({ filePath: path.join(root, "pretrade-state.json") });
  store.load();
  store.state.candidates.push(canonicalPrior());
  store.save();
  const ingress = new PreTradeCandidateIngress({ store, clock: () => "2026-09-10T13:50:00.000Z" });
  await fs.writeFile(path.join(manualInbox, "stale.json"), JSON.stringify(envelope({
    submission: { ...envelope().submission, submissionId },
    candidates: [candidate({ thesis: "Authorization becomes stale before publication." })],
  })));
  const initial = await processManualProposalFile(path.join(manualInbox, "stale.json"), {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: store.snapshot().candidates,
    clock: () => "2026-09-10T13:51:00.000Z",
    stableFileOptions: fastStable,
  });
  const exactJournaledBundle = await journaledCanonicalBundle(root, submissionId);
  const review = ingress.createManualSupersessionReview(exactJournaledBundle).reviews[0];
  ingress.authorizeManualSupersession({ reviewId: review.reviewId, operatorConfirmed: true });
  store.state.candidates[0].stateRevision += 1;
  store.save();

  const recovery = await recoverClaimedManualSubmissions({
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    pretradeCandidates: store.snapshot().candidates,
    supersessionDecisionObserver: (proposed) => ingress.observeManualSupersessionDecision({ candidate: proposed }),
    clock: () => "2026-09-10T13:52:00.000Z",
  });
  assert.equal(recovery.results[0].result.status, "ACTION_REQUIRED");
  assert.equal(recovery.results[0].result.receipt.candidateOutcomes[0].status, "SUPERSESSION_INVALIDATED");
  assert.notEqual(recovery.results[0].result.receiptPath, initial.receiptPath);
  assert.equal((await fs.readdir(candidateInbox)).length, 0);
  assert.equal(store.snapshot().candidates.length, 1);
  assert.equal(store.snapshot().candidates[0].lifecycleState, "WAITING");
});

test("receipt currentness follows durable journal sequence across deliberately shuffled filenames", async () => {
  const { root, manualInbox, candidateInbox } = await tempDirs();
  const directories = manualIngestionDirectories(manualInbox);
  await fs.mkdir(directories.receipts, { recursive: true });
  for (const [submissionId, actionName, successName] of [
    ["history-action-first", "aaa-old-action.receipt.json", "zzz-new-success.receipt.json"],
    ["history-success-first", "zzz-old-action.receipt.json", "aaa-new-success.receipt.json"],
  ]) {
    const contentHash = `${submissionId}-content`;
    const submissionDirectory = path.join(directories.journal, submissionId);
    const eventDirectory = path.join(submissionDirectory, "events");
    await fs.mkdir(eventDirectory, { recursive: true });
    await fs.writeFile(path.join(submissionDirectory, "claim.json"), JSON.stringify({
      submissionId,
      contentHash,
      claimedAt: "2026-09-10T13:00:00.000Z",
    }));
    const actionPath = path.join(directories.receipts, actionName);
    const successPath = path.join(directories.receipts, successName);
    await fs.writeFile(actionPath, JSON.stringify({
      receiptSchemaVersion: 1,
      submissionId,
      submissionContentHash: contentHash,
      overallOutcome: "ACTION_REQUIRED",
      publication: null,
    }));
    await fs.writeFile(successPath, JSON.stringify({
      receiptSchemaVersion: 1,
      submissionId,
      submissionContentHash: contentHash,
      overallOutcome: "SUCCESS",
      publication: null,
    }));
    await fs.writeFile(path.join(eventDirectory, "000001-RECEIPT_WRITTEN-old-action.json"), JSON.stringify({
      sequence: 1,
      eventId: "old-action",
      eventType: "RECEIPT_WRITTEN",
      receiptPath: actionPath,
      overallOutcome: "ACTION_REQUIRED",
    }));
    await fs.writeFile(path.join(eventDirectory, "000002-RECEIPT_WRITTEN-new-success.json"), JSON.stringify({
      sequence: 2,
      eventId: "new-success",
      eventType: "RECEIPT_WRITTEN",
      receiptPath: successPath,
      overallOutcome: "SUCCESS",
    }));
    const reconciled = await reconcileManualSubmission({
      directories,
      submissionId,
      contentHash,
      candidateInboxPath: candidateInbox,
      pretradeCandidates: [],
    });
    assert.equal(reconciled.result.status, "SUCCESS");
    assert.equal(reconciled.result.receiptPath, successPath);
  }
  assert.equal(root.startsWith(os.tmpdir()), true);
});

test("legacy receipt history without complete journal ordering evidence fails closed", async () => {
  const { manualInbox, candidateInbox } = await tempDirs();
  const directories = manualIngestionDirectories(manualInbox);
  const submissionId = "legacy-receipt-ordering-corrupt";
  const contentHash = "legacy-receipt-ordering-content";
  const submissionDirectory = path.join(directories.journal, submissionId);
  const eventDirectory = path.join(submissionDirectory, "events");
  const receiptPath = path.join(directories.receipts, "unlinked-legacy.receipt.json");
  await fs.mkdir(eventDirectory, { recursive: true });
  await fs.mkdir(directories.receipts, { recursive: true });
  await fs.writeFile(path.join(submissionDirectory, "claim.json"), JSON.stringify({
    submissionId,
    contentHash,
    claimedAt: "2026-09-10T13:00:00.000Z",
  }));
  await fs.writeFile(receiptPath, JSON.stringify({
    receiptSchemaVersion: 1,
    submissionId,
    submissionContentHash: contentHash,
    overallOutcome: "ACTION_REQUIRED",
  }));

  await assert.rejects(
    reconcileManualSubmission({
      directories,
      submissionId,
      contentHash,
      candidateInboxPath: candidateInbox,
      pretradeCandidates: [],
    }),
    (error) => error.code === "MANUAL_RECEIPT_ORDERING_CORRUPT",
  );

  await fs.rm(receiptPath);
  await fs.writeFile(path.join(eventDirectory, "000001-RECEIPT_WRITTEN-missing-legacy.json"), JSON.stringify({
    sequence: 1,
    eventId: "missing-legacy",
    eventType: "RECEIPT_WRITTEN",
    receiptPath,
    overallOutcome: "ACTION_REQUIRED",
  }));
  await assert.rejects(
    reconcileManualSubmission({
      directories,
      submissionId,
      contentHash,
      candidateInboxPath: candidateInbox,
      pretradeCandidates: [],
    }),
    (error) => error.code === "MANUAL_RECEIPT_ORDERING_CORRUPT",
  );
});

test("S legacy bare candidate conversion is not implicit in the manual inbox", () => {
  const legacy = candidate();
  assert.notEqual(legacy.ingestionSchemaVersion, 1);
  assert.match(validateManualIngestionEnvelope(legacy).join(" "), /envelope|ingestionSchemaVersion|submission/);
});
