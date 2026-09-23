import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { candidateContractHash } from "../schwab-bridge/pretrade-candidate-contract.mjs";
import {
  canonicalPreTradeProviderHandoffBytes,
  parsePreTradeProviderHandoff,
  PRETRADE_PROVIDER_HANDOFF_CANONICALIZATION,
  PRETRADE_PROVIDER_HANDOFF_SCHEMA,
  PRETRADE_PROVIDER_HANDOFF_SIGNATURE_ALGORITHM,
  signPreTradeProviderHandoff,
} from "../schwab-bridge/pretrade-provider-handoff.mjs";
import { OPERATOR_REVIEWED_IMPORT_POLICY } from "../schwab-bridge/pretrade-preview-policy.mjs";
import { PreTradePreviewAuthority } from "../schwab-bridge/pretrade-preview-authority.mjs";
import {
  contentHash,
  pretradeProviderMessageIntegrityHash,
  pretradeProviderRunIntegrityHash,
  pretradePreviewProposalHash,
  PreTradeStore,
} from "../schwab-bridge/pretrade-state.mjs";
import { bundle, harness } from "./helpers/pretrade-preview-fixture.mjs";

function sha(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function secondSignedEnvelope(h, run) {
  const envelope = structuredClone(h.envelope(run));
  envelope.times = {
    providerRequestStartedAt: run.issuedAt,
    providerRequestFinishedAt: run.issuedAt,
    serviceOutputReceivedAt: run.issuedAt,
    envelopeIssuedAt: run.issuedAt,
    envelopeExpiresAt: run.expiresAt,
  };
  envelope.provider.responseId = "provider-response-2";
  envelope.output.bundle.bundleId = "live-run-2";
  envelope.output.bundle.candidates[0].candidateId = "synthetic-second-candidate";
  envelope.output.candidateId = envelope.output.bundle.candidates[0].candidateId;
  envelope.output.candidateContractHash = candidateContractHash(envelope.output.bundle.candidates[0]);
  envelope.output.proposalHash = pretradePreviewProposalHash(envelope.output.bundle);
  envelope.output.normalizedOutputHash = contentHash({
    bundle: envelope.output.bundle,
    fixedProposalReferences: envelope.output.fixedProposalReferences,
  });
  return signPreTradeProviderHandoff(envelope, h.keys.privateKey);
}

function fixture(t, { resolveChart = null, deterministic = false } = {}) {
  const h = harness();
  t.after(() => h.store.close());
  if (deterministic) {
    h.store.state.storeEpoch = "11111111-1111-4111-8111-111111111111";
    h.authority.processGeneration = "22222222-2222-4222-8222-222222222222";
  }
  const keys = crypto.generateKeyPairSync("ed25519");
  const chartBytes = Buffer.from("synthetic-chart-bytes");
  const chart = {
    chartId: "chart-test-1",
    contentRef: "sod-chart:test-1",
    mediaType: "image/png",
    byteLength: chartBytes.length,
    sha256: sha(chartBytes),
    ingestedAt: "2026-09-21T14:59:59.000Z",
    bytes: chartBytes,
  };
  const config = {
    installationId: "pretrade-installation-test",
    issuers: {
      "sod-service-test": {
        serviceId: "sod-analysis-service",
        keys: { "key-1": keys.publicKey },
        modelIds: ["gpt-test"],
        reasoningEfforts: ["high"],
      },
    },
    resolveChart: resolveChart || (async () => ({ ...chart, bytes: Buffer.from(chart.bytes) })),
    accountSelectionResolver: () => ({
      accountScopeId: "account-hash-1",
      revision: "account-selection-1",
      healthy: true,
    }),
    profileHash: sha("operator-reviewed-profile-v1"),
    prompt: { version: "prompt-v1", hash: sha("prompt-v1") },
    outputSchema: { version: 1, hash: sha("output-schema-v1") },
    challengeTtlMs: 60_000,
    maxClockSkewMs: 5_000,
    ...(deterministic ? {
      challengeIdFactory: () => "33333333-3333-4333-8333-333333333333",
      nonceFactory: () => Buffer.alloc(32, 7).toString("base64url"),
    } : {}),
  };
  h.authority.allowLegacyTestPolicy = false;
  h.authority.policy = OPERATOR_REVIEWED_IMPORT_POLICY;
  h.authority.providerHandoff = config;
  h.authority.requireAuthenticatedRegistration = true;
  const collectEvidence = h.authority.evidenceProvider;
  h.authority.evidenceProvider = async context => {
    const evidence = await collectEvidence(context);
    delete evidence.fixedPredicates;
    return evidence;
  };

  function challenge(overrides = {}) {
    return h.authority.issueProviderChallenge({
      draftId: "draft-1",
      inputRevision: 1,
      runId: "run-1",
      inputManifestHash: sha("input-manifest-1"),
      retirementRevision: 0,
      accountScopeId: "account-hash-1",
      accountSelectionRevision: "account-selection-1",
      ...overrides,
    });
  }

  function envelope(run, overrides = {}) {
    const candidateBundle = bundle();
    const fixedProposalReferences = { structuralReference: "pullback-low-1" };
    const charts = [{
      slot: 0,
      paneRole: "ENTRY",
      chartId: chart.chartId,
      contentRef: chart.contentRef,
      rawByteHash: chart.sha256,
      byteCount: chart.byteLength,
      mediaType: chart.mediaType,
      width: null,
      height: null,
      symbol: "NVDA",
      timeframe: "2m",
      session: "RTH",
      timezone: "America/New_York",
      provenance: { kind: "OPERATOR_UPLOAD", captureVerified: false },
      receivedAt: chart.ingestedAt,
      captureTime: null,
      captureTimeProvenance: null,
      providerInputByteHash: chart.sha256,
      transformVersion: null,
      transformHash: null,
    }];
    const policyHash = contentHash(OPERATOR_REVIEWED_IMPORT_POLICY);
    const unsigned = {
      schemaVersion: PRETRADE_PROVIDER_HANDOFF_SCHEMA,
      canonicalizationId: PRETRADE_PROVIDER_HANDOFF_CANONICALIZATION,
      issuerId: "sod-service-test",
      keyId: "key-1",
      audienceInstallationId: config.installationId,
      storeEpoch: h.store.snapshot().storeEpoch,
      messageId: deterministic ? "44444444-4444-4444-8444-444444444444" : crypto.randomUUID(),
      signatureAlgorithm: PRETRADE_PROVIDER_HANDOFF_SIGNATURE_ALGORITHM,
      challenge: {
        challengeId: run.challengeId,
        nonce: run.challengeNonce,
        issuedAt: run.issuedAt,
        expiresAt: run.expiresAt,
        bootGeneration: run.bootGeneration,
      },
      run: {
        draftId: run.draftId,
        inputRevision: run.inputRevision,
        runId: run.runId,
        inputManifestHash: run.inputManifestHash,
        retirementRevision: run.retirementRevision,
        accountScopeId: run.accountScopeId,
        accountSelectionRevision: run.accountSelectionRevision,
      },
      provider: {
        serviceId: "sod-analysis-service",
        requestId: "provider-request-1",
        responseId: "provider-response-1",
        modelId: "gpt-test",
        reasoningEffort: "high",
        promptVersion: config.prompt.version,
        promptHash: config.prompt.hash,
        outputSchemaVersion: config.outputSchema.version,
        outputSchemaHash: config.outputSchema.hash,
        profileId: OPERATOR_REVIEWED_IMPORT_POLICY.profileId,
        profileVersion: OPERATOR_REVIEWED_IMPORT_POLICY.profileVersion,
        profileHash: config.profileHash,
        buildSourceDigest: sha("dirty-source-manifest"),
        policyId: OPERATOR_REVIEWED_IMPORT_POLICY.policyId,
        policyVersion: OPERATOR_REVIEWED_IMPORT_POLICY.policyVersion,
        policyHash,
      },
      output: {
        providerRequestHash: sha("provider-request-bytes"),
        rawOutputByteHash: sha("provider-output-bytes"),
        normalizedOutputHash: contentHash({ bundle: candidateBundle, fixedProposalReferences }),
        proposalHash: pretradePreviewProposalHash(candidateBundle),
        candidateId: candidateBundle.candidates[0].candidateId,
        contractVersion: candidateBundle.candidates[0].contractVersion,
        candidateContractHash: candidateContractHash(candidateBundle.candidates[0]),
        fixedProposalReferences,
        bundle: candidateBundle,
      },
      charts,
      times: {
        providerRequestStartedAt: "2026-09-21T15:00:00.200Z",
        providerRequestFinishedAt: "2026-09-21T15:00:00.300Z",
        serviceOutputReceivedAt: "2026-09-21T15:00:00.400Z",
        envelopeIssuedAt: "2026-09-21T15:00:00.500Z",
        envelopeExpiresAt: "2026-09-21T15:00:59.500Z",
      },
      evidence: [],
      signature: "pending",
      ...overrides,
    };
    return signPreTradeProviderHandoff(unsigned, keys.privateKey);
  }

  return { ...h, keys, chart, config, challenge, envelope };
}

test("strict handoff JSON rejects duplicate names, unknown fields and unsafe integers", t => {
  const h = fixture(t);
  const signed = h.envelope(h.challenge());
  const json = JSON.stringify(signed);
  assert.throws(
    () => parsePreTradeProviderHandoff(json.replace('"schemaVersion":', '"schemaVersion":"PRETRADE_PROVIDER_HANDOFF_V1","schemaVersion":')),
    { code: "PRETRADE_PROVIDER_HANDOFF_DUPLICATE_KEY" },
  );
  assert.throws(
    () => parsePreTradeProviderHandoff(JSON.stringify({ ...signed, browserPass: true })),
    { code: "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID" },
  );
  assert.throws(
    () => parsePreTradeProviderHandoff(json.replace('"inputRevision":1', '"inputRevision":9007199254740992')),
    { code: "PRETRADE_PROVIDER_HANDOFF_JSON_INVALID" },
  );
  assert.throws(
    () => parsePreTradeProviderHandoff(`${"[".repeat(66)}0${"]".repeat(66)}`),
    { code: "PRETRADE_PROVIDER_HANDOFF_JSON_INVALID" },
  );
  assert.throws(
    () => parsePreTradeProviderHandoff(json, { maxBytes: Number.NaN }),
    { code: "PRETRADE_PROVIDER_HANDOFF_CONFIGURATION_INVALID" },
  );
  const parsed = parsePreTradeProviderHandoff(json).envelope;
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.output.bundle.candidates[0]), true);
  assert.equal(Object.isFrozen(parsed.charts[0].provenance), true);
  assert.throws(() => { parsed.output.bundle.candidates[0].symbol = "MUTATED"; }, TypeError);
});

