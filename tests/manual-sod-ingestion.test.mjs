import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
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
  validateManualIngestionEnvelope,
  validateRawManualJson,
  acquireSubmissionJournalLock,
  manualIngestionDirectories,
} from "../schwab-bridge/manual-sod-ingestion.mjs";
import { validateCandidateBundle } from "../schwab-bridge/candidate-feeder.mjs";
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
    candidates: [candidate({ contractVersion: 2, selectedQuantity: 10, forceImport: true })],
  }));
  assert.match(errors.join(" "), /contractVersion/);
  assert.match(errors.join(" "), /selectedQuantity/);
  assert.match(errors.join(" "), /forceImport/);
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
  const filePath = path.join(manualInbox, "manual.json");
  await fs.writeFile(filePath, `${JSON.stringify(envelope(), null, 2)}\n`);

  const result = await processManualProposalFile(filePath, {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: [],
    clock: () => "2026-09-10T13:05:00.000Z",
    idFactory: () => "publication-1",
    stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
  });
  assert.equal(result.status, "SUCCESS");
  assert.ok(result.publication.finalPath.startsWith(candidateInbox));
  assert.ok(fsSync.existsSync(result.receiptPath));

  const claim = JSON.parse(await fs.readFile(path.join(root, "manual-ingestion-journal", "manual-submission-001", "claim.json"), "utf8"));
  assert.equal(claim.submissionId, "manual-submission-001");
  const journalEntries = await fs.readdir(path.join(root, "manual-ingestion-journal", "manual-submission-001", "events"));
  assert.ok(journalEntries.some((name) => name.includes("RECEIVED")));
  assert.ok(journalEntries.some((name) => name.includes("PUBLISHED")));

  const replayPath = path.join(manualInbox, "manual-replay.json");
  await fs.writeFile(replayPath, `${JSON.stringify(envelope(), null, 2)}\n`);
  const replay = await processManualProposalFile(replayPath, {
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    priorCandidates: [],
    clock: () => "2026-09-10T13:06:00.000Z",
    idFactory: () => "publication-2",
    stableFileOptions: { initialDelayMs: 0, intervalMs: 0, stableChecks: 1, maxChecks: 2, parseAttempts: 1 },
  });
  assert.equal(replay.replay, true);
  assert.equal(replay.status, "SUCCESS");
  assert.equal(replay.receiptPath, result.receiptPath);
  assert.ok(fsSync.existsSync(replay.movedTo));
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
  const auth = {
    authorizationId: "manual-auth-1",
    candidateId: proposed.candidateId,
    priorContractVersion: 1,
    priorLifecycleState: "WAITING",
    priorStateRevision: 0,
    priorContentHash: prior.contentHash,
    proposedContractVersion: 2,
    proposedContentHash: candidateContractHash(proposed),
    decision: "AUTHORIZED",
  };
  const accepted = ingress.importBundle(revised.canonicalBundle, {
    ingressPolicy: MANUAL_AUTHORIZED,
    manualSupersessionAuthorizations: [auth],
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
    manualSupersessionAuthorizations: [auth],
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
  assert.equal(drained.results.filter((item) => item.status === "SUCCESS").length, 1);
  assert.equal(drained.results.filter((item) => item.status === "FAILED").length, 1);
  assert.ok(fsSync.existsSync(path.join(unrelated, "ignored.json")));
  assert.ok((await fs.readdir(path.join(root, "manual-ingestion-archive"))).some((name) => name === "valid.json"));
  assert.ok((await fs.readdir(path.join(root, "manual-ingestion-quarantine"))).some((name) => name === "bad.json"));
});

test("R ACTION_REQUIRED and PARTIAL_SUCCESS are valid submissions archived rather than quarantined", async () => {
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
  assert.equal(partial.status, "PARTIAL_SUCCESS");
  const archived = await fs.readdir(path.join(root, "manual-ingestion-archive"));
  assert.ok(archived.includes("action.json"));
  assert.ok(archived.includes("partial.json"));

  await fs.rm(partial.receiptPath);
  const recoveredPartial = await recoverClaimedManualSubmissions({
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    clock: () => "2026-09-10T13:12:30.000Z",
  });
  const partialRecovery = recoveredPartial.results.find((item) => item.submissionId === "partial-success");
  assert.equal(partialRecovery.status, "RECOVERED");
  assert.equal(partialRecovery.result.status, "PARTIAL_SUCCESS");
  assert.equal(partialRecovery.result.receipt.overallOutcome, "PARTIAL_SUCCESS");
});

test("P recovery reconciles publication or PRETRADE evidence after source leaves hot inbox", async () => {
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
  assert.equal(first.status, "SUCCESS");
  const recovered = await recoverClaimedManualSubmissions({
    manualInboxPath: manualInbox,
    candidateInboxPath: candidateInbox,
    pretradeCandidates: first.receipt.publication ? [] : [],
    clock: () => "2026-09-10T13:14:00.000Z",
  });
  assert.equal(recovered.results[0].status, "RECOVERED");
});

test("S legacy bare candidate conversion is not implicit in the manual inbox", () => {
  const legacy = candidate();
  assert.notEqual(legacy.ingestionSchemaVersion, 1);
  assert.match(validateManualIngestionEnvelope(legacy).join(" "), /envelope|ingestionSchemaVersion|submission/);
});
