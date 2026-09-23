import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { contentHash, pretradePreviewReceiptHash, PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { AUTOMATED_UNTOUCHED_ONLY, PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradePreviewAuthority } from "../schwab-bridge/pretrade-preview-authority.mjs";
import { CURRENT_LIVE_QUOTE_EVIDENCE_POLICY } from "../schwab-bridge/clock-freshness.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";
const PREVIEW_POLICY = Object.freeze({
  policyId: "TEST_ONLY",
  policyVersion: 1,
  profileVersion: 1,
  schemaVersion: 1,
  quoteEvidencePolicy: CURRENT_LIVE_QUOTE_EVIDENCE_POLICY,
  accountMaxAgeMs: 15_000,
});

function finalEvidence(preview, observedAt, overrides = {}) {
  return {
    valid: true,
    accountScope: preview.accountScope,
    policyHash: contentHash(preview.policy),
    bindingHash: preview.bindingHash,
    proposalHash: preview.proposalHash,
    fixedProposalReferencesHash: contentHash(preview.fixedProposalReferences),
    quoteEvidence: { quoteTime: observedAt, receivedAt: observedAt, realtime: true },
    accountEvidence: { accountScope: preview.accountScope, revision: "account-revision-1", observedAt },
    ownershipEvidence: { healthy: true, storeRevision: 7, storeHash: "a".repeat(64) },
    fixedPredicates: {
      valid: true,
      proposalHash: preview.proposalHash,
      fixedProposalReferencesHash: contentHash(preview.fixedProposalReferences),
    },
    evidenceId: "evidence-1",
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    candidateId: "live-2026-09-21-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-21",
    generatedAt: "2026-09-21T15:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "H2 trend continuation",
    timeframe: "2m",
    thesis: "Second-entry continuation after pullback",
    trigger: { type: "MANUAL_CONFIRMATION", prompt: "Confirm H2 signal bar" },
    structuralInvalidation: {
      price: 176.5,
      rule: "break below pullback low",
      referenceType: "PULLBACK_LOW",
      reason: "long thesis invalid below pullback structure",
    },
    plannedEntryReference: 177.25,
    targets: [178.5, 180],
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-21T15:00:00.000Z",
      validUntil: "2026-09-21T21:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
      provenance: { source: "LIVE_REVIEW", label: "operator-reviewed contract window" },
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function bundle(overrides = {}) {
  return { source: SOURCE, bundleId: "live-run-1", candidates: [candidate()], ...overrides };
}

function harness({ filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pretrade-preview-")), "state.json"), failpoint = null, evidenceProvider = null } = {}) {
  let tick = 0;
  let id = 0;
  const clock = () => new Date(Date.parse("2026-09-21T15:00:00.000Z") + tick++ * 100).toISOString();
  const store = new PreTradeStore({ filePath, clock, failpoint });
  store.acquireWriterLock();
  store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock, idFactory: () => `ingress-${++id}` });
  const rawEvidenceProvider = evidenceProvider || (async () => ({}));
  const authority = new PreTradePreviewAuthority({
    store,
    candidateIngress: ingress,
    enabled: true,
    allowLegacyTestPolicy: true,
    policy: PREVIEW_POLICY,
    evidenceProvider: async (context) => {
      const overrides = await rawEvidenceProvider(context);
      return finalEvidence(context.preview, clock(), overrides);
    },
    evidenceValidator: ({ evidence }) => ({
      valid: evidence.ownershipEvidence.storeRevision === 7
        && evidence.accountEvidence.revision === "account-revision-1",
      reasonCode: "FINAL_AUTHORITY_VERSION_CHANGED",
    }),
    clock,
    idFactory: () => `preview-id-${++id}`,
  });
  return { authority, store, ingress, filePath, clock };
}

function create(authority, overrides = {}) {
  return authority.create({
    bundle: bundle(),
    ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
    draftId: "draft-1",
    inputRevision: 1,
    runId: "run-1",
    accountScope: "account-hash-1",
    chartByteHashes: ["chart-hash-1"],
    provenance: { channel: "TEST_TRUSTED_INTERNAL" },
    sourceTimes: { chartCapturedAt: "2026-09-21T14:59:55.000Z" },
    evidenceIds: ["research-evidence-1"],
    fixedProposalReferences: { structuralReference: "pullback-low-1" },
    ...overrides,
  });
}

test("preview preflight persists metadata without writing authoritative candidate state", () => {
  const { authority, store } = harness();
  const before = store.snapshot();
  const preview = create(authority);
  const after = store.snapshot();
  assert.equal(preview.state, "PREVIEW_READY");
  assert.deepEqual(after.candidates, before.candidates);
  assert.deepEqual(after.importLog, before.importLog);
  assert.deepEqual(after.dssEvaluations, before.dssEvaluations);
  assert.equal(after.pretradePreviews.length, 1);
  assert.equal(after.pretradePreviewOperations.length, 1);
  assert.equal(after.pretradePreviewReceipts.length, 0);
  assert.equal(preview.proposal.symbol, "NVDA");
  assert.equal(preview.proposal.trigger.prompt, "Confirm H2 signal bar");
  assert.equal(after.pretradePreviews[0].bindingHash.length, 64);
  assert.equal(authority.readiness().chartCardAgeThresholdConfigured, false);
  assert.equal(authority.readiness().writerLockHeld, true);
  assert.equal(authority.readiness().filesystemDurabilityValidated, true);
});

test("one proposal cannot allocate a second unresolved acceptance operation", () => {
  const { authority, store } = harness();
  const first = create(authority);
  assert.throws(
    () => authority.create({
      bundle: bundle(),
      ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
      draftId: "draft-2",
      inputRevision: 2,
      runId: "run-2",
      accountScope: "account-hash-1",
    }),
    (error) => (
      error.code === "PREVIEW_PROPOSAL_UNRESOLVED"
      && error.details.previewId === first.previewId
      && error.details.operationId === first.operationId
    ),
  );
  assert.equal(store.snapshot().pretradePreviewOperations.length, 1);
});

test("discard commits before acceptance and proves that nothing was imported", async () => {
  const { authority, store } = harness();
  const preview = create(authority);
  assert.deepEqual(authority.discard({ previewId: preview.previewId, operationId: preview.operationId }), {
    status: "DISCARDED",
    previewId: preview.previewId,
  });
  await assert.rejects(
    authority.accept({ previewId: preview.previewId, operationId: preview.operationId, proposalHash: store.snapshot().pretradePreviews[0].proposalHash, accountScope: "account-hash-1" }),
    (error) => error.code === "PREVIEW_DISCARDED",
  );
  assert.equal(store.snapshot().candidates.length, 0);
});

test("accept atomically admits once and retries return the immutable receipt", async () => {
  const { authority, store } = harness();
  const preview = create(authority);
  const proposalHash = store.snapshot().pretradePreviews[0].proposalHash;
  const receipt = await authority.accept({
    previewId: preview.previewId,
    operationId: preview.operationId,
    proposalHash,
    accountScope: "account-hash-1",
  });
  assert.equal(receipt.result, "ADMITTED");
  assert.equal(store.snapshot().candidates.length, 1);
  assert.equal(store.snapshot().importLog.length, 1);
  assert.ok(receipt.canonicalAdmission.operationId);
  assert.ok(receipt.canonicalAdmission.eventId);
  assert.equal(Object.prototype.hasOwnProperty.call(receipt, "evidence"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(receipt, "receiptHash"), false);
  assert.equal(store.snapshot().pretradePreviewReceipts[0].receiptHash.length, 64);
  const admitted = store.snapshot().candidates[0];
  assert.equal(admitted.lifecycleJournal.operations[0].operationId, receipt.canonicalAdmission.operationId);
  assert.equal(admitted.lifecycleJournal.events[0].eventId, receipt.canonicalAdmission.eventId);
  const replay = await authority.accept({
    previewId: preview.previewId,
    operationId: preview.operationId,
    proposalHash,
    accountScope: "account-hash-1",
  });
  assert.deepEqual(replay, receipt);
  assert.ok(receipt.commitTransactionId);
  await assert.rejects(
    authority.accept({
      previewId: preview.previewId,
      operationId: preview.operationId,
      proposalHash: "different-proposal",
      accountScope: "account-hash-1",
    }),
    (error) => error.code === "PREVIEW_ACCEPT_CONFLICT",
  );
  assert.equal(store.snapshot().candidates.length, 1);
  assert.equal(authority.discard({ previewId: preview.previewId, operationId: preview.operationId }).status, "RECEIPT_COMMITTED");
});

test("evidence failure commits a replayable NOT_ADMITTED receipt with transaction identity", async () => {
  const h = harness({ evidenceProvider: async () => { throw new Error("provider unavailable"); } });
  const preview = create(h.authority);
  const receipt = await h.authority.accept({
    previewId: preview.previewId,
    operationId: preview.operationId,
    proposalHash: h.store.snapshot().pretradePreviews[0].proposalHash,
    accountScope: "account-hash-1",
  });
  assert.equal(receipt.result, "NOT_ADMITTED");
  assert.equal(receipt.reason, "EVIDENCE_UNAVAILABLE");
  assert.ok(receipt.commitTransactionId);
  assert.equal(h.store.snapshot().transactionId, receipt.commitTransactionId);
  assert.equal(h.store.snapshot().candidates.length, 0);
});

test("ordinary ingress cannot bypass an unresolved preview acceptance", () => {
  const h = harness();
  const preview = create(h.authority);
  assert.throws(
    () => h.ingress.importBundle(bundle(), { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY }),
    (error) => error.code === "PREVIEW_ACCEPTANCE_REQUIRED",
  );
  assert.equal(h.store.snapshot().candidates.length, 0);
  assert.equal(h.authority.status(preview.previewId).operation.state, "UNSTARTED");
  assert.throws(
    () => h.store.importBundle(bundle()),
    (error) => error.code === "PREVIEW_ACCEPTANCE_REQUIRED",
  );
});

test("altered content under a registered candidate identity is an explicit conflict", () => {
  const h = harness();
  create(h.authority);
  assert.throws(
    () => h.ingress.importBundle(
      bundle({ candidates: [candidate({ thesis: "changed after preview" })] }),
      { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY },
    ),
    (error) => error.code === "PREVIEW_REGISTERED_IDENTITY_CONFLICT",
  );
  assert.equal(h.store.snapshot().candidates.length, 0);
});

test("simultaneous accepts launch one evidence worker and share the original operation", async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const h = harness({ evidenceProvider: async () => { calls += 1; await pending; return {}; } });
  const preview = create(h.authority);
  const intent = {
    previewId: preview.previewId,
    operationId: preview.operationId,
    proposalHash: preview.proposalHash,
    accountScope: preview.accountScope,
  };
  const first = h.authority.accept(intent);
  await new Promise((resolve) => setImmediate(resolve));
  const duplicate = await h.authority.accept(intent);
  assert.equal(duplicate.operation.operationId, preview.operationId);
  assert.equal(duplicate.operation.state, "ACCEPTING");
  assert.equal(calls, 1);
  release();
  assert.equal((await first).result, "ADMITTED");
  assert.equal(h.store.snapshot().candidates.length, 1);
});

test("final acceptance rejects stale or rebound authority evidence", async (t) => {
  const cases = [
    ["quote receipt", { quoteEvidence: { quoteTime: "2026-09-21T14:59:50.000Z", receivedAt: "2026-09-21T14:59:50.000Z", realtime: true } }, "STALE_OR_INVALID_QUOTE_SOURCE"],
    ["account snapshot", { accountEvidence: { accountScope: "account-hash-1", revision: "account-revision-1", observedAt: "2026-09-21T14:59:40.000Z" } }, "FINAL_ACCOUNT_EVIDENCE_INVALID"],
    ["policy binding", { policyHash: "different-policy" }, "FINAL_EVIDENCE_BINDING_MISMATCH"],
    ["ownership revision", { ownershipEvidence: { healthy: true, storeRevision: 8, storeHash: "a".repeat(64) } }, "FINAL_AUTHORITY_VERSION_CHANGED"],
  ];
  for (const [label, overrides, expectedReason] of cases) {
    await t.test(label, async () => {
      const h = harness({ evidenceProvider: async () => overrides });
      const preview = create(h.authority);
      const receipt = await h.authority.accept({
        previewId: preview.previewId,
        operationId: preview.operationId,
        proposalHash: preview.proposalHash,
        accountScope: preview.accountScope,
      });
      assert.equal(receipt.result, "NOT_ADMITTED");
      assert.equal(receipt.reason, expectedReason);
      assert.equal(h.store.snapshot().candidates.length, 0);
    });
  }
});

test("an exact candidate admitted before preview creation yields ALREADY_PRESENT with current lifecycle", async () => {
  const h = harness();
  h.ingress.importBundle(bundle(), { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY });
  h.store.state.candidates[0].lifecycleState = "ARMED";
  h.store.state.candidates[0].stateRevision = 1;
  h.store.save();
  const preview = create(h.authority);
  const record = h.store.snapshot().pretradePreviews[0];
  const receipt = await h.authority.accept({
    previewId: preview.previewId,
    operationId: preview.operationId,
    proposalHash: record.proposalHash,
    accountScope: "account-hash-1",
  });
  assert.equal(receipt.result, "ALREADY_PRESENT");
  assert.equal(h.authority.status(preview.previewId).lifecycle.lifecycleState, "ARMED");
  assert.equal(h.store.snapshot().candidates.length, 1);
});

test("recovery rejects valid cross-candidate receipt substitution for admitted and existing candidates", async t => {
  for (const expectedResult of ["ADMITTED", "ALREADY_PRESENT"]) {
    await t.test(expectedResult, async t => {
      const h = harness();
      t.after(() => h.store.close());
      const secondBundle = bundle({
        bundleId: "live-run-2",
        candidates: [candidate({
          candidateId: "live-2026-09-21-MSFT-1",
          symbol: "MSFT",
          thesis: "Independent second candidate",
        })],
      });
      if (expectedResult === "ALREADY_PRESENT") {
        h.ingress.importBundle(bundle(), { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY });
        h.ingress.importBundle(secondBundle, { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY });
      }

      const previewA = create(h.authority);
      const receiptA = await h.authority.accept(previewA);
      const previewB = create(h.authority, {
        bundle: secondBundle,
        draftId: "draft-2",
        runId: "run-2",
      });
      const receiptB = await h.authority.accept(previewB);
      assert.equal(receiptA.result, expectedResult);
      assert.equal(receiptB.result, expectedResult);
      h.store.close();

      const raw = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
      raw.pretradePreviewReceipts[0].candidate = structuredClone(raw.pretradePreviewReceipts[1].candidate);
      raw.pretradePreviewReceipts[0].canonicalAdmission = structuredClone(raw.pretradePreviewReceipts[1].canonicalAdmission);
      raw.pretradePreviewReceipts[0].receiptHash = pretradePreviewReceiptHash(raw.pretradePreviewReceipts[0]);
      fs.writeFileSync(h.filePath, `${JSON.stringify(raw, null, 2)}\n`);

      const restored = new PreTradeStore({ filePath: h.filePath });
      restored.acquireWriterLock();
      t.after(() => restored.close());
      assert.throws(() => restored.load(), { code: "CORRUPT_PRETRADE_PREVIEW_STATE" });
      assert.equal(restored.fenced, true);
      h.authority.store = restored;
      assert.throws(() => h.authority.status(previewA.previewId), { code: "PRETRADE_RECOVERY_REQUIRED" });
      assert.throws(() => restored.save(), { code: "PRETRADE_WRITER_FENCED" });
    });
  }
});

test("restart converts unresolved acceptance into INTERRUPTED without importing", async () => {
  let releaseEvidence;
  const pendingEvidence = new Promise((resolve) => { releaseEvidence = resolve; });
  const h = harness({ evidenceProvider: () => pendingEvidence });
  const preview = create(h.authority);
  const record = h.store.snapshot().pretradePreviews[0];
  const acceptance = h.authority.accept({
    previewId: preview.previewId,
    operationId: preview.operationId,
    proposalHash: record.proposalHash,
    accountScope: "account-hash-1",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.authority.status(preview.previewId).operation.state, "ACCEPTING");

  const ingress = new PreTradeCandidateIngress({ store: h.store, clock: h.clock });
  const restarted = new PreTradePreviewAuthority({
    allowLegacyTestPolicy: true,
    store: h.store,
    candidateIngress: ingress,
    enabled: true,
    policy: PREVIEW_POLICY,
    evidenceProvider: async ({ preview: current }) => finalEvidence(current, h.clock()),
    evidenceValidator: ({ evidence }) => ({ valid: evidence.ownershipEvidence.storeRevision === 7 }),
    clock: h.clock,
  });
  const recovered = restarted.recoverAfterRestart();
  assert.equal(recovered[0].result, "NOT_ADMITTED");
  assert.equal(recovered[0].reason, "INTERRUPTED");
  assert.ok(recovered[0].commitTransactionId);
  releaseEvidence({ valid: true, accountScope: "account-hash-1" });
  const lateWorkerResult = await acceptance;
  assert.equal(lateWorkerResult.result, "NOT_ADMITTED");
  assert.equal(lateWorkerResult.reason, "INTERRUPTED");
  assert.equal(h.store.snapshot().candidates.length, 0);
});

test("evidence refresh creates a new immutable revision without renewing source times or fixed expiry", async () => {
  const h = harness({ evidenceProvider: async ({ preview: current }) => ({
    valid: true,
    accountScope: current.accountScope,
    evidenceId: "refreshed-evidence-2",
  }) });
  const original = h.authority.create({
    bundle: bundle(),
    ingressPolicy: AUTOMATED_UNTOUCHED_ONLY,
    draftId: "draft-1",
    inputRevision: 1,
    runId: "run-1",
    accountScope: "account-hash-1",
    sourceTimes: { chartCapturedAt: "2026-09-21T14:59:55.000Z" },
    evidenceIds: ["research-evidence-1"],
    fixedProposalReferences: { structuralReference: "pullback-low-1" },
    expiresAt: "2026-09-21T15:10:00.000Z",
  });
  const replacement = await h.authority.refresh({ previewId: original.previewId, operationId: original.operationId });
  assert.notEqual(replacement.previewId, original.previewId);
  assert.notEqual(replacement.operationId, original.operationId);
  assert.equal(replacement.revision, 2);
  assert.equal(replacement.expiresAt, original.expiresAt);
  const state = h.store.snapshot();
  const prior = state.pretradePreviews.find((item) => item.previewId === original.previewId);
  const next = state.pretradePreviews.find((item) => item.previewId === replacement.previewId);
  assert.equal(prior.state, "RETIRED");
  assert.deepEqual(next.sourceTimes, prior.sourceTimes);
  assert.deepEqual(next.fixedProposalReferences, prior.fixedProposalReferences);
  assert.deepEqual(next.evidenceIds, ["research-evidence-1", "refreshed-evidence-2"]);
  await assert.rejects(
    h.authority.accept({
      previewId: original.previewId,
      operationId: original.operationId,
      proposalHash: original.proposalHash,
      accountScope: original.accountScope,
    }),
    (error) => error.code === "PREVIEW_REVALIDATION_REQUIRED" || error.code === "PREVIEW_ACCEPT_CONFLICT",
  );
});

test("post-replacement failures fence writers and restart recovers the committed receipt", async (t) => {
  for (const point of ["AFTER_RENAME", "AFTER_DIRECTORY_FLUSH"]) {
    await t.test(point, async () => {
      let failCommit = false;
      const h = harness({
        failpoint: (name) => {
          if (failCommit && name === point) throw new Error("simulated durability acknowledgement loss");
        },
        evidenceProvider: async ({ preview: current }) => {
          failCommit = true;
          return { valid: true, accountScope: current.accountScope, evidenceId: "evidence-final" };
        },
      });
      const preview = create(h.authority);
      const proposalHash = h.store.snapshot().pretradePreviews[0].proposalHash;
      await assert.rejects(
        h.authority.accept({ previewId: preview.previewId, operationId: preview.operationId, proposalHash, accountScope: "account-hash-1" }),
        (error) => error.code === "OUTCOME_UNKNOWN",
      );
      assert.equal(h.store.fenced, true);

      h.store.close();
      const recoveredStore = new PreTradeStore({ filePath: h.filePath, clock: h.clock });
      recoveredStore.acquireWriterLock();
      recoveredStore.load();
      const receipt = recoveredStore.snapshot().pretradePreviewReceipts[0];
      assert.equal(receipt.result, "ADMITTED");
      assert.equal(recoveredStore.snapshot().candidates.length, 1);
      recoveredStore.close();
    });
  }
});

test("writer lock rejects a second process owner and never reclaims by age", () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pretrade-lock-")), "state.json");
  const first = new PreTradeStore({ filePath });
  const second = new PreTradeStore({ filePath });
  first.acquireWriterLock();
  assert.throws(() => second.acquireWriterLock(), (error) => error.code === "PRETRADE_WRITER_LOCKED");
  first.close();
  assert.doesNotThrow(() => second.acquireWriterLock());
  second.close();
});

test("all pre-replacement failures leave prior authoritative state writable and unchanged", async (t) => {
  for (const point of ["BEFORE_TEMP_WRITE", "AFTER_FILE_FLUSH", "BEFORE_RENAME"]) {
    await t.test(point, () => {
      let fail = false;
      const h = harness({ failpoint: (name) => {
        if (fail && name === point) throw new Error("simulated before replacement");
      } });
      create(h.authority);
      const before = fs.readFileSync(h.filePath, "utf8");
      fail = true;
      assert.throws(() => h.store.transaction((draft) => { draft.updatedAt = "2026-09-21T15:01:00.000Z"; }));
      assert.equal(h.store.fenced, false);
      assert.equal(fs.readFileSync(h.filePath, "utf8"), before);
      h.store.close();
    });
  }
});

test("nested and async transactions are rejected without committing either draft", () => {
  const h = harness();
  const before = h.store.snapshot();
  assert.throws(
    () => h.store.transaction((outer) => {
      outer.updatedAt = "2026-09-21T15:01:00.000Z";
      h.store.transaction((inner) => { inner.updatedAt = "2026-09-21T15:02:00.000Z"; });
    }),
    (error) => error.code === "PRETRADE_TRANSACTION_REENTRANT",
  );
  assert.deepEqual(h.store.snapshot(), before);
  assert.throws(
    () => h.store.transaction(async (draft) => { draft.updatedAt = "2026-09-21T15:03:00.000Z"; }),
    (error) => error.code === "ASYNC_PRETRADE_TRANSACTION_FORBIDDEN",
  );
  assert.deepEqual(h.store.snapshot(), before);
});

test("read-only transaction outcomes do not create a new store revision", () => {
  const h = harness();
  const before = h.store.snapshot();
  const result = h.store.transaction(() => ({ status: "UNCHANGED" }));
  assert.deepEqual(result, { status: "UNCHANGED" });
  assert.deepEqual(h.store.snapshot(), before);
  assert.equal(fs.existsSync(h.filePath), false);
});

test("missing initialized state and malformed preview roots fail closed on recovery", () => {
  const h = harness();
  create(h.authority);
  const persisted = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
  persisted.pretradePreviews[0].bundle.candidates[0].setup = "tampered after persistence";
  fs.writeFileSync(h.filePath, `${JSON.stringify(persisted)}\n`);
  assert.throws(
    () => new PreTradeStore({ filePath: h.filePath }).load(),
    (error) => error.code === "CORRUPT_PRETRADE_PREVIEW_STATE",
  );
  fs.unlinkSync(h.filePath);
  assert.throws(
    () => new PreTradeStore({ filePath: h.filePath }).load(),
    (error) => error.code === "PRETRADE_RECOVERY_REQUIRED",
  );
});

test("terminal receipt evidence and candidate bindings are tamper evident on reload", async () => {
  const h = harness();
  const preview = create(h.authority);
  await h.authority.accept({
    previewId: preview.previewId,
    operationId: preview.operationId,
    proposalHash: preview.proposalHash,
    accountScope: preview.accountScope,
  });
  h.store.close();
  const persisted = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
  persisted.pretradePreviewReceipts[0].evidence.evidenceId = "tampered-evidence";
  fs.writeFileSync(h.filePath, `${JSON.stringify(persisted)}\n`);
  const reloaded = new PreTradeStore({ filePath: h.filePath });
  reloaded.acquireWriterLock();
  assert.throws(
    () => reloaded.load(),
    (error) => error.code === "CORRUPT_PRETRADE_PREVIEW_STATE",
  );
  reloaded.close();
});

test("discarded operation state cannot be rewritten into an eligible preview on disk", () => {
  const h = harness();
  const preview = create(h.authority);
  h.authority.discard({ previewId: preview.previewId, operationId: preview.operationId });
  h.store.close();
  const persisted = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
  persisted.pretradePreviews[0].state = "PREVIEW_READY";
  persisted.pretradePreviewOperations[0].state = "UNSTARTED";
  fs.writeFileSync(h.filePath, `${JSON.stringify(persisted)}\n`);
  const reloaded = new PreTradeStore({ filePath: h.filePath });
  reloaded.acquireWriterLock();
  assert.throws(
    () => reloaded.load(),
    (error) => error.code === "CORRUPT_PRETRADE_PREVIEW_STATE",
  );
  reloaded.close();
});

test("terminal registered identities cannot bypass canonical or legacy ingress", async () => {
  for (const disposition of ["discard", "reject", "admit"]) {
    const h = harness({ evidenceProvider: async () => disposition === "reject" ? { valid: false } : {} });
    const preview = create(h.authority);
    if (disposition === "discard") h.authority.discard(preview);
    else await h.authority.accept(preview);
    const before = h.store.snapshot();
    assert.throws(() => h.ingress.importBundle(bundle(), { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY }), { code: "PREVIEW_ACCEPTANCE_REQUIRED" });
    assert.throws(() => h.store.importBundle(bundle()), { code: "PREVIEW_ACCEPTANCE_REQUIRED" });
    assert.deepEqual(h.store.snapshot(), before);
    // An explicit internal new review is possible; replay authorization belongs
    // to the still-unimplemented authenticated service handoff.
    const reviewed = create(h.authority);
    assert.notEqual(reviewed.operationId, preview.operationId);
    h.store.close();
  }
});

test("refresh rejects evidence that ages out during the asynchronous fetch", async () => {
  const h = harness();
  let now = "2026-09-21T15:00:02.000Z";
  h.authority.clock = () => now;
  const preview = create(h.authority);
  h.authority.evidenceProvider = async ({ preview }) => {
    const evidence = finalEvidence(preview, now);
    now = "2026-09-21T15:00:08.001Z";
    return evidence;
  };
  await assert.rejects(h.authority.refresh(preview), { code: "PREVIEW_REFRESH_EVIDENCE_INVALID" });
  assert.equal(h.authority.status(preview.previewId).operation.state, "UNSTARTED");
  assert.equal(h.store.snapshot().pretradePreviews.length, 1);
  h.store.close();
});

test("restart during refresh invalidates its continuation without retiring the preview", async () => {
  const h = harness();
  const preview = create(h.authority);
  let release;
  h.authority.evidenceProvider = ({ preview }) => new Promise(resolve => { release = () => resolve(finalEvidence(preview, h.clock())); });
  const pending = h.authority.refresh(preview);
  h.authority.recoverAfterRestart();
  release();
  await assert.rejects(pending, { code: "PREVIEW_CONTINUATION_INVALID" });
  assert.equal(h.authority.status(preview.previewId).preview.revalidationRequired, true);
  h.store.close();
});

test("disablement and policy changes during evidence fetch fail closed; terminal lookup survives disablement", async () => {
  for (const change of ["disabled", "policy", "account", "ownership"]) {
    const h = harness();
    const preview = create(h.authority);
    h.authority.evidenceProvider = async ({ preview }) => {
      const evidence = finalEvidence(preview, h.clock());
      if (change === "disabled") h.authority.enabled = false;
      if (change === "policy") h.authority.policy = { ...PREVIEW_POLICY, policyVersion: 2 };
      if (change === "account") evidence.accountEvidence.accountScope = "other-account";
      if (change === "ownership") h.authority.evidenceValidator = () => ({ valid: false, reasonCode: "OWNERSHIP_CHANGED" });
      return evidence;
    };
    const receipt = await h.authority.accept(preview);
    assert.equal(receipt.result, "NOT_ADMITTED");
    assert.equal(h.store.snapshot().candidates.length, 0);
    h.authority.enabled = false;
    assert.deepEqual(await h.authority.accept(preview), receipt);
    h.store.close();
  }
});

test("preview readiness cannot weaken the established live quote or account safeguards", () => {
  const h = harness();
  for (const policy of [
    { ...PREVIEW_POLICY, accountMaxAgeMs: 60_000 },
    { ...PREVIEW_POLICY, quoteEvidencePolicy: { ...CURRENT_LIVE_QUOTE_EVIDENCE_POLICY, requireRealtime: false } },
  ]) {
    h.authority.policy = policy;
    assert.equal(h.authority.readiness().enabled, false);
    assert.throws(() => create(h.authority), { code: "PRETRADE_PREVIEW_FEATURE_DISABLED" });
  }
  h.store.close();
});

test("missing schema-2 preview roots fence the loaded store and block later saves", () => {
  const h = harness(); create(h.authority); h.store.close();
  const original = fs.readFileSync(h.filePath, "utf8");
  for (const field of ["pretradePreviews", "pretradePreviewOperations", "pretradePreviewReceipts"]) {
    const corrupt = JSON.parse(original); delete corrupt[field];
    fs.writeFileSync(h.filePath, JSON.stringify(corrupt));
    const store = new PreTradeStore({ filePath: h.filePath });
    assert.throws(() => store.load(), { code: "CORRUPT_PRETRADE_PREVIEW_STATE" });
    assert.equal(store.fenced, true);
    assert.throws(() => store.save(), { code: "PRETRADE_WRITER_FENCED" });
  }
});

test("compatibility writers cannot bypass a live writer lock or overwrite a stale snapshot", () => {
  const h = harness(); create(h.authority);
  const second = new PreTradeStore({ filePath: h.filePath }); second.load();
  assert.throws(() => second.save(), { code: "PRETRADE_WRITER_LOCKED" });
  h.store.transaction(draft => { draft.updatedAt = "2026-09-21T15:01:00.000Z"; });
  h.store.close();
  const before = fs.readFileSync(h.filePath, "utf8");
  assert.throws(() => second.save(), { code: "PRETRADE_CONCURRENT_WRITE" });
  assert.equal(fs.readFileSync(h.filePath, "utf8"), before);
  assert.equal(second.fenced, true);
});

test("missing terminal receipt and canonical event linkage block recovery", async () => {
  const h = harness(); const preview = create(h.authority); await h.authority.accept(preview); h.store.close();
  const original = fs.readFileSync(h.filePath, "utf8");
  for (const corrupt of [
    state => { state.pretradePreviewReceipts = []; },
    state => { state.candidates[0].lifecycleJournal.events = []; },
  ]) {
    const state = JSON.parse(original); corrupt(state); fs.writeFileSync(h.filePath, JSON.stringify(state));
    const recovered = new PreTradeStore({ filePath: h.filePath });
    assert.throws(() => recovered.load()); assert.equal(recovered.fenced, true);
  }
});

test("fenced preview authority cannot project an outcome from an uncertain in-memory image", () => {
  const h = harness(); const preview = create(h.authority); h.store.fenced = true;
  assert.throws(() => h.authority.status(preview.previewId), { code: "PRETRADE_RECOVERY_REQUIRED" });
  assert.throws(() => h.authority.list(), { code: "PRETRADE_RECOVERY_REQUIRED" });
  h.store.close();
});