test("canonical signed material has a frozen cross-language golden hash", t => {
  const h = fixture(t, { deterministic: true });
  const signed = h.envelope(h.challenge());
  const canonical = canonicalPreTradeProviderHandoffBytes(signed);
  assert.equal(sha(canonical), "2f4f814bade8f5ff0c165e38450419766aefc83ea8a0d9964c3b57ec92a2a4e3");
});

test("provider configuration and server challenge allocation are bounded", t => {
  const h = fixture(t);
  h.config.maxClockSkewMs = Number.NaN;
  assert.equal(h.authority.readiness().providerHandoffConfigured, false);
  assert.throws(() => h.challenge(), { code: "PRETRADE_PREVIEW_FEATURE_DISABLED" });

  h.config.maxClockSkewMs = 5_000;
  h.config.challengeIdFactory = () => "not-a-uuid";
  assert.throws(() => h.challenge(), { code: "PRETRADE_PROVIDER_CHALLENGE_ALLOCATION_FAILED" });

  h.config.challengeIdFactory = () => crypto.randomUUID();
  h.config.nonceFactory = () => "B".repeat(43);
  assert.throws(() => h.challenge(), { code: "PRETRADE_PROVIDER_CHALLENGE_ALLOCATION_FAILED" });
  assert.equal(h.store.snapshot().pretradeProviderRuns.length, 0);
});

