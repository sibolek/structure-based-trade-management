import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PreTradeStore,
  manualSupersessionAuthorizationIntegrityHash,
  manualSupersessionReviewIntegrityHash,
} from "../schwab-bridge/pretrade-state.mjs";
import {
  candidateContractHash,
  normalizeCanonicalCandidateProposal,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import {
  AUTOMATED_UNTOUCHED_ONLY,
  FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL,
  MANUAL_AUTHORIZED,
  MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
  MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED,
  MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID,
  MANUAL_SUPERSESSION_REVIEW_REQUIRED,
  PreTradeCandidateIngress,
} from "../schwab-bridge/pretrade-candidate-ingress.mjs";

const SOURCE = "SOD_A_PLUS_TRADES";

function tempStatePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "executionos-v24-ingress-")), "state.json");
}

function candidate(overrides = {}) {
  return {
    candidateId: "sod-2026-09-05-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: SOURCE,
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
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
      validFrom: "2026-09-05T13:00:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
      provenance: { source: "SOD", label: "RTH opportunity window" },
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function bundle(candidates, overrides = {}) {
  return {
    source: SOURCE,
    bundleId: "2026-09-05-v1",
    candidates,
    ...overrides,
  };
}

function automatedImport(ingress, payload) {
  return ingress.importBundle(payload, { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY });
}

function manualImport(ingress, payload, options = {}) {
  return ingress.importBundle(payload, { ingressPolicy: MANUAL_AUTHORIZED, ...options });
}

function createIngress({ filePath = tempStatePath(), times = [] } = {}) {
  let clockIndex = 0;
  let id = 0;
  const store = new PreTradeStore({ filePath });
  store.load();
  const ingress = new PreTradeCandidateIngress({
    store,
    clock: () => times[clockIndex++] || `2026-09-05T13:0${clockIndex}:00.000Z`,
    idFactory: () => `ingress-event-${++id}`,
  });
  return { store, ingress, filePath };
}

test("accepted canonical candidate starts WAITING with exact validity and immutable ingress provenance", () => {
  const { store, ingress, filePath } = createIngress({ times: ["2026-09-05T13:01:00.000Z"] });
  const result = automatedImport(ingress, bundle([candidate()]));

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(result.outcomes[0].lifecycleState, "WAITING");
  assert.equal(result.outcomes[0].stateRevision, 0);
  assert.ok(result.outcomes[0].contentHash);

  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.source, SOURCE);
  assert.equal(accepted.decisionTimeframe, "5m");
  assert.equal(accepted.entryTimeframe, "2m");
  assert.equal(accepted.volatilityTimeframe, "2m");
  assert.equal(accepted.validity.validFrom, "2026-09-05T13:00:00.000Z");
  assert.equal(accepted.validity.validUntil, "2026-09-05T20:00:00.000Z");
  assert.equal(accepted.validity.timezone, "America/New_York");
  assert.equal(accepted.validity.session, "RTH");
  assert.equal(accepted.armPolicy.finalAuthorizationMode, "MANUAL");
  assert.equal(accepted.armAuthorized, false);
  assert.equal(accepted.contractAuthority.authority, "CANONICAL_CANDIDATE_INGRESS");
  assert.equal(accepted.contractAuthority.contentHash, accepted.contentHash);
  assert.equal(accepted.stateRevision, 0);
  assert.equal(accepted.lifecycleJournal.events.length, 1);
  assert.equal(accepted.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");
  assert.equal(accepted.lifecycleJournal.operations.length, 1);
  assert.equal(accepted.lifecycleJournal.operations[0].action, "ACCEPT_CANDIDATE");

  const reloaded = new PreTradeStore({ filePath });
  const persisted = reloaded.load().candidates[0];
  assert.equal(persisted.contractAuthority.contentHash, accepted.contentHash);
  assert.equal(persisted.lifecycleJournal.events[0].eventType, "CANDIDATE_ACCEPTED");
});

test("canonical ingress requires authoritative bundle source and bundleId", () => {
  const { ingress } = createIngress();
  assert.throws(
    () => automatedImport(ingress, { bundleId: "x", candidates: [candidate()] }),
    (error) => error.code === "INVALID_BUNDLE_SOURCE",
  );
  assert.throws(
    () => automatedImport(ingress, { source: SOURCE, candidates: [candidate()] }),
    (error) => error.code === "INVALID_BUNDLE_ID",
  );
});

test("candidate source must match bundle source and SOD requires manual ARM intent", () => {
  const { ingress } = createIngress();
  const mismatch = automatedImport(ingress, bundle([candidate({ source: "SCANNER" })]));
  assert.equal(mismatch.outcomes[0].status, "REJECTED");
  assert.match(mismatch.outcomes[0].reasons.join(" "), /source must match/i);

  const autoSod = automatedImport(ingress, bundle([candidate({ armPolicy: { requestedMode: "AUTO" } })], { bundleId: "auto-sod" }));
  assert.equal(autoSod.outcomes[0].status, "REJECTED");
  assert.match(autoSod.outcomes[0].reasons.join(" "), /SOD_A_PLUS_TRADES.*MANUAL/i);
});

test("non-SOD upstream AUTO intent may be preserved but final ARM authority remains MANUAL", () => {
  const { store, ingress } = createIngress();
  const source = "CHATGPT_AD_HOC";
  const proposed = candidate({ source, armPolicy: { requestedMode: "AUTO" } });
  const result = automatedImport(ingress, { source, bundleId: "adhoc-1", candidates: [proposed] });
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.armPolicy.requestedMode, "AUTO");
  assert.equal(accepted.armPolicy.finalAuthorizationMode, "MANUAL");
  assert.equal(accepted.armAuthorized, false);
});

test("upstream proposal cannot import permission ARM risk quantity or execution authority", () => {
  const authorityOverrides = [
    { armAuthorized: true },
    { arm: { authorizedAt: "2026-09-05T13:00:00Z" } },
    { selectedQuantity: 25 },
    { riskEvaluation: { status: "VALID" } },
    { lifecycleState: "READY" },
  ];

  for (const [index, overrides] of authorityOverrides.entries()) {
    const { ingress } = createIngress();
    const result = automatedImport(ingress, bundle([candidate(overrides)], { bundleId: `forbidden-${index}` }));
    assert.equal(result.outcomes[0].status, "REJECTED");
  }
});

test("finite exact validity is mandatory and friendly labels alone cannot be accepted", () => {
  const invalidValidity = [
    null,
    { sourceLabel: "morning only", timezone: "America/New_York", session: "RTH" },
    { validFrom: "2026-09-05T09:30:00", validUntil: "2026-09-05T16:00:00", timezone: "America/New_York", session: "RTH" },
    { validFrom: "2026-09-05T20:00:00Z", validUntil: "2026-09-05T13:00:00Z", timezone: "America/New_York", session: "RTH" },
    { validFrom: "2026-09-05T13:00:00Z", validUntil: "2026-09-05T20:00:00Z", timezone: "Not/AZone", session: "RTH" },
    { validFrom: "2026-09-05T13:00:00Z", validUntil: "2026-09-05T20:00:00Z", timezone: "America/New_York" },
  ];

  for (const [index, validity] of invalidValidity.entries()) {
    const { ingress } = createIngress();
    const result = automatedImport(ingress, bundle([candidate({ validity })], { bundleId: `invalid-validity-${index}` }));
    assert.equal(result.outcomes[0].status, "REJECTED");
  }
});

test("equivalent absolute validity representations normalize to one idempotent contract", () => {
  const { store, ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "bundle-a" }));
  const equivalent = candidate({
    generatedAt: "2026-09-05T09:00:00-04:00",
    validity: {
      validFrom: "2026-09-05T09:00:00-04:00",
      validUntil: "2026-09-05T16:00:00-04:00",
      timezone: "America/New_York",
      session: "RTH",
      provenance: { source: "SOD", label: "RTH opportunity window" },
    },
  });
  const result = automatedImport(ingress, bundle([equivalent], { bundleId: "bundle-b" }));

  assert.equal(result.outcomes[0].status, "DUPLICATE");
  const accepted = store.snapshot().candidates[0];
  assert.equal(accepted.lifecycleJournal.events.length, 1);
  assert.equal(accepted.lifecycleJournal.operations.length, 1);
});

