import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { PreTradeArmLifecycleAuthority } from "../schwab-bridge/pretrade-arm-lifecycle-authority.mjs";
import { createPendingExecutionBoardHandoffDelivery, claimExecutionBoardHandoffDelivery, blockExecutionBoardHandoffDelivery } from "../schwab-bridge/execution-board-handoff-delivery.mjs";
import { PreTradeStore, contentHash } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { PreTradeTriggerEngine } from "../schwab-bridge/pretrade-trigger-engine.mjs";
import { PreTradeTriggerPersistenceAuthority } from "../schwab-bridge/pretrade-trigger-persistence-authority.mjs";
import { createPreTradeCandidateApiHandler } from "../schwab-bridge/pretrade-candidate-api.mjs";
import { assertCanonicalCandidateIntegrity as verify, canonicalCandidateContent, candidateContractHash,
  normalizeCanonicalCandidateProposal, assertCandidateRuntimeRootOwnership, upgradeLegacyCanonicalCandidateIntegrity,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import { SYSTEM_CANDIDATE_ROOTS } from "../schwab-bridge/candidate-integrity-roots.mjs";
import { canonicalJson } from "../schwab-bridge/canonical-json.mjs";
import { candidateSubstantiveHash, resolveSodCandidateLineage } from "../schwab-bridge/sod-candidate-lineage.mjs";
import { validateCandidateBundle } from "../schwab-bridge/candidate-feeder.mjs";
import { validateManualIngestionEnvelope } from "../schwab-bridge/manual-sod-ingestion.mjs";
import { normalizeSodAnalysisResult } from "../schwab-bridge/sod-analysis-provider.mjs";
import { buildCanonicalSodCandidateBundle } from "../schwab-bridge/sod-candidate-export.mjs";

function baseCandidate(overrides = {}) {
  return {
    candidateId: "trigger-NVDA-1",
    contractVersion: 1,
    schemaVersion: 1,
    source: "AD_HOC_CHATGPT",
    sourceDate: "2026-09-05",
    generatedAt: "2026-09-05T13:00:00.000Z",
    symbol: "NVDA",
    direction: "LONG",
    setup: "Breakout confirmation",
    thesis: "Continuation after objective confirmation",
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
      reason: "thesis invalid below structure",
    },
    managementContract: { mode: "FLEXIBLE_WITHIN_CEILING" },
    validity: {
      validFrom: "2026-09-05T13:30:00.000Z",
      validUntil: "2026-09-05T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "AUTO" },
    ...overrides,
  };
}

const clock = () => "2026-09-05T14:00:00.000Z";
const integrityError = error => error.code === "CANDIDATE_CONTRACT_INTEGRITY_ERROR";
function bundle(candidate) {
  return { source: candidate.source, bundleId: "d28", ingressPolicy: candidate.source === "SOD_A_PLUS_TRADES" ? "AUTOMATED_UNTOUCHED_ONLY" : "MANUAL_AUTHORIZED", candidates: [candidate] };
}
function harness(t, input = baseCandidate()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "decision28-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, "state.json");
  const store = new PreTradeStore({ filePath }); store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock });
  const outcome = ingress.importBundle(bundle(input)).outcomes[0];
  assert.equal(outcome.status, "ACCEPTED", JSON.stringify(outcome));
  const lifecycle = new PreTradeLifecycleCoordinator({ store, clock });
  const engine = new PreTradeTriggerEngine({ store, lifecycleCoordinator: lifecycle, clock });
  return { store, ingress, lifecycle, engine, filePath, candidate: () => store.state.candidates[0] };
}
function unchanged(h, hash) {
  assert.equal(h.candidate().contentHash, hash);
  assert.equal(verify(h.candidate()).contentHash, hash);
  assert.equal(candidateContractHash(h.candidate()), hash);
}
function command(h, extra = {}) {
  const c = h.candidate();
  return { candidateId: c.candidateId, contractVersion: c.contractVersion, expectedState: c.lifecycleState, expectedRevision: c.stateRevision, operationId: `op-${c.stateRevision}`, ...extra };
}
function quote(id, last) { return { type: "QUOTE_EVENT", evidenceId: id, observedAt: "2026-09-05T14:00:00.000Z", symbol: "NVDA", bid: last - .01, ask: last + .01, last }; }
function oldRecord(h) {
  const c = structuredClone(h.candidate());
  delete c.candidateIntegrityVersion; delete c.contractAuthority.integrity;
  c.contractAuthority.schemaVersion = 1;
  c.lifecycleJournal.events[0].metadata = null;
  return c;
}

