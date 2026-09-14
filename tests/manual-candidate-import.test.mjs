import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { prepareManualCandidateImport, parseCandidateJson, readCandidateJsonFile, MANUAL_IMPORT_MAX_BYTES } from "../src/pretrade/manual-candidate-import.js";
import { createPretradeApiClient } from "../src/pretrade/pretrade-api-client.js";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { createPreTradeCandidateApiHandler } from "../schwab-bridge/pretrade-candidate-api.mjs";
import { assertCanonicalCandidateIntegrity } from "../schwab-bridge/pretrade-candidate-contract.mjs";
import { SYSTEM_CANDIDATE_ROOTS } from "../schwab-bridge/candidate-integrity-roots.mjs";
import { preflightManualSubmission } from "../schwab-bridge/manual-sod-ingestion.mjs";
import { buildManualSodIngestionEnvelope } from "../schwab-bridge/sod-candidate-export.mjs";
import { manualCandidateFixture as candidate } from "./helpers/manual-candidate-fixture.mjs";

const clock = () => "2026-09-05T14:00:00.000Z";
async function harness(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-import-"));
  const store = new PreTradeStore({ filePath: path.join(dir, "state.json"), clock }); store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock });
  const lifecycle = new PreTradeLifecycleCoordinator({ store, clock });
  const handler = createPreTradeCandidateApiHandler({ candidateIngress: ingress, lifecycleCoordinator: lifecycle });
  const server = http.createServer(async (req, res) => { if (!await handler(req, res)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const client = createPretradeApiClient({ baseUrl: url });
  return { store, ingress, client, url, submit: value => client.importCandidateBundle(prepareManualCandidateImport(JSON.stringify(value)).body) };
}

test("standalone wrapper is deterministic, preserves candidate identity/content, and reuses manual source/policy", () => {
  const c = candidate(JSON.parse('{"extension":{"__proto__":{"x":1},"constructor":null}}'));
  const a = prepareManualCandidateImport(JSON.stringify(c));
  assert.deepEqual(a.body.candidates[0], c);
  assert.deepEqual(a, prepareManualCandidateImport(JSON.stringify(c, null, 2)));
  assert.equal(a.body.source, "AD_HOC_CHATGPT"); assert.equal(a.body.ingressPolicy, "MANUAL_AUTHORIZED");
  delete c.source; assert.equal(prepareManualCandidateImport(JSON.stringify(c)).body.source, "AD_HOC_CHATGPT");
  delete c.candidateId; assert.throws(() => prepareManualCandidateImport(JSON.stringify(c)));
});

test("one-candidate bundles retain supplied metadata; multiple candidates and automated supersession intent are refused", () => {
  const bundle = { source: "AD_HOC_CHATGPT", bundleId: "original", ingressPolicy: "MANUAL_AUTHORIZED", candidates: [candidate()] };
  assert.deepEqual(prepareManualCandidateImport(JSON.stringify(bundle)).body, bundle);
  assert.throws(() => prepareManualCandidateImport(JSON.stringify({ ...bundle, candidates: [candidate(), candidate()] })), /exactly one/);
  assert.throws(() => prepareManualCandidateImport(JSON.stringify({ ...bundle, ingressPolicy: "AUTOMATED_UNTOUCHED_ONLY" })), /MANUAL_AUTHORIZED/);
});

test("safe JSON parser rejects malformed input, code, decoded duplicates, nonfinite numbers and resource excess", () => {
  for (const raw of ['{"a":}', 'null trailing', 'export default {}', '```json\n{}\n```', '{"a":1,"\\u0061":2}', '{"x":[{"a":1,"a":2}]}', '{"a":1e999}', '['.repeat(50)+'0'+']'.repeat(50), JSON.stringify({ s: 'x'.repeat(65537) }), ' '.repeat(MANUAL_IMPORT_MAX_BYTES+1)]) assert.throws(() => parseCandidateJson(raw));
  const raw = '{"__proto__":{"polluted":true},"constructor":[null,false,2],"prototype":{}}';
  assert.deepEqual(parseCandidateJson(raw), JSON.parse(raw)); assert.equal(Object.prototype.polluted, undefined);
});

test("JSON files are size/extension checked before reading; valid files and pasted JSON parse identically", async () => {
  let reads = 0;
  const file = { name: "card.json", size: 3000, text: async () => { reads++; return JSON.stringify(candidate()); } };
  assert.deepEqual(prepareManualCandidateImport(await readCandidateJsonFile(file)), prepareManualCandidateImport(JSON.stringify(candidate())));
  await assert.rejects(readCandidateJsonFile({ ...file, name: "card.mjs" }), /\.json/);
  await assert.rejects(readCandidateJsonFile({ ...file, size: MANUAL_IMPORT_MAX_BYTES + 1 }), /768 KiB/);
  assert.equal(reads, 1);
});

test("real HTTP standalone import creates canonical WAITING/Decision 28; no ARM or Execution state", async t => {
  const h = await harness(t); const input = candidate({ extension: JSON.parse('{"__proto__":{"x":1},"status":"inert"}') });
  const result = await h.submit(input);
  assert.equal(result.outcomes[0].status, "ACCEPTED"); assert.equal(result.outcomes[0].lifecycleState, "WAITING");
  const c = h.store.state.candidates[0]; assert.equal(c.contractAuthority.integrity.version, 1);
  assert.ok(c.contractAuthority.integrity.roots.includes("extension")); assertCanonicalCandidateIntegrity(c);
  assert.equal(c.arm, null); assert.equal(c.armAuthorized, false); assert.equal(c.executionState, undefined); assert.equal(c.handoff, undefined);
  const hash = c.contentHash; h.store.load(); assert.equal(h.store.state.candidates[0].contentHash, hash);
  h.store.state.candidates[0].extension.__proto__.x++;
  assert.throws(() => assertCanonicalCandidateIntegrity(h.store.state.candidates[0]), { code: "CANDIDATE_CONTRACT_INTEGRITY_ERROR" });
});

test("real HTTP duplicate/conflict/newer-version results retain existing manual supersession authority", async t => {
  const h = await harness(t); await h.submit(candidate()); const before = structuredClone(h.store.state.candidates);
  assert.equal((await h.submit(candidate())).outcomes[0].status, "DUPLICATE");
  assert.equal((await h.submit(candidate({ thesis: "changed same version" }))).outcomes[0].status, "CONFLICT");
  assert.equal((await h.submit(candidate({ contractVersion: 2, thesis: "review this replacement" }))).outcomes[0].status, "ACTION_REQUIRED");
  assert.deepEqual(h.store.state.candidates, before);
  assert.equal(h.store.state.manualSupersessionAuthorizations.length, 0);
});

test("real HTTP canonical import rejects every Decision 28 system root by presence and cannot set ARM", async t => {
  const h = await harness(t);
  for (const root of SYSTEM_CANDIDATE_ROOTS) for (const value of [null, false, {}, []]) {
    try { assert.equal((await h.submit(candidate({ [root]: value }))).outcomes[0].status, "REJECTED", root); }
    catch (error) { assert.equal(error.code, "FORBIDDEN_SUPERSESSION_AUTHORITY_MATERIAL", root); }
  }
  assert.equal(h.store.state.candidates.length, 0);
  assert.equal((await h.submit(candidate({ structuralInvalidation: null }))).outcomes[0].status, "REJECTED");
});

function envelope(overrides = {}) {
  return buildManualSodIngestionEnvelope({ sourceDate: "2026-09-05", generatedAt: "2026-09-05T13:00:00Z", submissionId: "manual-card", bundleId: "manual-card-bundle", candidates: [candidate({ source: "SOD_A_PLUS_TRADES", ...overrides })] }, { clock, submissionType: "MANUAL_STANDALONE_TRADE_CARD" });
}

test("existing standalone export envelope imports unchanged through existing preflight, lineage and canonical ingress", async t => {
  const h = await harness(t); const e = envelope({ extension: { notes: ["manual"] } }); const before = structuredClone(e);
  const prepared = prepareManualCandidateImport(JSON.stringify(e)); assert.equal(prepared.kind, "manual-envelope"); assert.deepEqual(prepared.body, e);
  const result = await h.client.importManualEnvelope(prepared.body);
  assert.equal(result.outcomes[0].status, "ACCEPTED"); assert.equal(result.outcomes[0].lifecycleState, "WAITING");
  const c = h.store.state.candidates[0]; assert.equal(c.source, "SOD_A_PLUS_TRADES"); assert.equal(c.contractVersion, 1); assertCanonicalCandidateIntegrity(c);
  assert.equal(c.lifecycleJournal.events[0].provenance.ingressPolicy, "MANUAL_AUTHORIZED");
  assert.deepEqual(c.extension, { notes: ["manual"] }); assert.deepEqual(e, before);
  assert.equal((await h.client.importManualEnvelope(e)).outcomes[0].status, "DUPLICATE");
  const revised = envelope({ thesis: "manual revision requires review" });
  assert.equal((await h.client.importManualEnvelope(revised)).outcomes[0].status, "ACTION_REQUIRED");
  assert.equal(h.store.state.candidates.length, 1); assert.equal(h.store.state.manualSupersessionAuthorizations.length, 0);
});

test("manual envelope adapter rejects forged authority, malformed/duplicate JSON and multiple candidates", async t => {
  const h = await harness(t);
  for (const root of SYSTEM_CANDIDATE_ROOTS) {
    const e = envelope(); e.candidates[0][root] = false;
    assert.equal((await h.client.importManualEnvelope(e)).outcomes[0].status, "REJECTED", root);
  }
  const multi = envelope(); multi.candidates.push(structuredClone(multi.candidates[0]));
  assert.equal((await h.client.importManualEnvelope(multi)).outcomes[0].status, "REJECTED");
  for (const raw of ['{"source":"SOD_A_PLUS_TRADES","source":"AD_HOC_CHATGPT"}', '{', 'export default {}']) {
    const response = await fetch(h.url+'/api/candidates/manual-import', { method: "POST", headers: { "content-type": "application/json" }, body: raw });
    assert.equal(response.status, 400);
  }
  assert.equal(h.store.state.candidates.length, 0);
});

test("stored integrity corruption is surfaced by the same canonical API before further admission", async t => {
  const h = await harness(t); await h.submit(candidate()); h.store.state.candidates[0].symbol = "TAMPERED";
  await assert.rejects(h.submit(candidate({ candidateId: "other" })), { code: "CANDIDATE_CONTRACT_INTEGRITY_ERROR" });
  assert.equal(h.store.state.candidates.length, 1);
});


test("manual envelope replacement requires and then consumes existing exact supersession approval", async t => {
  const h = await harness(t); await h.client.importManualEnvelope(envelope());
  const revised = envelope({ thesis: "replacement reviewed through existing PRETRADE authority" });
  assert.equal((await h.client.importManualEnvelope(revised)).outcomes[0].status, "ACTION_REQUIRED");
  assert.equal(h.store.state.candidates.length, 1);
  const canonical = preflightManualSubmission(revised, h.store.snapshot().candidates).canonicalBundle;
  const review = h.ingress.createManualSupersessionReview(canonical).reviews[0];
  h.ingress.authorizeManualSupersession({ reviewId: review.reviewId, operatorConfirmed: true });
  const result = await h.client.importManualEnvelope(revised);
  assert.equal(result.outcomes[0].status, "ACCEPTED");
  assert.equal(result.outcomes[0].contractVersion, 2);
  assert.equal(h.store.state.candidates[0].lifecycleState, "SUPERSEDED");
  assert.equal(h.store.state.candidates[1].lifecycleState, "WAITING");
  assert.ok(h.store.state.manualSupersessionAuthorizations[0].consumedAt);
  for (const c of h.store.state.candidates) { assertCanonicalCandidateIntegrity(c); assert.equal(c.arm, null); }
});