test("material validity change on same contractVersion is a fail-closed conflict", () => {
  const { ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1-a" }));
  const conflict = automatedImport(ingress, bundle([candidate({
    validity: {
      ...candidate().validity,
      validUntil: "2026-09-05T19:30:00.000Z",
    },
  })], { bundleId: "v1-b" }));
  assert.equal(conflict.outcomes[0].status, "CONFLICT");
});

test("newer accepted version supersedes active prior version with revision and durable event", () => {
  const { store, ingress, filePath } = createIngress({
    times: ["2026-09-05T13:01:00.000Z", "2026-09-05T13:05:00.000Z"],
  });

  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));
  const result = automatedImport(ingress, bundle([
    candidate({ contractVersion: 2, thesis: "Updated H2 continuation thesis" }),
  ], { bundleId: "v2" }));

  assert.equal(result.outcomes[0].status, "ACCEPTED");
  const state = store.snapshot();
  const v1 = state.candidates.find((item) => item.contractVersion === 1);
  const v2 = state.candidates.find((item) => item.contractVersion === 2);

  assert.equal(v1.lifecycleState, "SUPERSEDED");
  assert.equal(v1.stateRevision, 1);
  assert.equal(v1.supersededByVersion, 2);
  assert.equal(v1.lifecycleJournal.events[1].eventType, "CANDIDATE_SUPERSEDED");
  assert.equal(v1.lifecycleJournal.events[1].beforeState, "WAITING");
  assert.equal(v1.lifecycleJournal.events[1].afterState, "SUPERSEDED");
  assert.equal(v2.lifecycleState, "WAITING");
  assert.equal(v2.stateRevision, 0);

  const reloaded = new PreTradeStore({ filePath });
  const persistedV1 = reloaded.load().candidates.find((item) => item.contractVersion === 1);
  assert.equal(persistedV1.lifecycleState, "SUPERSEDED");
  assert.equal(persistedV1.lifecycleJournal.events[1].eventType, "CANDIDATE_SUPERSEDED");
});