test("A: admission records exact normalized sorted roots, version and bound original hash atomically", t => {
  const input = baseCandidate({ extension: { arbitrary: [null, false] } });
  const h = harness(t, input); const c = h.candidate();
  const normalized = normalizeCanonicalCandidateProposal(input, { bundleSource: input.source }).normalized;
  const i = c.contractAuthority.integrity;
  assert.deepEqual(i.roots, Object.keys(normalized).sort());
  assert.equal(new Set(i.roots).size, i.roots.length);
  assert.equal(i.version, 1); assert.equal(c.contractAuthority.schemaVersion, 2);
  for (const key of ["candidateId", "contractVersion", "schemaVersion", "contentHash"]) assert.equal(i.binding[key], c[key]);
  assert.equal(i.binding.authority, "CANONICAL_CANDIDATE_INGRESS");
  assert.equal(contentHash(normalized), c.contentHash);
  assert.deepEqual(canonicalCandidateContent(c), normalized);
  assert.equal(JSON.parse(fs.readFileSync(h.filePath)).candidates[0].contractAuthority.integrity.manifestHash, i.manifestHash);
});

for (const source of ["AD_HOC_CHATGPT", "SOD_A_PLUS_TRADES"]) {
  test(`B: ${source} optional roots protect full nested values, insertions, deletions and null`, t => {
    const h = harness(t, baseCandidate({ source, armPolicy: { requestedMode: "MANUAL" }, analysis: { status: null, permission: { authority: false }, levels: [{ x: 1 }] } }));
    for (const change of [c => c.analysis.levels[0].x++, c => c.analysis.newChild = true, c => delete c.analysis, c => delete c.analysis.status]) {
      const c = structuredClone(h.candidate()); change(c); assert.throws(() => verify(c), integrityError);
    }
    assert.ok(h.candidate().contractAuthority.integrity.roots.includes("analysis"));
  });
}

test("C/D/L: real trigger progress, second evidence, permission, expiration and terminal state survive restart with H", t => {
  const h = harness(t); const hash = h.candidate().contentHash;
  h.engine.processEvidence(command(h, { evidence: quote("q1", 98) }));
  assert.ok(h.candidate().triggerRuntime); unchanged(h, hash);
  h.store.load(); unchanged(h, hash);
  h.engine.recoverCandidate(h.candidate().candidateId, 1);
  h.engine.processEvidence(command(h, { evidence: { ...quote("q2", 100), observedAt: "2026-09-05T14:00:01.000Z" } }));
  assert.equal(h.candidate().lifecycleState, "PRETRADE_TRIGGER_EVALUATING"); unchanged(h, hash);
  h.engine.processEvidence(command(h, { evidence: { type: "BAR_CLOSE", evidenceId: "b1", observedAt: "2026-09-05T14:02:01.000Z", barTimestamp: "2026-09-05T14:02:00.000Z", symbol: "NVDA", timeframe: "2m", close: 101, complete: true } }));
  assert.ok(h.candidate().triggerSatisfaction); unchanged(h, hash);
  h.store.recordDssEvaluation({ dssEvaluationId: "d28-dss", status: "VALID", candidateId: h.candidate().candidateId, candidateContractVersion: 1, candidateContentHash: hash, sourceId: h.candidate().source }); unchanged(h, hash);
  h.lifecycle.publishPermissionOutcome(command(h, { outcome: "READY" })); unchanged(h, hash);
  const persistence = new PreTradeTriggerPersistenceAuthority({ store: h.store, clock });
  persistence.expireSatisfaction(command(h, { evidenceId: "expired", evidenceTimestamp: "2026-09-05T14:04:00.000Z", evidenceHash: "hash" }));
  assert.ok(h.candidate().lastTriggerSatisfactionExpiration); unchanged(h, hash);
  assert.equal(h.candidate().currentDssEvaluationStale, true);
  h.lifecycle.returnToWaiting(command(h, { operatorRequested: true }));
  assert.ok(h.candidate().lastDeactivation); unchanged(h, hash);
  h.lifecycle.expireCandidate(command(h)); assert.ok(h.candidate().terminalOutcome); unchanged(h, hash);
  h.store.load(); unchanged(h, hash);
  assert.ok(h.candidate().stateRevision > 5);
  assert.equal(h.candidate().lifecycleJournal.events[0].provenance.candidateContentHash, hash);
});