test("authenticated registration atomically binds one signed response to one preview", async t => {
  const h = fixture(t);
  const run = h.challenge();
  const signed = h.envelope(run);
  const bytes = Buffer.from(JSON.stringify(signed));
  assert.throws(
    () => h.authority.create({ bundle: bundle() }),
    { code: "PRETRADE_PROVIDER_HANDOFF_REQUIRED" },
  );
  const first = await h.authority.registerProviderHandoff(bytes);
  assert.equal(first.preview.state, "PREVIEW_READY");
  assert.equal(first.preview.reviewScope.setupAssessmentStatus, "NOT_EVALUATED");
  const state = h.store.snapshot();
  assert.equal(state.pretradeProviderRuns[0].status, "REGISTERED");
  assert.equal(state.pretradeProviderMessages[0].status, "REGISTERED");
  assert.equal(state.pretradeProviderMessages[0].previewId, first.preview.previewId);
  assert.equal(state.pretradePreviews[0].provenance.channel, "AUTHENTICATED_PROVIDER_HANDOFF");
  assert.equal(state.candidates.length, 0);
  const replay = await h.authority.registerProviderHandoff(bytes);
  assert.equal(replay.preview.previewId, first.preview.previewId);
  assert.equal(h.store.snapshot().pretradePreviews.length, 1);
  const receipt = await h.authority.accept(first.preview);
  assert.equal(receipt.result, "ADMITTED");
  assert.equal(h.store.snapshot().pretradeProviderRuns[0].status, "REGISTERED");
  assert.equal(h.store.snapshot().pretradeProviderMessages[0].status, "REGISTERED");

  const changedMessage = h.envelope(run);
  await assert.rejects(
    h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(changedMessage))),
    { code: "PRETRADE_PROVIDER_REPLAY_CONFLICT" },
  );
});