test("older version is stale and terminal prior version is not rewritten by a newer version", () => {
  const { store, ingress } = createIngress();
  manualImport(ingress, bundle([candidate({ contractVersion: 2 })], { bundleId: "v2-first" }));
  const stale = automatedImport(ingress, bundle([candidate({ contractVersion: 1 })], { bundleId: "v1-late" }));
  assert.equal(stale.outcomes[0].status, "STALE");

  const existing = store.state.candidates[0];
  existing.lifecycleState = "DECLINED";
  existing.stateRevision = 1;
  store.save();
  const terminalResult = automatedImport(ingress, bundle([candidate({ contractVersion: 3, thesis: "third version" })], { bundleId: "v3" }));
  assert.equal(terminalResult.outcomes[0].status, "REJECTED");
  const prior = store.snapshot().candidates.find((item) => item.contractVersion === 2);
  assert.equal(prior.lifecycleState, "DECLINED");
  assert.equal(prior.stateRevision, 1);
});

test("ARMED prior version is immutable and is never superseded operationally", () => {
  const { store, ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));
  const prior = store.state.candidates[0];
  prior.lifecycleState = "ARMED";
  prior.stateRevision = 1;
  prior.armAuthorized = true;
  store.save();

  const result = manualImport(ingress, bundle([candidate({ contractVersion: 2, thesis: "new opportunity version" })], { bundleId: "v2" }));
  assert.equal(result.outcomes[0].status, "REJECTED");
  const persistedPrior = store.snapshot().candidates.find((item) => item.contractVersion === 1);
  assert.equal(persistedPrior.lifecycleState, "ARMED");
  assert.equal(persistedPrior.stateRevision, 1);
  assert.equal(persistedPrior.supersededByVersion, undefined);
});