test("C/G: unregistered new runtime roots do not enlarge domain; ownership collision fails before writing", t => {
  const h = harness(t, baseCandidate({ futureRuntime: { inert: true } })); const hash = h.candidate().contentHash;
  h.candidate().unregisteredRuntime = { status: "RUNNING" }; unchanged(h, hash);
  assert.doesNotThrow(() => assertCandidateRuntimeRootOwnership(h.candidate(), "unregisteredRuntime"));
  assert.throws(() => assertCandidateRuntimeRootOwnership(h.candidate(), "futureRuntime"), integrityError);
  h.candidate().futureRuntime.runtimeChild = 1; assert.throws(() => verify(h.candidate()), integrityError);
});

for (const root of ["symbol", "direction", "trigger", "structuralInvalidation", "targets", "managementContract", "validity", "extension"]) {
  test(`E: immutable tampering fails for ${root}`, t => {
    const h = harness(t, baseCandidate({ extension: { x: 1 }, targets: [102] }));
    h.candidate()[root] = null; assert.throws(() => verify(h.candidate()), integrityError);
  });
}

test("F: all system roots reject by presence at canonical, manual, feeder, provider and export boundaries", t => {
  const h = harness(t);
  for (const root of SYSTEM_CANDIDATE_ROOTS) for (const value of [null, false, {}, []]) {
    const candidate = baseCandidate({ source: "SOD_A_PLUS_TRADES", [root]: value });
    assert.ok(normalizeCanonicalCandidateProposal(candidate, { bundleSource: candidate.source }).errors.some(e => e.includes(root)), root);
    try { assert.equal(h.ingress.importBundle(bundle(candidate)).outcomes[0].status, "REJECTED", root); }
    catch (error) { assert.equal(error.code, "FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL"); }
    const b = bundle(candidate);
    assert.ok(validateCandidateBundle(b, JSON.stringify(b)).some(e => e.includes(root)), root);
    assert.ok(validateManualIngestionEnvelope({ candidates: [candidate] }).some(e => e.includes(root)), root);
    assert.throws(() => normalizeSodAnalysisResult({ candidateProposals: [candidate] }), root);
    // Only the frozen export's WAITING/false intent placeholders are exempt.
    if (!["lifecycleState", "status", "armAuthorized"].includes(root)) {
      assert.throws(() => buildCanonicalSodCandidateBundle({ sourceDate: candidate.sourceDate, generatedAt: candidate.generatedAt, candidates: [candidate] }), root);
    }
  }
});

test("F: direct candidate HTTP API rejects forged new runtime roots without admission", async t => {
  const h = harness(t);
  const handler = createPreTradeCandidateApiHandler({ candidateIngress: h.ingress, lifecycleCoordinator: h.lifecycle });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const root of ["triggerRuntime", "lastDeactivation", "lastTriggerSatisfactionExpiration", "armRetirement", "terminalOutcome", "contractAuthority", "candidateIntegrityVersion"]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/candidates/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bundle(baseCandidate({ candidateId: root, [root]: null }))) });
    const result = await response.json();
    assert.equal(result.outcomes[0].status, "REJECTED", root);
  }
  assert.equal(h.store.state.candidates.length, 1);
});

for (const payload of ['{"__proto__":{"x":1}}', '{"extension":{"__proto__":{"x":1},"constructor":1,"prototype":[{"__proto__":null}]}}']) {
  test(`H: own special keys survive admission and every substantive change is hashed: ${payload}`, t => {
    const input = baseCandidate(JSON.parse(payload)); const h = harness(t, input);
    const projection = canonicalCandidateContent(h.candidate());
    assert.equal(Object.getPrototypeOf(canonicalJson(projection)), Object.prototype);
    assert.equal(Object.prototype.x, undefined);
    const root = Object.keys(JSON.parse(payload))[0];
    assert.ok(Object.hasOwn(projection, root));
    assert.deepEqual(projection[root], input[root]);
    const nestedTamper = structuredClone(h.candidate());
    if (root === "extension") {
      for (const key of ["__proto__", "constructor", "prototype"]) {
        const changed = structuredClone(nestedTamper);
        changed.extension[key] = { separatelyChanged: key };
        assert.throws(() => verify(changed), integrityError);
      }
    }
    h.candidate()[root] = { changed: true }; assert.throws(() => verify(h.candidate()), integrityError);
    assert.notEqual(contentHash(JSON.parse('{"__proto__":1}')), contentHash(JSON.parse('{"__proto__":2}')));
    assert.notEqual(contentHash({ a: [1, 2] }), contentHash({ a: [2, 1] }));
    assert.notEqual(contentHash({ a: null }), contentHash({}));
  });
}

