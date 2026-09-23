import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { bundle, create, harness } from "./helpers/pretrade-preview-fixture.mjs";
import { OPERATOR_REVIEWED_IMPORT_POLICY, OPERATOR_REVIEWED_IMPORT_SCOPE } from "../schwab-bridge/pretrade-preview-policy.mjs";
import { PreTradeStore, pretradePreviewReceiptHash } from "../schwab-bridge/pretrade-state.mjs";
import { AUTOMATED_UNTOUCHED_ONLY } from "../schwab-bridge/pretrade-candidate-ingress.mjs";

function operatorHarness(t, transform = evidence => evidence) {
  const h = harness();
  t.after(() => h.store.close());
  h.authority.allowLegacyTestPolicy = false;
  h.authority.policy = OPERATOR_REVIEWED_IMPORT_POLICY;
  const collect = h.authority.evidenceProvider;
  h.authority.evidenceProvider = async context => {
    const evidence = await collect(context);
    delete evidence.fixedPredicates;
    return transform(evidence, context);
  };
  return h;
}

test("operator-reviewed import does not invent a displacement limit or a setup PASS", async t => {
  const h = operatorHarness(t, evidence => ({ ...evidence, quoteEvidence: { ...evidence.quoteEvidence, bid: 200, ask: 201 } }));
  const input = bundle();
  input.candidates[0].entryConstraints = { note: "Operator reviews entry location" };
  input.candidates[0].disqualifiers = ["Review thesis if price crosses original structure"];
  const preview = create(h.authority, { bundle: input, sourceTimes: { chartCapturedAt: null } });
  assert.deepEqual(preview.reviewScope, OPERATOR_REVIEWED_IMPORT_SCOPE);
  const result = await h.authority.accept(preview);
  assert.equal(result.result, "ADMITTED");
  assert.deepEqual(result.reviewScope, OPERATOR_REVIEWED_IMPORT_SCOPE);
  const saved = h.store.snapshot();
  assert.equal(saved.candidates[0].lifecycleState, "WAITING");
  assert.equal(saved.candidates[0].plannedEntryReference, 177.25);
  assert.deepEqual(saved.candidates[0].entryConstraints, input.candidates[0].entryConstraints);
  assert.deepEqual(saved.candidates[0].disqualifiers, input.candidates[0].disqualifiers);
  assert.equal(saved.dssEvaluations.length, 0);
  assert.equal(saved.candidates[0].arm ?? null, null);
  assert.equal(Object.hasOwn(saved.pretradePreviewReceipts[0].evidence, "fixedPredicates"), false);
  assert.deepEqual(await h.authority.accept(preview), result);
  h.store.close();
  const reloaded = new PreTradeStore({ filePath: h.filePath });
  reloaded.load();
  assert.deepEqual(reloaded.snapshot().pretradePreviewReceipts[0].reviewScope, OPERATOR_REVIEWED_IMPORT_SCOPE);
});

test("unprofiled and deferred qualified-live policies cannot enable production admission", t => {
  const h = operatorHarness(t);
  for (const policy of [
    { ...OPERATOR_REVIEWED_IMPORT_POLICY, profileId: "QUALIFIED_LIVE_CARD_V1" },
    { ...OPERATOR_REVIEWED_IMPORT_POLICY, profileId: undefined },
    { ...OPERATOR_REVIEWED_IMPORT_POLICY, chartCardAgeThresholdMs: 60000 },
    { ...OPERATOR_REVIEWED_IMPORT_POLICY, setupAssessment: "VERIFIED" },
    { ...OPERATOR_REVIEWED_IMPORT_POLICY, policyVersion: 2 },
  ]) {
    h.authority.policy = policy;
    assert.equal(h.authority.readiness().enabled, false);
    assert.throws(() => create(h.authority), { code: "PRETRADE_PREVIEW_FEATURE_DISABLED" });
  }
});

test("import profile rejects asserted automated setup success and preserves quote/account/ownership guards", async t => {
  const cases = [
    [e => ({ ...e, fixedPredicates: { valid: true } }), "FINAL_SETUP_ASSESSMENT_CONFLICT"],
    [e => ({ ...e, setupAssessment: { status: "PASS" } }), "FINAL_SETUP_ASSESSMENT_CONFLICT"],
    [e => ({ ...e, quoteEvidence: { ...e.quoteEvidence, realtime: false } }), "QUOTE_NOT_REALTIME"],
    [e => ({ ...e, quoteEvidence: { ...e.quoteEvidence, receivedAt: "2026-09-21T14:00:00Z" } }), "STALE_OR_INVALID_QUOTE_RECEIPT"],
    [e => ({ ...e, accountEvidence: { ...e.accountEvidence, observedAt: "2026-09-21T14:00:00Z" } }), "FINAL_ACCOUNT_EVIDENCE_INVALID"],
    [e => ({ ...e, accountScope: "other" }), "FINAL_EVIDENCE_BINDING_MISMATCH"],
    [e => ({ ...e, ownershipEvidence: { ...e.ownershipEvidence, healthy: false } }), "FINAL_OWNERSHIP_EVIDENCE_INVALID"],
    [e => ({ ...e, ownershipEvidence: { ...e.ownershipEvidence, storeRevision: 8 } }), "FINAL_AUTHORITY_VERSION_CHANGED"],
  ];
  for (const [transform, reason] of cases) {
    const h = operatorHarness(t, transform);
    const result = await h.authority.accept(create(h.authority));
    assert.equal(result.result, "NOT_ADMITTED");
    assert.equal(result.reason, reason);
    assert.equal(h.store.snapshot().candidates.length, 0);
  }
});