test("bad signatures fail before mutation and byte mismatches consume the original challenge", async t => {
  const h = fixture(t);
  const run = h.challenge();
  const signed = h.envelope(run);
  const tampered = structuredClone(signed);
  tampered.provider.modelId = "other-model";
  await assert.rejects(
    h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(tampered))),
    { code: "PRETRADE_PROVIDER_HANDOFF_SIGNATURE_INVALID" },
  );
  assert.equal(h.store.snapshot().pretradeProviderMessages.length, 0);

  const wrongChart = structuredClone(signed);
  wrongChart.output.rawOutputByteHash = sha("different-output");
  const resigned = signPreTradeProviderHandoff(wrongChart, h.keys.privateKey);
  h.config.resolveChart = async () => ({ ...h.chart, bytes: Buffer.from("different-chart-bytes") });
  await assert.rejects(
    h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(resigned))),
    { code: "PRETRADE_PROVIDER_CHART_BINDING_MISMATCH" },
  );
  const state = h.store.snapshot();
  assert.equal(state.pretradeProviderRuns[0].status, "REJECTED");
  assert.equal(state.pretradeProviderMessages[0].status, "REJECTED");
  assert.equal(state.pretradePreviews.length, 0);
  await assert.rejects(
    h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(resigned))),
    { code: "PRETRADE_PROVIDER_CHART_BINDING_MISMATCH" },
  );
});

test("retirement blocks late signed output before preview creation", async t => {
  const h = fixture(t);
  const run = h.challenge();
  const signed = h.envelope(run);
  const retired = h.authority.retireProviderRun({
    draftId: run.draftId,
    inputRevision: run.inputRevision,
    runId: run.runId,
    retirementRevision: 1,
  });
  assert.equal(retired.status, "RETIRED");
  await assert.rejects(
    h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(signed))),
    { code: "PRETRADE_PROVIDER_RUN_BINDING_MISMATCH" },
  );
  assert.equal(h.store.snapshot().pretradePreviews.length, 0);
});

test("restart interrupts in-flight chart verification and late completion cannot register", async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = fixture(t, { resolveChart: () => pending });
  const run = h.challenge();
  const signed = h.envelope(run);
  const registration = h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(signed)));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.store.snapshot().pretradeProviderMessages[0].status, "VERIFYING");

  const restarted = new PreTradePreviewAuthority({
    store: h.store,
    candidateIngress: h.ingress,
    enabled: true,
    policy: OPERATOR_REVIEWED_IMPORT_POLICY,
    evidenceProvider: h.authority.evidenceProvider,
    evidenceValidator: h.authority.evidenceValidator,
    providerHandoff: h.config,
    requireAuthenticatedRegistration: true,
    clock: h.clock,
  });
  restarted.recoverAfterRestart();
  assert.equal(h.store.snapshot().pretradeProviderMessages[0].status, "INTERRUPTED");
  release({ ...h.chart, bytes: Buffer.from(h.chart.bytes) });
  await assert.rejects(registration, { code: "PRETRADE_PROVIDER_RUN_BINDING_MISMATCH" });
  assert.equal(h.store.snapshot().pretradePreviews.length, 0);
});