const corruptions = {
  "missing manifest": c => delete c.contractAuthority.integrity,
  "duplicate admission anchors": c => c.lifecycleJournal.events.push(structuredClone(c.lifecycleJournal.events[0])),
  "unknown authority member": c => c.contractAuthority.forged = true,
  "missing binding": c => delete c.contractAuthority.integrity.binding,
  "admission provenance mismatch": c => c.lifecycleJournal.events[0].provenance.candidateSource = "FORGED",
  "missing roots": c => delete c.contractAuthority.integrity.roots,
  "duplicate roots": c => c.contractAuthority.integrity.roots.push(c.contractAuthority.integrity.roots[0]),
  "unsorted roots": c => c.contractAuthority.integrity.roots.reverse(),
  "unsupported version": c => c.contractAuthority.integrity.version++,
  "modified manifest": c => c.contractAuthority.integrity.roots.pop(),
  "contradictory hash": c => c.contractAuthority.contentHash = "bad",
  "identity mismatch": c => c.candidateId += "changed",
  "version mismatch": c => c.contractVersion++,
  "schema mismatch": c => c.schemaVersion++,
  "authority mismatch": c => c.contractAuthority.authority = "FORGED",
  "downgrade": c => { c.contractAuthority.schemaVersion = 1; delete c.contractAuthority.integrity; delete c.candidateIntegrityVersion; },
  "missing authority": c => delete c.contractAuthority,
  "missing acceptance anchor": c => c.lifecycleJournal.events = [],
  "changed domain with recomputed metadata": c => { const i = c.contractAuthority.integrity; i.roots.pop(); const { manifestHash, ...body } = i; i.manifestHash = contentHash(body); },
};
for (const [name, corrupt] of Object.entries(corruptions)) test(`I/L: ${name} fails on projection, verification and load`, t => {
  const h = harness(t); corrupt(h.candidate());
  assert.throws(() => verify(h.candidate()), integrityError);
  assert.throws(() => canonicalCandidateContent(h.candidate()), integrityError);
  fs.writeFileSync(h.filePath, JSON.stringify(h.store.state));
  assert.throws(() => new PreTradeStore({ filePath: h.filePath }).load(), integrityError);
});

test("J: explicit proof upgrade preserves hash, ID, version, revision, runtime and journal; reads do not upgrade", t => {
  const h = harness(t); h.lifecycle.activateCandidate(command(h, { activationMode: "MANUAL" }));
  const old = oldRecord(h); const before = structuredClone(old);
  verify(old); canonicalCandidateContent(old); assert.deepEqual(old, before);
  const upgraded = upgradeLegacyCanonicalCandidateIntegrity(old); verify(upgraded);
  const { contractAuthority, candidateIntegrityVersion, ...remaining } = upgraded;
  const { contractAuthority: oldAuthority, ...original } = old;
  assert.deepEqual(remaining, original);
  assert.equal(contractAuthority.contentHash, oldAuthority.contentHash);
  assert.equal(candidateIntegrityVersion, 1); assert.deepEqual(old, before);
});

test("J/G: tampered, unbound, unsupported, colliding and ambiguous old records never upgrade", t => {
  const h = harness(t);
  for (const change of [c => c.thesis = "tampered", c => c.lifecycleJournal.events = [], c => c.contractAuthority.schemaVersion = 99,
    c => { c.triggerRuntime = { originalOptional: true }; c.contentHash = candidateContractHash(c); c.contractAuthority.contentHash = c.contentHash; c.lifecycleJournal.events[0].provenance.candidateContentHash = c.contentHash; },
    c => { c.extension = JSON.parse('{"__proto__":{"invisibleToOldHash":1}}'); }]) {
    const c = oldRecord(h); change(c); assert.throws(() => upgradeLegacyCanonicalCandidateIntegrity(c), integrityError);
  }
});