test("canonical validity blocks new operator-reviewed imports without a new card lifetime", async t => {
  for (const [validFrom, validUntil, reason] of [
    ["2026-09-21T14:00:00Z", "2026-09-21T15:00:00Z", "FINAL_CANDIDATE_EXPIRED"],
    ["2026-09-21T16:00:00Z", "2026-09-21T21:00:00Z", "FINAL_CANDIDATE_NOT_YET_VALID"],
  ]) {
    const h = operatorHarness(t);
    const input = bundle();
    Object.assign(input.candidates[0].validity, { validFrom, validUntil });
    const result = await h.authority.accept(create(h.authority, { bundle: input }));
    assert.equal(result.reason, reason);
    assert.equal(h.store.snapshot().candidates.length, 0);
  }
  const h = operatorHarness(t);
  assert.throws(() => create(h.authority, { expiresAt: "2026-09-21T15:00:15Z" }), { code: "PREVIEW_ADDITIONAL_EXPIRY_FORBIDDEN" });
  const preview = create(h.authority, { sourceTimes: { chartCapturedAt: "2026-09-20T14:00:00Z" } });
  const replacement = await h.authority.refresh(preview);
  assert.equal(replacement.expiresAt, null);
  assert.equal(h.store.snapshot().pretradePreviews.at(-1).sourceTimes.chartCapturedAt, "2026-09-20T14:00:00Z");
  assert.equal((await h.authority.accept(replacement)).result, "ADMITTED");
});

test("existing candidate lookup preserves lifecycle and never claims another import", async t => {
  const h = operatorHarness(t);
  const input = bundle();
  h.ingress.importBundle(input, { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY });
  const before = h.store.snapshot().candidates;
  const result = await h.authority.accept(create(h.authority));
  assert.equal(result.result, "ALREADY_PRESENT");
  assert.equal(result.canonicalAdmission, null);
  assert.deepEqual(h.store.snapshot().candidates, before);
  assert.deepEqual(result.reviewScope, OPERATOR_REVIEWED_IMPORT_SCOPE);
});

test("validity expiring during evidence collection prevents a new import at the final boundary", async t => {
  const h = operatorHarness(t, evidence => {
    h.authority.clock = () => "2026-09-21T15:00:01.000Z";
    return evidence;
  });
  const input = bundle();
  input.candidates[0].validity.validUntil = "2026-09-21T15:00:01.000Z";
  const result = await h.authority.accept(create(h.authority, { bundle: input }));
  assert.equal(result.reason, "FINAL_CANDIDATE_EXPIRED");
  assert.equal(h.store.snapshot().candidates.length, 0);
});

test("expired exact existing candidate can be identified without new admission or validity renewal", async t => {
  const h = operatorHarness(t);
  const input = bundle();
  input.candidates[0].validity.validFrom = "2026-09-21T14:00:00Z";
  input.candidates[0].validity.validUntil = "2026-09-21T15:00:00Z";
  h.ingress.importBundle(input, { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY });
  const before = h.store.snapshot().candidates;
  const result = await h.authority.accept(create(h.authority, { bundle: input }));
  assert.equal(result.result, "ALREADY_PRESENT");
  assert.deepEqual(h.store.snapshot().candidates, before);
  assert.equal(result.canonicalAdmission, null);
  assert.equal(h.store.snapshot().pretradePreviewReceipts.length, 1);
});

test("receipt cannot be reclassified as verified even with its content hash recomputed", async t => {
  const h = operatorHarness(t);
  await h.authority.accept(create(h.authority));
  h.store.close();
  const raw = JSON.parse(fs.readFileSync(h.filePath, "utf8"));
  raw.pretradePreviewReceipts[0].reviewScope.setupAssessmentStatus = "VERIFIED";
  raw.pretradePreviewReceipts[0].receiptHash = pretradePreviewReceiptHash(raw.pretradePreviewReceipts[0]);
  fs.writeFileSync(h.filePath, JSON.stringify(raw));
  const restored = new PreTradeStore({ filePath: h.filePath });
  assert.throws(() => restored.load(), { code: "CORRUPT_PRETRADE_PREVIEW_STATE" });
});