test("persisted provider ledger cannot be relinked to another preview", async t => {
  const h = fixture(t);
  const run = h.challenge();
  await h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(h.envelope(run))));
  h.store.close();
  const raw = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
  raw.pretradeProviderMessages[0].previewId = "unknown-preview";
  raw.pretradeProviderMessages[0].integrityHash = pretradeProviderMessageIntegrityHash(raw.pretradeProviderMessages[0]);
  fs.writeFileSync(h.filePath, `${JSON.stringify(raw, null, 2)}\n`);
  const restored = new PreTradeStore({ filePath: h.filePath });
  assert.throws(() => restored.load(), { code: "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE" });
});

test("persisted provider ledger rejects a complete cross-run preview substitution", async t => {
  const h = fixture(t);
  const signedA = h.envelope(h.challenge());
  const previewA = await h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(signedA)));
  const runB = h.challenge({ draftId: "draft-2", runId: "run-2" });
  const previewB = await h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(secondSignedEnvelope(h, runB))));
  h.store.close();

  const raw = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
  raw.pretradeProviderRuns[0].previewId = previewB.preview.previewId;
  raw.pretradeProviderRuns[0].operationId = previewB.preview.operationId;
  raw.pretradeProviderMessages[0].previewId = previewB.preview.previewId;
  raw.pretradeProviderMessages[0].operationId = previewB.preview.operationId;
  raw.pretradeProviderRuns[0].integrityHash = pretradeProviderRunIntegrityHash(raw.pretradeProviderRuns[0]);
  raw.pretradeProviderMessages[0].integrityHash = pretradeProviderMessageIntegrityHash(raw.pretradeProviderMessages[0]);
  fs.writeFileSync(h.filePath, `${JSON.stringify(raw, null, 2)}\n`);

  const restored = new PreTradeStore({ filePath: h.filePath });
  restored.acquireWriterLock();
  t.after(() => restored.close());
  assert.throws(() => restored.load(), { code: "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE" });
  assert.equal(restored.fenced, true);
  h.authority.store = restored;
  assert.throws(
    () => h.authority.status(previewA.preview.previewId),
    { code: "PRETRADE_RECOVERY_REQUIRED" },
  );
  await assert.rejects(
    h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(signedA))),
    { code: "PRETRADE_PREVIEW_FEATURE_DISABLED" },
  );
});

test("provider registration identity remains valid after preview refresh and reload", async t => {
  const h = fixture(t);
  const registered = await h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(h.envelope(h.challenge()))));
  const refreshed = await h.authority.refresh({
    previewId: registered.preview.previewId,
    operationId: registered.preview.operationId,
  });
  const before = h.store.snapshot();
  const original = before.pretradePreviews.find(item => item.previewId === registered.preview.previewId);
  assert.equal(original.state, "RETIRED");
  assert.equal(before.pretradeProviderMessages[0].previewId, registered.preview.previewId);
  assert.equal(before.pretradePreviews.find(item => item.previewId === refreshed.previewId).priorBindingHash, original.bindingHash);
  h.store.close();

  const restored = new PreTradeStore({ filePath: h.filePath });
  restored.acquireWriterLock();
  t.after(() => restored.close());
  const recovered = restored.load();
  assert.equal(recovered.pretradeProviderRuns[0].status, "REGISTERED");
  assert.equal(recovered.pretradeProviderMessages[0].previewId, registered.preview.previewId);
  assert.equal(recovered.pretradePreviews.find(item => item.previewId === refreshed.previewId).revision, 2);
});

test("persisted provider replay identity cannot be rewritten with recomputed record hashes", async t => {
  const h = fixture(t);
  const run = h.challenge();
  await h.authority.registerProviderHandoff(Buffer.from(JSON.stringify(h.envelope(run))));
  h.store.close();
  const raw = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
  raw.pretradeProviderRuns[0].providerResponseId = "provider-response-rewritten";
  raw.pretradeProviderMessages[0].providerResponseId = "provider-response-rewritten";
  raw.pretradeProviderRuns[0].integrityHash = pretradeProviderRunIntegrityHash(raw.pretradeProviderRuns[0]);
  raw.pretradeProviderMessages[0].integrityHash = pretradeProviderMessageIntegrityHash(raw.pretradeProviderMessages[0]);
  fs.writeFileSync(h.filePath, `${JSON.stringify(raw, null, 2)}\n`);
  const restored = new PreTradeStore({ filePath: h.filePath });
  assert.throws(() => restored.load(), { code: "CORRUPT_PRETRADE_PROVIDER_HANDOFF_STATE" });
});