test("K: lineage and supersession review use admitted domain after runtime history and protect special keys", t => {
  const input = baseCandidate({ source: "SOD_A_PLUS_TRADES", armPolicy: { requestedMode: "MANUAL" }, extension: JSON.parse('{"__proto__":{"x":1},"constructor":null}') });
  const h = harness(t, input); const substantive = candidateSubstantiveHash(h.candidate());
  h.lifecycle.activateCandidate(command(h, { activationMode: "MANUAL" }));
  h.lifecycle.returnToWaiting(command(h, { operatorRequested: true }));
  assert.equal(candidateSubstantiveHash(h.candidate()), substantive);
  assert.equal(candidateSubstantiveHash(canonicalCandidateContent(h.candidate())), substantive);
  const revised = baseCandidate({ ...input, contractVersion: 2, extension: JSON.parse('{"__proto__":{"x":2},"prototype":null}') });
  const result = h.ingress.createManualSupersessionReview({ ...bundle(revised), ingressPolicy: "MANUAL_AUTHORIZED" });
  assert.ok(JSON.stringify(result).includes("extension.__proto__.x"));
  assert.ok(JSON.stringify(result).includes("extension.constructor"));
  assert.ok(JSON.stringify(result).includes("extension.prototype"));
  const diff = result.reviews[0].substantiveDiff;
  assert.equal(diff.find(item => item.field === "extension.constructor" || item.path === "extension.constructor").proposedPresent, false);
  assert.equal(diff.find(item => item.field === "extension.prototype" || item.path === "extension.prototype").priorPresent, false);
  const unchangedLineage = resolveSodCandidateLineage({ ...input, generatedAt: "2026-09-05T13:05:00.000Z" }, [h.candidate()]);
  assert.equal(unchangedLineage.classification, "UNCHANGED");
  assert.equal(unchangedLineage.contractVersion, 1);
  assert.equal(resolveSodCandidateLineage(revised, [h.candidate()]).classification, "REVISED");
  verify(h.candidate());
});

test("L: failed admission save rolls back candidate and metadata together; restart retains only prior authority", t => {
  const h = harness(t); const before = h.store.snapshot();
  h.store.save = () => { throw new Error("injected write failure"); };
  assert.throws(() => h.ingress.importBundle(bundle(baseCandidate({ candidateId: "second" }))), /injected write failure/);
  assert.deepEqual(h.store.snapshot(), before);
  const restarted = new PreTradeStore({ filePath: h.filePath }); restarted.load();
  assert.deepEqual(restarted.snapshot(), before); verify(restarted.state.candidates[0]);
});


test("C/K: ARM and blocked-handoff retirement preserve H, journal and downstream proof across restart", t => {
  const h = harness(t); const hash = h.candidate().contentHash;
  h.engine.processEvidence(command(h, { evidence: quote("q-arm", 100) })); unchanged(h, hash);
  h.engine.processEvidence(command(h, { evidence: { type: "BAR_CLOSE", evidenceId: "b-arm", observedAt: "2026-09-05T14:02:01.000Z", barTimestamp: "2026-09-05T14:02:00.000Z", symbol: "NVDA", timeframe: "2m", close: 101, complete: true } })); unchanged(h, hash);
  h.store.recordDssEvaluation({ dssEvaluationId: "arm-dss", status: "VALID", candidateId: h.candidate().candidateId, candidateContractVersion: 1, candidateContentHash: hash, sourceId: h.candidate().source });
  h.lifecycle.publishPermissionOutcome(command(h, { outcome: "READY", permissionEvaluationId: "permission-arm" })); unchanged(h, hash);
  const authority = new PreTradeArmLifecycleAuthority({ store: h.store, clock });
  const armCommit = { authority: "PRETRADE_ARM_OPERATION", status: "AUTHORIZED", operationId: "arm-proof", candidateId: h.candidate().candidateId, contractVersion: 1, candidateContentHash: hash, symbol: "NVDA", direction: "LONG", reviewPackageId: "review-arm", permissionAttemptId: "permission-arm", permissionState: "READY", permissionStateRevision: h.candidate().stateRevision, dssEvaluationId: "arm-dss", riskEvaluationId: "arm-risk", accountId: "test-account", selectedQuantity: 1, authorizedAt: clock(), handoffId: "arm-handoff" };
  authority.authorizeFromCommit(command(h, { armCommit })); unchanged(h, hash);
  const pending = createPendingExecutionBoardHandoffDelivery({ handoffId: "arm-handoff", createdAt: clock() });
  const claimed = claimExecutionBoardHandoffDelivery(pending, { receiverId: "test-receiver", claimedAt: "2026-09-05T14:00:00.010Z" });
  const delivery = blockExecutionBoardHandoffDelivery(claimed, { receiverId: "test-receiver", reason: "BROKER_EXECUTION_COVERAGE_GAP", blockedAt: "2026-09-05T14:00:00.020Z" });
  authority.retireBlockedHandoff(command(h, { delivery })); unchanged(h, hash);
  assert.equal(h.candidate().lifecycleState, "RETIRED");
  assert.equal(h.candidate().terminalOutcome.state, "RETIRED");
  assert.equal(h.candidate().armRetirement.handoffId, "arm-handoff");
  const history = structuredClone(h.candidate().lifecycleJournal);
  h.store.load(); unchanged(h, hash);
  assert.deepEqual(h.candidate().lifecycleJournal, history);
  assert.equal(h.store.state.dssEvaluations[0].candidateContentHash, hash);
  assert.equal(armCommit.candidateContentHash, hash);
});