test("manual supersession rejects caller authority and requires a persisted PRETRADE review", () => {
  const { store, ingress } = createIngress();
  manualImport(ingress, bundle([candidate()], { bundleId: "manual-v1" }));
  const proposed = candidate({
    contractVersion: 2,
    thesis: "Reviewed stronger continuation.",
    optionalNullEvidence: null,
  });
  const { normalized: normalizedProposed, errors } = normalizeCanonicalCandidateProposal(proposed, { bundleSource: SOURCE });
  assert.deepEqual(errors, []);
  const fabricatedAuth = {
    authorizationId: "fabricated-matching-auth",
    candidateId: proposed.candidateId,
    priorContractVersion: 1,
    priorLifecycleState: "WAITING",
    priorStateRevision: 0,
    priorContentHash: store.snapshot().candidates[0].contentHash,
    proposedContractVersion: 2,
    proposedContentHash: candidateContractHash(normalizedProposed),
    decision: "AUTHORIZED",
  };
  const beforeForgery = store.snapshot();

  assert.throws(
    () => manualImport(ingress, bundle([proposed], { bundleId: "manual-v2" }), {
      manualSupersessionAuthorizations: [fabricatedAuth],
    }),
    (error) => error.code === FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL,
  );
  assert.deepEqual(store.snapshot(), beforeForgery);
  assert.throws(
    () => manualImport(ingress, bundle([proposed], {
      bundleId: "manual-v2",
      manualSupersessionAuthorizations: [fabricatedAuth],
    })),
    (error) => error.code === FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL,
  );
  assert.deepEqual(store.snapshot(), beforeForgery);
  assert.throws(
    () => manualImport(ingress, bundle([proposed], {
      bundleId: "manual-v2",
      manualSupersessionReviews: [{ reviewId: "fabricated-review" }],
    })),
    (error) => error.code === FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL,
  );
  assert.deepEqual(store.snapshot(), beforeForgery);
  assert.throws(
    () => ingress.authorizeManualSupersession({ operatorConfirmed: true }),
    (error) => error.code === MANUAL_SUPERSESSION_REVIEW_REQUIRED,
  );
  assert.throws(
    () => ingress.authorizeManualSupersession({ reviewId: "fabricated-review", operatorConfirmed: true }),
    (error) => error.code === MANUAL_SUPERSESSION_REVIEW_REQUIRED,
  );
  assert.throws(
    () => ingress.authorizeManualSupersession({ ...fabricatedAuth, operatorConfirmed: true }),
    (error) => error.code === MANUAL_SUPERSESSION_AUTHORIZATION_REQUEST_INVALID,
  );
  assert.throws(
    () => ingress.importBundle(bundle([proposed], { bundleId: "manual-v2" }), {
      ingressPolicy: MANUAL_AUTHORIZED,
      candidateId: fabricatedAuth.candidateId,
      priorContentHash: fabricatedAuth.priorContentHash,
      proposedContentHash: fabricatedAuth.proposedContentHash,
    }),
    (error) => error.code === "INVALID_INGRESS_OPTIONS",
  );
  assert.deepEqual(store.snapshot(), beforeForgery);

  const noAuth = manualImport(ingress, bundle([proposed], { bundleId: "manual-v2" }));
  assert.equal(noAuth.outcomes[0].status, "ACTION_REQUIRED");
  assert.deepEqual(noAuth.outcomes[0].reasons, [MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED]);

  const review = ingress.createManualSupersessionReview(bundle([proposed], { bundleId: "manual-v2" }));
  assert.equal(review.status, "ACTION_REQUIRED");
  assert.ok(review.reviews[0].reviewId);
  assert.equal(review.reviews[0].binding.candidateId, proposed.candidateId);
  assert.equal(review.reviews[0].binding.priorContentHash, fabricatedAuth.priorContentHash);
  assert.equal(review.reviews[0].binding.proposedContentHash, fabricatedAuth.proposedContentHash);
  assert.ok(review.reviews[0].substantiveDiff.some((item) => item.path === "thesis"));
  assert.deepEqual(
    review.reviews[0].substantiveDiff.find((item) => item.path === "optionalNullEvidence"),
    {
      path: "optionalNullEvidence",
      priorPresent: false,
      proposedPresent: true,
      proposed: null,
    },
  );
  assert.equal(review.reviews[0].disclosure.newLifecycleState, "WAITING");
  assert.equal(review.reviews[0].disclosure.newStateRevision, 0);
  assert.equal(review.reviews[0].disclosure.inherits.triggerSatisfaction, false);
  assert.equal(review.reviews[0].disclosure.inherits.armAuthorization, false);
  assert.equal(review.reviews[0].disclosure.inherits.executionAuthority, false);
  assert.equal(store.snapshot().manualSupersessionReviews[0].reviewId, review.reviews[0].reviewId);

  const authorization = ingress.authorizeManualSupersession({
    reviewId: review.reviews[0].reviewId,
    operatorConfirmed: true,
  });
  assert.equal(authorization.reviewId, review.reviews[0].reviewId);
  assert.ok(authorization.authorizationId.startsWith("manual-supersession-authorization-"));

  const accepted = manualImport(ingress, bundle([proposed], { bundleId: "manual-v2" }));
  assert.equal(accepted.outcomes[0].status, "ACCEPTED");
  const state = store.snapshot();
  const prior = state.candidates.find((item) => item.contractVersion === 1);
  const admitted = state.candidates.find((item) => item.contractVersion === 2);
  assert.equal(prior.lifecycleState, "SUPERSEDED");
  assert.equal(admitted.lifecycleState, "WAITING");
  assert.equal(admitted.stateRevision, 0);
  assert.equal(admitted.armAuthorized, false);
  assert.equal(admitted.triggerSatisfaction, null);
  assert.equal(admitted.currentDssEvaluationId, null);
  assert.equal(admitted.authorizedDssEvaluationId, null);
  assert.equal(admitted.currentPermissionOutcome, null);
  assert.equal(admitted.arm, null);
  assert.equal(Object.prototype.hasOwnProperty.call(admitted, "selectedQuantity"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(admitted, "handoff"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(admitted, "executionState"), false);
  assert.equal(state.manualSupersessionAuthorizations[0].consumedByOperationId.includes("INGRESS_SUPERSEDE"), true);
  assert.throws(
    () => ingress.authorizeManualSupersession({ reviewId: review.reviews[0].reviewId, operatorConfirmed: true }),
    (error) => error.code === MANUAL_SUPERSESSION_AUTHORIZATION_INVALID,
  );

  const later = candidate({ contractVersion: 3, thesis: "A later unreviewed revision." });
  const laterResult = manualImport(ingress, bundle([later], { bundleId: "manual-v3" }));
  assert.equal(laterResult.outcomes[0].status, "ACTION_REQUIRED");
  assert.deepEqual(laterResult.outcomes[0].reasons, [MANUAL_SUPERSESSION_AUTHORIZATION_REQUIRED]);
});

test("manual supersession review and authorization persist across PRETRADE restarts", () => {
  const filePath = tempStatePath();
  const first = createIngress({ filePath });
  manualImport(first.ingress, bundle([candidate()], { bundleId: "restart-v1" }));
  const proposed = candidate({ contractVersion: 2, thesis: "Reviewed before PRETRADE restart." });
  const review = first.ingress.createManualSupersessionReview(bundle([proposed], { bundleId: "restart-v2" }));

  const secondStore = new PreTradeStore({ filePath });
  const afterReviewRestart = secondStore.load();
  assert.equal(afterReviewRestart.manualSupersessionReviews.length, 1);
  assert.equal(afterReviewRestart.manualSupersessionReviews[0].reviewId, review.reviews[0].reviewId);
  assert.deepEqual(afterReviewRestart.manualSupersessionReviews[0].proposedCandidate.thesis, proposed.thesis);
  const secondIngress = new PreTradeCandidateIngress({
    store: secondStore,
    clock: () => "2026-09-05T13:10:00.000Z",
    idFactory: () => "restart-event-1",
  });
  const authorization = secondIngress.authorizeManualSupersession({
    reviewId: review.reviews[0].reviewId,
    operatorConfirmed: true,
  });

  const thirdStore = new PreTradeStore({ filePath });
  const afterAuthorizationRestart = thirdStore.load();
  assert.equal(afterAuthorizationRestart.manualSupersessionAuthorizations.length, 1);
  assert.equal(afterAuthorizationRestart.manualSupersessionAuthorizations[0].authorizationId, authorization.authorizationId);
  assert.equal(afterAuthorizationRestart.manualSupersessionAuthorizations[0].consumedAt, null);
  const thirdIngress = new PreTradeCandidateIngress({
    store: thirdStore,
    clock: () => "2026-09-05T13:11:00.000Z",
    idFactory: () => "restart-event-2",
  });
  const accepted = manualImport(thirdIngress, bundle([proposed], { bundleId: "restart-v2" }));
  assert.equal(accepted.outcomes[0].status, "ACCEPTED");

  const finalStore = new PreTradeStore({ filePath });
  const finalState = finalStore.load();
  assert.equal(finalState.candidates.find((item) => item.contractVersion === 1).lifecycleState, "SUPERSEDED");
  assert.equal(finalState.candidates.find((item) => item.contractVersion === 2).lifecycleState, "WAITING");
  assert.ok(finalState.manualSupersessionAuthorizations[0].consumedAt);
});

test("legacy PRETRADE state without manual authority collections initializes them empty", () => {
  const { store, filePath } = createIngress();
  store.save();
  const legacy = JSON.parse(fs.readFileSync(filePath, "utf8"));
  delete legacy.manualSupersessionReviews;
  delete legacy.manualSupersessionAuthorizations;
  fs.writeFileSync(filePath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");

  const reloaded = new PreTradeStore({ filePath }).load();
  assert.deepEqual(reloaded.manualSupersessionReviews, []);
  assert.deepEqual(reloaded.manualSupersessionAuthorizations, []);
});

test("manual supersession review is invalidated by authoritative prior state changes", () => {
  for (const mutation of [
    { name: "stateRevision", apply: (prior) => { prior.stateRevision += 1; }, code: MANUAL_SUPERSESSION_AUTHORIZATION_INVALID },
    { name: "lifecycleState", apply: (prior) => { prior.lifecycleState = "READY"; }, code: MANUAL_SUPERSESSION_AUTHORIZATION_INVALID },
    { name: "content", apply: (prior) => { prior.thesis = "Tampered prior content."; }, code: "CANDIDATE_CONTRACT_INTEGRITY_ERROR" },
  ]) {
    const { store, ingress } = createIngress();
    manualImport(ingress, bundle([candidate()], { bundleId: `${mutation.name}-v1` }));
    const proposed = candidate({ contractVersion: 2, thesis: `Reviewed before ${mutation.name} changed.` });
    const review = ingress.createManualSupersessionReview(bundle([proposed], { bundleId: `${mutation.name}-v2` }));
    mutation.apply(store.state.candidates[0]);
    assert.throws(
      () => ingress.authorizeManualSupersession({ reviewId: review.reviews[0].reviewId, operatorConfirmed: true }),
      (error) => error.code === mutation.code,
      mutation.name,
    );
    assert.equal(store.snapshot().manualSupersessionAuthorizations.length, 0);
  }
});

test("authorization is exact-proposal bound and stale authorization fails closed", () => {
  const { store, ingress, filePath } = createIngress();
  manualImport(ingress, bundle([candidate()], { bundleId: "exact-v1" }));
  const reviewed = candidate({ contractVersion: 2, thesis: "Exact reviewed proposal A." });
  const different = candidate({ contractVersion: 2, thesis: "Different proposal B." });
  const review = ingress.createManualSupersessionReview(bundle([reviewed], { bundleId: "exact-v2" }));
  ingress.authorizeManualSupersession({ reviewId: review.reviews[0].reviewId, operatorConfirmed: true });

  const mismatch = manualImport(ingress, bundle([different], { bundleId: "different-v2" }));
  assert.equal(mismatch.outcomes[0].status, "ACTION_REQUIRED");
  assert.equal(store.snapshot().candidates.length, 1);

  store.state.candidates[0].stateRevision += 1;
  store.save();
  const restartedStore = new PreTradeStore({ filePath });
  restartedStore.load();
  const restartedIngress = new PreTradeCandidateIngress({
    store: restartedStore,
    clock: () => "2026-09-05T13:20:00.000Z",
    idFactory: () => "stale-restart-event",
  });
  const stale = manualImport(restartedIngress, bundle([reviewed], { bundleId: "stale-v2" }));
  assert.equal(stale.outcomes[0].status, "REJECTED");
  assert.deepEqual(stale.outcomes[0].reasons, [MANUAL_SUPERSESSION_AUTHORIZATION_INVALID]);
  assert.equal(restartedStore.snapshot().candidates.length, 1);
});

test("corrupt persisted manual review or authorization evidence fails closed", () => {
  const reviewCase = createIngress();
  manualImport(reviewCase.ingress, bundle([candidate()], { bundleId: "corrupt-review-v1" }));
  const proposed = candidate({ contractVersion: 2, thesis: "Persisted review integrity." });
  reviewCase.ingress.createManualSupersessionReview(bundle([proposed], { bundleId: "corrupt-review-v2" }));
  const corruptReviewState = JSON.parse(fs.readFileSync(reviewCase.filePath, "utf8"));
  corruptReviewState.manualSupersessionReviews[0].substantiveDiff[0].path = "tampered.path";
  fs.writeFileSync(reviewCase.filePath, `${JSON.stringify(corruptReviewState, null, 2)}\n`, "utf8");
  assert.throws(
    () => new PreTradeStore({ filePath: reviewCase.filePath }).load(),
    (error) => error.code === "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE",
  );

  const authorizationCase = createIngress();
  manualImport(authorizationCase.ingress, bundle([candidate()], { bundleId: "corrupt-auth-v1" }));
  const authReview = authorizationCase.ingress.createManualSupersessionReview(bundle([proposed], { bundleId: "corrupt-auth-v2" }));
  authorizationCase.ingress.authorizeManualSupersession({ reviewId: authReview.reviews[0].reviewId, operatorConfirmed: true });
  const corruptAuthorizationState = JSON.parse(fs.readFileSync(authorizationCase.filePath, "utf8"));
  corruptAuthorizationState.manualSupersessionAuthorizations[0].proposedContentHash = "0".repeat(64);
  fs.writeFileSync(authorizationCase.filePath, `${JSON.stringify(corruptAuthorizationState, null, 2)}\n`, "utf8");
  assert.throws(
    () => new PreTradeStore({ filePath: authorizationCase.filePath }).load(),
    (error) => error.code === "CORRUPT_MANUAL_SUPERSESSION_AUTHORIZATION_STATE",
  );
});

test("internally inconsistent reviewed proposal fails closed even with a recomputed record hash", () => {
  const { store, ingress } = createIngress();
  manualImport(ingress, bundle([candidate()], { bundleId: "semantic-v1" }));
  const proposed = candidate({ contractVersion: 2, thesis: "Original reviewed proposal." });
  ingress.createManualSupersessionReview(bundle([proposed], { bundleId: "semantic-v2" }));
  const corrupt = structuredClone(store.state.manualSupersessionReviews[0]);
  corrupt.proposedCandidate.thesis = "Different content without matching proposed hash.";
  corrupt.reviewIntegrityHash = manualSupersessionReviewIntegrityHash(corrupt);
  store.state.manualSupersessionReviews[0] = corrupt;

  assert.throws(
    () => ingress.authorizeManualSupersession({ reviewId: corrupt.reviewId, operatorConfirmed: true }),
    (error) => error.code === "CORRUPT_MANUAL_SUPERSESSION_REVIEW_STATE",
  );
  assert.equal(store.snapshot().manualSupersessionAuthorizations.length, 0);
});

test("authorization consumption evidence remains integrity-verifiable", () => {
  const { store, ingress } = createIngress();
  manualImport(ingress, bundle([candidate()], { bundleId: "integrity-v1" }));
  const proposed = candidate({ contractVersion: 2, thesis: "Authorization consumption integrity." });
  const review = ingress.createManualSupersessionReview(bundle([proposed], { bundleId: "integrity-v2" }));
  ingress.authorizeManualSupersession({ reviewId: review.reviews[0].reviewId, operatorConfirmed: true });
  manualImport(ingress, bundle([proposed], { bundleId: "integrity-v2" }));
  const authorization = store.snapshot().manualSupersessionAuthorizations[0];
  assert.equal(
    authorization.authorizationIntegrityHash,
    manualSupersessionAuthorizationIntegrityHash(authorization),
  );
});

test("manual supersession persistence failure rolls back prior, admission, and authorization consumption", () => {
  const { store, ingress } = createIngress();
  manualImport(ingress, bundle([candidate()], { bundleId: "rollback-v1" }));
  const proposed = candidate({ contractVersion: 2, thesis: "Atomic manual supersession rollback." });
  const review = ingress.createManualSupersessionReview(bundle([proposed], { bundleId: "rollback-v2" }));
  ingress.authorizeManualSupersession({ reviewId: review.reviews[0].reviewId, operatorConfirmed: true });
  const before = store.snapshot();
  const originalSave = store.save.bind(store);
  store.save = () => {
    throw Object.assign(new Error("simulated manual supersession persistence failure"), { code: "SIMULATED_SAVE_FAILURE" });
  };

  assert.throws(
    () => manualImport(ingress, bundle([proposed], { bundleId: "rollback-v2" })),
    (error) => error.code === "SIMULATED_SAVE_FAILURE",
  );
  store.save = originalSave;
  assert.deepEqual(store.snapshot(), before);
  assert.equal(store.snapshot().candidates[0].lifecycleState, "WAITING");
  assert.equal(store.snapshot().manualSupersessionAuthorizations[0].consumedAt, null);
});

test("canonical contract tampering fails closed before duplicate or supersession processing", () => {
  const { store, ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));
  store.state.candidates[0].thesis = "tampered without contractVersion";
  store.save();

  assert.throws(
    () => automatedImport(ingress, bundle([candidate()], { bundleId: "duplicate-after-tamper" })),
    (error) => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR",
  );
  assert.throws(
    () => automatedImport(ingress, bundle([candidate({ contractVersion: 2, thesis: "valid new version" })], { bundleId: "v2-after-tamper" })),
    (error) => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR",
  );
});

test("legacy split lifecycle arrays migrate into canonical lifecycleJournal when ingress touches candidate", () => {
  const { store, ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));
  const existing = store.state.candidates[0];
  existing.lifecycleEvents = existing.lifecycleJournal.events;
  existing.lifecycleOperations = existing.lifecycleJournal.operations.map((operation) => ({
    ...operation,
    fingerprint: operation.operationHash,
    operationHash: undefined,
  }));
  delete existing.lifecycleJournal;
  store.save();

  automatedImport(ingress, bundle([candidate({ contractVersion: 2, thesis: "new version" })], { bundleId: "v2" }));
  const migrated = store.snapshot().candidates.find((item) => item.contractVersion === 1);
  assert.equal(migrated.lifecycleJournal.events.length, 2);
  assert.equal(migrated.lifecycleJournal.operations.length, 2);
  assert.ok(migrated.lifecycleJournal.operations[0].operationHash);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "lifecycleEvents"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(migrated, "lifecycleOperations"), false);
});

test("persistence failure rolls back acceptance and supersession mutations", () => {
  const { store, ingress } = createIngress();
  automatedImport(ingress, bundle([candidate()], { bundleId: "v1" }));
  const before = store.snapshot();

  const originalSave = store.save.bind(store);
  store.save = () => {
    throw Object.assign(new Error("simulated persistence failure"), { code: "SIMULATED_SAVE_FAILURE" });
  };

  assert.throws(
    () => automatedImport(ingress, bundle([candidate({ contractVersion: 2, thesis: "new version" })], { bundleId: "v2" })),
    (error) => error.code === "SIMULATED_SAVE_FAILURE",
  );

  store.save = originalSave;
  assert.deepEqual(store.snapshot(), before);
});