test("J/H: a matching historical incomplete __proto__ hash is insufficient proof for upgrade", t => {
  const h = harness(t, baseCandidate({ extension: JSON.parse('{"__proto__":{"old":1},"safe":true}') }));
  const c = oldRecord(h);
  const projection = normalizeCanonicalCandidateProposal(baseCandidate({ extension: c.extension }), { bundleSource: c.source }).normalized;
  // Reproduce the old defective hash strictly inside this regression fixture.
  function oldCanonical(value) {
    if (Array.isArray(value)) return value.map(oldCanonical);
    if (value && typeof value === "object") return Object.keys(value).sort().reduce((out, key) => { out[key] = oldCanonical(value[key]); return out; }, {});
    return value;
  }
  const oldHash = value => crypto.createHash("sha256").update(JSON.stringify(oldCanonical(value))).digest("hex");
  c.contentHash = oldHash(projection); c.contractAuthority.contentHash = c.contentHash;
  c.lifecycleJournal.events[0].provenance.candidateContentHash = c.contentHash;
  projection.extension.__proto__.old = 2;
  assert.equal(oldHash(projection), c.contentHash);
  assert.throws(() => upgradeLegacyCanonicalCandidateIntegrity(c), integrityError);
});

test("J: contradictory retained legacy admission operation fails explicit upgrade", t => {
  const h = harness(t); const c = oldRecord(h);
  c.lifecycleJournal.operations[0].contractVersion = 9;
  assert.throws(() => upgradeLegacyCanonicalCandidateIntegrity(c), integrityError);
  const wrongHash = oldRecord(h); wrongHash.lifecycleJournal.operations[0].operationHash = "forged";
  assert.throws(() => upgradeLegacyCanonicalCandidateIntegrity(wrongHash), integrityError);
});

test("K: real supersession retains prior manifest and H with supersession runtime history", t => {
  const input = baseCandidate({ source: "SOD_A_PLUS_TRADES", armPolicy: { requestedMode: "MANUAL" }, extension: { x: 1 } });
  const h = harness(t, input); const hash = h.candidate().contentHash;
  const roots = structuredClone(h.candidate().contractAuthority.integrity.roots);
  assert.equal(h.ingress.importBundle(bundle({ ...input, contractVersion: 2, extension: { x: 2 } })).outcomes[0].status, "ACCEPTED");
  unchanged(h, hash); assert.equal(h.candidate().lifecycleState, "SUPERSEDED");
  assert.deepEqual(h.candidate().contractAuthority.integrity.roots, roots);
  h.store.load(); unchanged(h, hash); verify(h.store.state.candidates[1]);
});

test("L: failure after temporary file write cannot commit partial admission on restart", t => {
  const h = harness(t); const before = h.store.snapshot(); const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === h.filePath) throw Object.assign(new Error("injected rename failure"), { code: "EIO" });
    return rename(from, to);
  });
  assert.throws(() => h.ingress.importBundle(bundle(baseCandidate({ candidateId: "second" }))), /injected rename failure/);
  assert.deepEqual(h.store.snapshot(), before);
  const uncommitted = JSON.parse(fs.readFileSync(`${h.filePath}.tmp`));
  assert.equal(uncommitted.candidates.length, 2);
  for (const candidate of uncommitted.candidates) verify(candidate);
  const restarted = new PreTradeStore({ filePath: h.filePath }); restarted.load();
  assert.deepEqual(restarted.snapshot(), before);
});
