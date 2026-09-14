import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createSodRunStore, sodRequestHash } from "../schwab-bridge/sod-run-store.mjs";
import { createSodProductionRunner, sodPretradeFingerprint } from "../schwab-bridge/sod-production-run.mjs";
import { buildSodAnalysisRequest } from "../schwab-bridge/sod-analysis-provider.mjs";
import { parseOpenAiSodResponse } from "../schwab-bridge/sod-openai-analysis-provider.mjs";
import { createOpenAiSodProductionProvider } from "../schwab-bridge/sod-openai-production-provider.mjs";
import { SOD_RESEARCH_DIAGNOSTIC_LIMITS } from "../schwab-bridge/sod-research-diagnostics.mjs";
import { SOD_CANDIDATE_DIAGNOSTIC_LIMITS } from "../schwab-bridge/sod-candidate-diagnostics.mjs";
import { buildCanonicalSodCandidateBundle } from "../schwab-bridge/sod-candidate-export.mjs";
import { buildCanonicalContractAuthority, candidateContractHash } from "../schwab-bridge/pretrade-candidate-contract.mjs";
import { transportResult, apiResponse, normalizedRequest, resolvedChart } from "./helpers/sod-openai-fixture.mjs";
const death = () => Object.assign(new Error("simulated crash"), { simulateProcessDeath: true });
const source = () => parseOpenAiSodResponse({ response: apiResponse(), request: normalizedRequest(), resolvedCharts: [resolvedChart()], model: "test" });
function prior(result = source(), changes = {}) {
  const c = buildCanonicalSodCandidateBundle({ sourceDate: "2026-09-10", generatedAt: "2026-09-10T13:20:00Z", bundleId: "prior", candidates: result.candidateProposals }, { automatedPublication: true }).candidates[0];
  const hash = candidateContractHash(c);
  return { ...c, contentHash: hash, contractAuthority: buildCanonicalContractAuthority({ contentHash: hash, bundleSource: "SOD_A_PLUS_TRADES", bundleId: "prior", acceptedAt: "2026-09-10T13:21:00Z" }), lifecycleState: "WAITING", stateRevision: 0, ...changes };
}
async function fixture(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sod-integrity-"));
  const inbox = path.join(dir, "inbox"); await fs.mkdir(inbox);
  const root = path.join(dir, "runs");
  let store = createSodRunStore({ rootPath: root });
  const counts = { provider: 0, reads: 0 };
  const state = { snapshot: { candidates: [] }, result: source(), checkpoint: options.checkpoint || (async () => {}) };
  const provider = { async generate() { counts.provider++; await options.onProvider?.(state); return state.result; } };
  const make = () => createSodProductionRunner({ store, provider, inboxPath: inbox, chartStore: { resolve: async () => resolvedChart() },
    readPretrade: async () => { counts.reads++; await options.onRead?.(state, counts); return structuredClone(state.snapshot); },
    checkpoint: async (...args) => state.checkpoint(...args) });
  let runner = make();
  t.after(async () => { store.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { root, inbox, counts, state, get store() { return store; }, get runner() { return runner; },
    request: { ...normalizedRequest(), runId: crypto.randomUUID() },
    restart() { store.close(); store = createSodRunStore({ rootPath: root }); runner = make(); },
  };
}
test("request hash covers complete normalized substance and excludes run/session identifiers", () => {
  const a = buildSodAnalysisRequest({ ...normalizedRequest(), runId: crypto.randomUUID(), sessionToken: "secret", marketContext: { a: 1, b: 2 } });
  const b = buildSodAnalysisRequest({ ...normalizedRequest(), runId: crypto.randomUUID(), sessionToken: "different", marketContext: { b: 2, a: 1 } });
  assert.equal(sodRequestHash(a), sodRequestHash(b));
  for (const key of ["sourceDate", "generationMode", "charts", "marketContext", "priorSodRef"]) {
    const altered = structuredClone(a); altered[key] = key === "charts" ? [...a.charts, a.charts[0]] : "changed";
    assert.notEqual(sodRequestHash(a), sodRequestHash(altered), key);
  }
});
test("durable root mandatory; unsafe root and second local writer fail closed", async t => {
  assert.throws(() => createSodRunStore(), { code: "SOD_RUN_STORE_ROOT_REQUIRED" });
  const f = await fixture(t);
  assert.throws(() => createSodRunStore({ rootPath: f.root }), { code: "SOD_RUN_STORE_WRITER_CONFLICT" });
  const link = `${f.root}-link`; await fs.symlink(f.root, link);
  assert.throws(() => createSodRunStore({ rootPath: link }), { code: "SOD_RUN_STORE_UNSAFE" });
});
test("durable claim conflicts do not mutate state or invoke provider", async t => {
  const f = await fixture(t); const request = buildSodAnalysisRequest(f.request);
  const claim = f.store.claim(f.request.runId, request);
  assert.deepEqual(f.store.claim(f.request.runId, request), claim);
  assert.throws(() => f.store.claim(f.request.runId, { ...request, priorSodRef: "different" }), { code: "SOD_RUN_REQUEST_HASH_CONFLICT" });
  assert.throws(() => f.store.claim(crypto.randomUUID(), request), e => e.code === "SOD_RUN_ACTIVE_CONFLICT" && e.activeRun.runId === claim.runId && e.activeRun.stage === "CLAIMED");
  assert.deepEqual(f.store.state(claim.runId), claim); assert.equal(f.counts.provider, 0);
});
test("concurrent duplicate delivery shares one provider call and per-date competing run fails", async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { onProvider: () => gate });
  const first = f.runner.generate(f.request), duplicate = f.runner.generate(f.request);
  await assert.rejects(f.runner.generate({ ...f.request, runId: crypto.randomUUID() }), { code: "SOD_RUN_ACTIVE_CONFLICT" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counts.provider, 1); release();
  assert.deepEqual(await duplicate, await first);
  assert.equal((await fs.readdir(f.inbox)).length, 1);
});
test("terminal success and lost HTTP response replay identical durable result after restart", async t => {
  const f = await fixture(t); const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "SUCCESS"); assert.equal(result.status, "READY_TO_PUBLISH");
  f.restart();
  assert.deepEqual(await f.runner.generate(f.request), result);
  assert.equal(f.counts.provider, 1); assert.equal((await fs.readdir(f.inbox)).length, 1);
  await assert.rejects(f.runner.generate({ ...f.request, generationMode: "REFRESH" }), { code: "SOD_RUN_REQUEST_HASH_CONFLICT" });
  assert.equal((await f.runner.generate({ ...f.request, runId: crypto.randomUUID() })).stage, "SUCCESS");
  assert.equal(f.counts.provider, 2);
});
for (const stage of ["NO_CANDIDATES", "PRETRADE_PREFLIGHT_REQUIRED"]) test(`terminal ${stage} is replayed without provider or publication`, async t => {
  const f = await fixture(t);
  if (stage === "NO_CANDIDATES") f.state.result.candidateProposals = [];
  else { const original = source(); f.state.snapshot.candidates = [prior(original)]; f.state.result.candidateProposals[0].thesis = "Revised thesis"; }
  const result = await f.runner.generate(f.request); assert.equal(result.stage, stage);
  f.restart(); assert.deepEqual(await f.runner.generate(f.request), result);
  assert.equal(f.counts.provider, 1); assert.deepEqual(await fs.readdir(f.inbox), []);
});
test("provider start crash becomes ambiguous; claim retained until explicit abandonment", async t => {
  const f = await fixture(t, { checkpoint: async stage => { if (stage === "PROVIDER_REQUEST_STARTED") throw death(); } });
  await assert.rejects(f.runner.generate(f.request), /simulated crash/); f.restart();
  assert.equal(f.runner.status(f.request.runId).stage, "RECOVERY_REQUIRED");
  assert.equal((await f.runner.generate(f.request)).reason, "PROVIDER_OUTCOME_AMBIGUOUS");
  await assert.rejects(f.runner.generate({ ...f.request, runId: crypto.randomUUID() }), { code: "SOD_RUN_ACTIVE_CONFLICT" });
  const before = await fs.readdir(path.join(f.root, "runs", f.request.runId));
  assert.equal(f.runner.abandon(f.request.runId).stage, "ABANDONED");
  assert.equal((await fs.readdir(path.join(f.root, "runs", f.request.runId))).length, before.length + 1);
  assert.equal((await f.runner.generate(f.request)).stage, "ABANDONED");
  f.state.checkpoint = async () => {};
  assert.equal((await f.runner.generate({ ...f.request, runId: crypto.randomUUID() })).stage, "SUCCESS");
  assert.equal(f.counts.provider, 1);
});
test("network failure after request start remains ambiguous without an automatic retry", async t => {
  const f = await fixture(t, { onProvider: async () => { throw Object.assign(new Error("secret"), { code: "SOD_OPENAI_NETWORK_FAILED" }); } });
  const result = await f.runner.generate(f.request); assert.equal(result.stage, "RECOVERY_REQUIRED");
  assert.equal((await f.runner.generate(f.request)).stage, "RECOVERY_REQUIRED"); assert.equal(f.counts.provider, 1);
});

test("production transport timeout diagnostics survive durable replay, with no downstream work", async t => {
  const f = await fixture(t);
  let calls = 0, reads = 0;
  const provider = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "secret", EXECUTIONOS_SOD_OPENAI_MODEL: "test", EXECUTIONOS_SOD_OPENAI_TIMEOUT_MS: "20" },
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return new Response(new ReadableStream({ start(c) {
        c.enqueue(new TextEncoder().encode('{"id":'));
        const timer = setTimeout(() => c.error(new Error("test deadline")), 1000);
        signal.addEventListener("abort", () => { clearTimeout(timer); c.error(new Error("secret")); }, { once: true });
      } }), { headers: { "x-request-id": "req_durable" } });
    } });
  const runner = createSodProductionRunner({ store: f.store, provider, inboxPath: f.inbox,
    chartStore: { resolve: async () => resolvedChart() }, readPretrade: async () => { reads++; return { candidates: [] }; } });
  const result = await runner.generate(f.request);
  assert.equal(result.stage, "RECOVERY_REQUIRED"); assert.equal(result.failureCode, null);
  assert.equal(result.providerDiagnostics.errorCode, "SOD_OPENAI_TIMEOUT");
  assert.equal(result.providerDiagnostics.phase, "BODY_READING");
  assert.equal(result.providerDiagnostics.requestId, "req_durable");
  assert.equal(result.providerDiagnostics.headersObserved, true);
  assert.equal(result.providerDiagnostics.applicationAbortObserved, true);
  assert.equal(result.providerDiagnostics.exceptionClass, "Error");
  assert.equal(result.providerDiagnostics.causeClass, "OTHER");
  assert.equal(result.providerDiagnostics.transportCode, "OTHER");
  assert.equal(result.providerDiagnostics.causeChain.length, 1);
  assert.match(result.providerDiagnostics.nodeVersion, /^v\d+/);
  assert.match(result.providerDiagnostics.undiciVersion, /^\d+/);
  const dir = path.join(f.root, "runs", result.runId);
  const before = await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n))));
  assert.equal(JSON.parse(before[1]).data.provider.timeoutMs, 20);
  assert.doesNotMatch(before.join(""), /secret/);
  assert.deepEqual(await runner.generate(f.request), result);
  await assert.rejects(runner.generate({ ...f.request, runId: crypto.randomUUID() }), e => e.code === "SOD_RUN_ACTIVE_CONFLICT" && e.activeRun.sourceDate === f.request.sourceDate);
  f.restart(); assert.deepEqual(f.runner.status(result.runId), result);
  assert.deepEqual(await f.runner.generate(f.request), result);
  assert.deepEqual(await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n)))), before);
  assert.equal(calls, 1); assert.equal(reads, 0);
  assert.deepEqual(await fs.readdir(path.join(f.root, "artifacts")), []);
  assert.deepEqual(await fs.readdir(f.inbox), []);
  assert.equal(f.runner.abandon(result.runId).stage, "ABANDONED");
  assert.deepEqual(await Promise.all((await fs.readdir(dir)).sort().slice(0, 3).map(n => fs.readFile(path.join(dir, n)))), before);
  assert.equal((await f.runner.generate(f.request)).stage, "ABANDONED");
  assert.equal((await f.runner.generate({ ...f.request, runId: crypto.randomUUID() })).stage, "SUCCESS");
  assert.equal(calls, 1);
});

test("legacy ambiguity journals replay without adding diagnostics or rewriting history", async t => {
  const f = await fixture(t);
  f.store.claim(f.request.runId, buildSodAnalysisRequest(f.request));
  f.store.append(f.request.runId, "PROVIDER_REQUEST_STARTED");
  f.store.append(f.request.runId, "RECOVERY_REQUIRED", { reason: "PROVIDER_OUTCOME_AMBIGUOUS" });
  const dir = path.join(f.root, "runs", f.request.runId);
  const before = await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n))));
  f.restart();
  assert.equal(f.runner.status(f.request.runId).providerDiagnostics, undefined);
  assert.equal((await f.runner.generate(f.request)).stage, "RECOVERY_REQUIRED");
  assert.deepEqual(await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n)))), before);
  assert.equal(f.counts.provider, 0);
});

test("seven-chart historical date survives claim, transport and durable zero-candidate validation", async t => {
  const f = await fixture(t);
  const charts = Array.from({ length: 7 }, (_, i) => i ? { ...f.request.charts[0], chartId: `chart-${i}`, contentRef: `sod-chart:chart-${i}` } : f.request.charts[0]);
  const request = { ...f.request, sourceDate: "2026-09-11", charts };
  let calls = 0, reads = 0;
  const provider = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: "test", EXECUTIONOS_SOD_OPENAI_MODEL: "test" },
    fetchImpl: async (_url, { body }) => {
      calls++; const payload = JSON.parse(body);
      assert.equal(payload.store, false); assert.equal(payload.text.format.strict, true);
      assert.match(payload.input[0].content[0].text, /"sourceDate": "2026-09-11"/);
      assert.equal(payload.input[0].content.filter(c => c.type === "input_image").length, 7);
      return new Response(JSON.stringify(apiResponse(transportResult({ candidateProposals: [] }))));
    } });
  const runner = createSodProductionRunner({ store: f.store, provider, inboxPath: f.inbox,
    chartStore: { resolve: async ref => resolvedChart(charts.find(c => c.contentRef === ref)) },
    readPretrade: async () => { reads++; return { candidates: [] }; } });
  for (const sourceDate of [undefined, null, "", "2026-02-30"]) {
    await assert.rejects(runner.generate({ ...request, sourceDate }), { code: "SOD_ANALYSIS_SOURCE_DATE_INVALID" });
  }
  assert.equal(calls, 0); assert.deepEqual(await fs.readdir(path.join(f.root, "runs")), []);
  const result = await runner.generate(request);
  assert.equal(result.sourceDate, "2026-09-11"); assert.equal(result.stage, "NO_CANDIDATES");
  assert.equal(result.requestHash, sodRequestHash(buildSodAnalysisRequest(request)));
  assert.notEqual(result.requestHash, sodRequestHash(buildSodAnalysisRequest({ ...request, sourceDate: "2026-09-13" })));
  assert.equal(f.store.getArtifact(result.providerResultHash).generationMetadata.chartCount, 7);
  assert.equal(calls, 1); assert.equal(reads, 2); assert.deepEqual(await fs.readdir(f.inbox), []);
  await assert.rejects(runner.generate({ ...request, sourceDate: "2026-09-13" }), { code: "SOD_RUN_REQUEST_HASH_CONFLICT" });
});
for (const stage of ["PROVIDER_RESULT_DURABLE", "PRETRADE_SNAPSHOT_ACQUIRED", "PREPARED", "PUBLICATION_INTENT_RECORDED", "FILESYSTEM_PUBLICATION", "PUBLICATION_COMMITTED"]) {
  test(`crash at ${stage} recovers durable provider result and one exact publication`, async t => {
    let crashed = false;
    const f = await fixture(t, { checkpoint: async current => { if (current === stage && !crashed) { crashed = true; throw death(); } } });
    await assert.rejects(f.runner.generate(f.request), /simulated crash/);
    const before = f.store.state(f.request.runId); const intended = before.intent;
    const visible = await fs.readdir(f.inbox);
    assert.equal(visible.filter(n => n.endsWith(".json")).length, ["FILESYSTEM_PUBLICATION", "PUBLICATION_COMMITTED"].includes(stage) ? 1 : 0);
    f.restart(); const reads = f.counts.reads;
    const result = await f.runner.generate(f.request);
    assert.equal(result.stage, "SUCCESS", result.failureCode);
    assert.equal(f.counts.provider, 1);
    if (stage !== "PUBLICATION_COMMITTED") assert.ok(f.counts.reads > reads);
    if (intended) assert.equal(result.publication.finalName, intended.finalName);
    assert.equal((await fs.readdir(f.inbox)).filter(n => n.endsWith(".json")).length, 1);
    assert.equal(result.providerResultHash, before.providerResultHash);
  });
}
test("post-provider PRETRADE mutation uses fresh lineage and blocks stale NEW", async t => {
  const f = await fixture(t, { onProvider: state => { state.snapshot.candidates = [prior()]; state.result.candidateProposals[0].thesis = "Revised"; } });
  const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "PRETRADE_PREFLIGHT_REQUIRED"); assert.equal(result.lineage[0].classification, "REVISED");
  assert.deepEqual(await fs.readdir(f.inbox), []); assert.equal(f.counts.provider, 1);
});
test("PRETRADE mutation after preparation recomputes from durable result without provider", async t => {
  let mutate = true;
  const f = await fixture(t, { checkpoint: async stage => {
    if (stage === "PREPARED" && mutate) { mutate = false; f.state.snapshot.candidates = [prior()]; }
  } });
  const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "SUCCESS"); assert.equal(result.lineage[0].classification, "UNCHANGED");
  assert.equal(f.counts.provider, 1); assert.equal((await fs.readdir(f.inbox)).length, 1);
});
test("fence rechecks lifecycle/revision change and can finish with same immutable bundle", async t => {
  let mutate = true;
  const f = await fixture(t, { checkpoint: async stage => {
    if (stage === "PUBLICATION_INTENT_RECORDED" && mutate) { mutate = false; f.state.snapshot.candidates[0].stateRevision++; }
  } });
  f.state.snapshot.candidates = [prior()];
  const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "SUCCESS"); assert.equal(f.counts.provider, 1); assert.ok(f.counts.reads >= 4);
});
test("recovery discards stale persisted PRETRADE snapshot", async t => {
  const f = await fixture(t, { checkpoint: async stage => { if (stage === "PREPARED") throw death(); } });
  await assert.rejects(f.runner.generate(f.request), /simulated crash/);
  f.restart(); f.state.checkpoint = async () => {}; const original = source(); original.candidateProposals[0].thesis = "Different prior";
  f.state.snapshot.candidates = [prior(original)];
  const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "PRETRADE_PREFLIGHT_REQUIRED"); assert.equal(f.counts.provider, 1); assert.deepEqual(await fs.readdir(f.inbox), []);
});
test("continuous PRETRADE churn is bounded and never publishes", async t => {
  const f = await fixture(t, { onRead: state => { state.snapshot.candidates[0].stateRevision++; } });
  f.state.snapshot.candidates = [prior()]; const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "FAILED"); assert.equal(result.failureCode, "SOD_PRETRADE_CHANGED_DURING_PREPARATION");
  assert.equal(f.counts.provider, 1); assert.equal(f.counts.reads, 6); assert.deepEqual(await fs.readdir(f.inbox), []);
});
test("conflicting bytes at exact intended filename fail closed without new publication", async t => {
  const f = await fixture(t, { checkpoint: async stage => { if (stage === "PUBLICATION_INTENT_RECORDED") throw death(); } });
  await assert.rejects(f.runner.generate(f.request), /simulated crash/);
  const intent = f.store.state(f.request.runId).intent;
  await fs.writeFile(path.join(f.inbox, intent.finalName), "conflicting bytes");
  f.restart(); f.state.checkpoint = async () => {};
  const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "FAILED"); assert.equal(result.failureCode, "SOD_PUBLICATION_RECOVERY_CONFLICT");
  assert.equal(f.counts.provider, 1); assert.equal((await fs.readdir(f.inbox)).length, 1);
});
test("provider result hash tampering fails closed at restart", async t => {
  const f = await fixture(t, { checkpoint: async stage => { if (stage === "PROVIDER_RESULT_DURABLE") throw death(); } });
  await assert.rejects(f.runner.generate(f.request), /simulated crash/);
  const hash = f.store.state(f.request.runId).providerResultHash;
  await fs.writeFile(path.join(f.root, "artifacts", `${hash}.json`), "{}");
  assert.throws(() => f.restart(), { code: "SOD_RUN_ARTIFACT_HASH_MISMATCH" });
});
test("journal rejects impossible transition and tampered event chain", async t => {
  const f = await fixture(t); const claim = f.store.claim(f.request.runId, buildSodAnalysisRequest(f.request));
  assert.throws(() => f.store.append(claim.runId, "SUCCESS"), { code: "SOD_RUN_TRANSITION_INVALID" });
  assert.throws(() => f.runner.abandon(claim.runId), { code: "SOD_RUN_ABANDON_NOT_ELIGIBLE" });
  const file = path.join(f.root, "runs", claim.runId, "00000001.json");
  const event = JSON.parse(await fs.readFile(file)); event.data.sourceDate = "2026-09-11"; await fs.writeFile(file, JSON.stringify(event));
  assert.throws(() => f.restart(), { code: "SOD_RUN_STORE_CORRUPT" });
});
test("sanitized provider metadata and errors never persist raw credentials or paths", async t => {
  const f = await fixture(t);
  f.state.result.generationMetadata = { ...f.state.result.generationMetadata,
    authorization: "Bearer secret", apiKey: "secret", headers: { secret: true }, path: "/private/secret", responseId: "unsafe /private/secret" };
  const result = await f.runner.generate(f.request); assert.equal(result.stage, "SUCCESS");
  const durable = JSON.stringify(f.store.getArtifact(result.providerResultHash));
  assert.doesNotMatch(durable, /Bearer secret|apiKey|\/private\/secret|authorization/);
});
test("fingerprint covers candidate version/hash/lifecycle/revision and supersession identity", () => {
  const c = prior(), base = sodPretradeFingerprint({ candidates: [c] }, source().candidateProposals);
  for (const key of ["contractVersion", "contentHash", "lifecycleState", "stateRevision", "supersededBy", "currentVersion"]) {
    assert.notEqual(sodPretradeFingerprint({ candidates: [{ ...c, [key]: "changed" }] }, source().candidateProposals), base, key);
  }
});

test("final authority fence also catches PRETRADE mutation during filesystem preparation", async t => {
  let mutate = true;
  const f = await fixture(t, { checkpoint: async stage => {
    if (stage === "BEFORE_PUBLICATION_FENCE" && mutate) { mutate = false; f.state.snapshot.candidates[0].stateRevision++; }
  } });
  f.state.snapshot.candidates = [prior()];
  const result = await f.runner.generate(f.request);
  assert.equal(result.stage, "SUCCESS"); assert.equal(f.counts.provider, 1);
  assert.equal((await fs.readdir(f.inbox)).length, 1); assert.ok(f.counts.reads >= 6);
});
test("readiness stays false without evidence, binds durable opt-in evidence to configured provider/model", async t => {
  const f = await fixture(t);
  const configured = { providerIdentity: "openai", providerVersion: 1, model: "test", readiness: () => ({ providerConfigured: true }) };
  assert.equal(f.store.liveAcceptanceValidated(configured), false);
  const result = await f.runner.generate(f.request);
  assert.equal(f.store.liveAcceptanceValidated(configured), false, "ordinary generation never asserts live acceptance");
  // Test-only evidence exercises the store mechanism; it is not retained as real acceptance.
  const evidence = f.store.recordLiveAcceptance(result.runId, configured);
  assert.equal(evidence.providerResultHash, result.providerResultHash);
  assert.equal(f.store.liveAcceptanceValidated(configured), true);
  assert.equal(f.store.liveAcceptanceValidated({ ...configured, model: "another-model" }), false);
  assert.equal(f.store.liveAcceptanceValidated({ ...configured, providerVersion: 2 }), false);
  assert.equal(f.store.liveAcceptanceValidated({ ...configured, readiness: () => ({ providerConfigured: false }) }), false);
  f.restart(); assert.equal(f.store.liveAcceptanceValidated(configured), true);
});

test("actual dead writer process is reclaimed and provider-start journal becomes ambiguous", async t => {
  const { spawnSync } = await import("node:child_process");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sod-dead-process-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const id = crypto.randomUUID();
  const moduleUrl = new URL("../schwab-bridge/sod-run-store.mjs", import.meta.url).href;
  const code = `import {createSodRunStore} from ${JSON.stringify(moduleUrl)}; const store=createSodRunStore({rootPath:process.argv[1]}); store.claim(process.argv[2],JSON.parse(process.argv[3])); store.append(process.argv[2],"PROVIDER_REQUEST_STARTED"); process.exit(0);`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", code, dir, id, JSON.stringify(normalizedRequest())], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  const store = createSodRunStore({ rootPath: dir });
  try { assert.equal(store.state(id).stage, "RECOVERY_REQUIRED"); assert.equal(store.state(id).reason, "PROVIDER_OUTCOME_AMBIGUOUS"); }
  finally { store.close(); }
});

test("one run writer is shared across service instances using the same durable store", async t => {
  const f = await fixture(t);
  const second = createSodProductionRunner({ store: f.store, provider: { generate: async () => { throw new Error("second provider forbidden"); } }, chartStore: {}, inboxPath: f.inbox, readPretrade: async () => ({ candidates: [] }) });
  const firstResult = f.runner.generate(f.request);
  const secondResult = second.generate(f.request);
  assert.deepEqual(await secondResult, await firstResult); assert.equal(f.counts.provider, 1);
});

test("startup rejects two valid durable active claims for the same sourceDate", async t => {
  const f = await fixture(t);
  const first = f.store.claim(f.request.runId, buildSodAnalysisRequest(f.request));
  const secondId = crypto.randomUUID();
  const event = JSON.parse(await fs.readFile(path.join(f.root, "runs", first.runId, "00000001.json")));
  delete event.hash; event.runId = secondId;
  const record = { ...event, hash: sodRequestHash(event) };
  await fs.mkdir(path.join(f.root, "runs", secondId));
  await fs.writeFile(path.join(f.root, "runs", secondId, "00000001.json"), JSON.stringify(record));
  assert.throws(() => f.restart(), { code: "SOD_RUN_STORE_SPLIT_BRAIN" });
});

test("production HTTP parser through durable runner publishes once and replays without transport", async t => {
  const { createOpenAiSodProductionProvider, OPENAI_RESPONSES_URL } = await import("../schwab-bridge/sod-openai-production-provider.mjs");
  const f = await fixture(t);
  let calls = 0, reads = 0;
  const provider = createOpenAiSodProductionProvider({
    env: { OPENAI_API_KEY: "offline-test-key", EXECUTIONOS_SOD_OPENAI_MODEL: "test" },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, OPENAI_RESPONSES_URL);
      assert.equal(f.store.state(f.request.runId).stage, "PROVIDER_REQUEST_STARTED");
      assert.equal(JSON.parse(options.body).store, false);
      return new Response(JSON.stringify(apiResponse()), { status: 200 });
    },
  });
  const runner = createSodProductionRunner({ store: f.store, provider,
    chartStore: { resolve: async () => resolvedChart() }, inboxPath: f.inbox,
    readPretrade: async () => { reads++; assert.ok(f.store.state(f.request.runId).providerResultHash); return { candidates: [] }; },
  });
  const result = await runner.generate(f.request);
  assert.equal(result.stage, "SUCCESS"); assert.equal(calls, 1); assert.equal(reads, 3);
  assert.deepEqual(await runner.generate(f.request), result);
  assert.equal(calls, 1); assert.equal(reads, 3);
  const durable = f.store.getArtifact(result.providerResultHash);
  assert.equal(durable.generationMetadata.localValidation, true);
  assert.doesNotMatch(JSON.stringify(durable), /offline-test-key|authorization/);
  assert.equal(f.store.liveAcceptanceValidated(provider), false, "offline HTTP simulation is not live acceptance");
  assert.equal((await fs.readdir(f.inbox)).length, 1);
});

test("production section-order failure is durable FAILED and replay never retries or publishes", async t => {
  const { createOpenAiSodProductionProvider } = await import("../schwab-bridge/sod-openai-production-provider.mjs");
  const f = await fixture(t);
  const transport = transportResult({ candidateProposals: [] });
  [transport.artifactContent.sections[5], transport.artifactContent.sections[6]] =
    [transport.artifactContent.sections[6], transport.artifactContent.sections[5]];
  let calls = 0, reads = 0;
  const provider = createOpenAiSodProductionProvider({
    env: { OPENAI_API_KEY: "offline-test-key", EXECUTIONOS_SOD_OPENAI_MODEL: "test" },
    fetchImpl: async () => {
      calls++;
      assert.equal(f.store.state(f.request.runId).stage, "PROVIDER_REQUEST_STARTED");
      return new Response(JSON.stringify(apiResponse(transport)), { status: 200 });
    },
  });
  const makeRunner = () => createSodProductionRunner({ store: f.store, provider,
    chartStore: { resolve: async () => resolvedChart() }, inboxPath: f.inbox,
    readPretrade: async () => { reads++; return { candidates: [] }; },
  });
  const runner = makeRunner();
  const result = await runner.generate(f.request);
  assert.equal(result.stage, "FAILED");
  assert.equal(result.failureCode, "SOD_OPENAI_ARTIFACT_SECTION_ORDER_INVALID");
  assert.equal(result.providerResultHash, null);
  assert.equal(result.reason, null);
  const journalDir = path.join(f.root, "runs", f.request.runId);
  const journal = await Promise.all((await fs.readdir(journalDir)).sort().map(name => fs.readFile(path.join(journalDir, name), "utf8")));
  assert.deepEqual(journal.map(raw => JSON.parse(raw).stage), ["CLAIMED", "PROVIDER_REQUEST_STARTED", "FAILED"]);
  assert.deepEqual(await runner.generate(f.request), result);
  f.restart();
  assert.deepEqual(await makeRunner().generate(f.request), result);
  assert.equal(calls, 1);
  assert.equal(reads, 0);
  assert.deepEqual(await fs.readdir(f.inbox), []);
  assert.deepEqual(await fs.readdir(path.join(f.root, "artifacts")), []);
  const replayJournal = await Promise.all((await fs.readdir(journalDir)).sort().map(name => fs.readFile(path.join(journalDir, name), "utf8")));
  assert.deepEqual(replayJournal, journal);
});

test("research mismatch diagnostics are durable FAILED evidence, never a provider-result artifact", async t => {
  const f = await fixture(t);
  const transport = transportResult({ candidateProposals: [] });
  transport.researchEvidence[0].sourceUrls = ['https://secret-host.example/private-path?api_key=secret-query#secret-fragment'];
  transport.researchEvidence[0].value = 'private unrestricted model prose';
  const response = apiResponse(transport);
  response.output[0].action.sources.push({ url: 'https://example.com/actual?token=secret-search-token' });
  let calls = 0, reads = 0;
  const provider = createOpenAiSodProductionProvider({ env: { OPENAI_API_KEY: 'secret-api-key', EXECUTIONOS_SOD_OPENAI_MODEL: 'test' },
    fetchImpl: async () => {
      calls++; return new Response(JSON.stringify(response), { headers: { 'x-request-id': 'req_semantic_safe', 'authorization': 'Bearer secret-header', 'set-cookie': 'secret-cookie' } });
    } });
  const make = () => createSodProductionRunner({ store: f.store, provider, chartStore: { resolve: async () => resolvedChart() }, inboxPath: f.inbox,
    readPretrade: async () => { reads++; return { candidates: [] }; } });
  const result = await make().generate(f.request);
  assert.equal(result.stage, 'FAILED'); assert.equal(result.reason, null);
  assert.equal(result.failureCode, 'SOD_OPENAI_RESEARCH_SOURCE_MISMATCH');
  assert.equal(result.providerResultHash, null);
  assert.equal(result.providerDiagnostics.requestId, 'req_semantic_safe');
  assert.equal(result.providerDiagnostics.phase, 'RESPONSE_PARSED');
  assert.equal(result.providerDiagnostics.semantic.validatorStage, 'RESEARCH_SOURCE_MEMBERSHIP');
  assert.equal(result.providerDiagnostics.semantic.mismatches[0].reason, 'SOURCE_NOT_IN_WEB_SEARCH_SET');
  assert.ok(Buffer.byteLength(JSON.stringify(result.providerDiagnostics.semantic)) <= SOD_RESEARCH_DIAGNOSTIC_LIMITS.bytes);
  const dir = path.join(f.root, 'runs', f.request.runId);
  const journal = await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n), 'utf8')));
  assert.deepEqual(journal.map(raw => JSON.parse(raw).stage), ['CLAIMED', 'PROVIDER_REQUEST_STARTED', 'FAILED']);
  assert.doesNotMatch(journal.join(''), /secret-|private-path|unrestricted model prose|api_key|Bearer|authorization|set-cookie/);
  assert.deepEqual(JSON.parse(journal[2]).data.providerDiagnostics, result.providerDiagnostics);
  assert.deepEqual(await make().generate(f.request), result);
  f.restart(); assert.deepEqual(await make().generate(f.request), result);
  assert.deepEqual(await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n), 'utf8'))), journal);
  assert.equal(calls, 1); assert.equal(reads, 0);
  assert.deepEqual(await fs.readdir(f.inbox), []);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'artifacts')), []);
  assert.throws(() => f.runner.abandon(f.request.runId), { code: 'SOD_RUN_ABANDON_NOT_ELIGIBLE' });
});

test("candidate semantic diagnostics are durable FAILED evidence without PRETRADE or publication", async t => {
  const { createOpenAiSodProductionProvider } = await import("../schwab-bridge/sod-openai-production-provider.mjs");
  const f = await fixture(t);
  const transport = transportResult();
  transport.candidateProposals[0].validity.timezone = "Invalid/Timezone";
  const provider = createOpenAiSodProductionProvider({
    env: { OPENAI_API_KEY: "offline-test-key", EXECUTIONOS_SOD_OPENAI_MODEL: "test" },
    fetchImpl: async () => new Response(JSON.stringify(apiResponse(transport)), {
      status: 200, headers: { "x-request-id": "req_candidate_durable" },
    }),
  });
  let reads = 0;
  const runner = createSodProductionRunner({ store: f.store, provider,
    chartStore: { resolve: async () => resolvedChart() }, inboxPath: f.inbox,
    readPretrade: async () => { reads++; return { candidates: [] }; },
  });
  const result = await runner.generate(f.request);
  assert.equal(result.stage, "FAILED");
  assert.equal(result.failureCode, "SOD_OPENAI_CANDIDATE_SEMANTICS_INVALID");
  assert.equal(result.providerResultHash, null);
  assert.equal(result.providerDiagnostics.requestId, "req_candidate_durable");
  assert.equal(result.providerDiagnostics.semantic.validatorStage, "CANONICAL_CANDIDATE_COMPATIBILITY");
  assert.equal(result.providerDiagnostics.semantic.violations[0].ruleCode, "VALIDITY_TIMEZONE");
  assert.ok(Buffer.byteLength(JSON.stringify(result.providerDiagnostics.semantic)) <= SOD_CANDIDATE_DIAGNOSTIC_LIMITS.bytes);
  const dir = path.join(f.root, "runs", f.request.runId);
  const journal = await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n), "utf8")));
  assert.deepEqual(journal.map(raw => JSON.parse(raw).stage), ["CLAIMED", "PROVIDER_REQUEST_STARTED", "FAILED"]);
  assert.equal(reads, 0);
  assert.deepEqual(await fs.readdir(f.inbox), []);
  assert.deepEqual(await fs.readdir(path.join(f.root, "artifacts")), []);
  assert.deepEqual(JSON.parse(journal[2]).data.providerDiagnostics, result.providerDiagnostics);
  assert.deepEqual(await runner.generate(f.request), result);
  f.restart();
  assert.deepEqual(f.runner.status(f.request.runId), result);
  assert.deepEqual(await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n), "utf8"))), journal);
});

test("old FAILED journal without semantic diagnostics replays byte-for-byte unchanged", async t => {
  const f = await fixture(t);
  f.store.claim(f.request.runId, buildSodAnalysisRequest(f.request));
  f.store.append(f.request.runId, 'PROVIDER_REQUEST_STARTED');
  f.store.append(f.request.runId, 'FAILED', { failureCode: 'SOD_OPENAI_RESEARCH_SOURCE_MISMATCH',
    providerDiagnostics: { errorCode: 'SOD_OPENAI_RESEARCH_SOURCE_MISMATCH', phase: 'RESPONSE_PARSED', requestId: 'req_legacy_safe' } });
  const dir = path.join(f.root, 'runs', f.request.runId);
  const before = await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n))));
  const original = f.runner.status(f.request.runId);
  f.restart(); assert.deepEqual(await f.runner.generate(f.request), original);
  assert.equal(f.runner.status(f.request.runId).providerDiagnostics.semantic, undefined);
  assert.deepEqual(await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n)))), before);
  assert.equal(f.counts.provider, 0); assert.equal(f.counts.reads, 0);
});

test("old candidate FAILED journal without semantic diagnostics replays unchanged", async t => {
  const f = await fixture(t);
  f.store.claim(f.request.runId, buildSodAnalysisRequest(f.request));
  f.store.append(f.request.runId, "PROVIDER_REQUEST_STARTED");
  f.store.append(f.request.runId, "FAILED", { failureCode: "SOD_OPENAI_CANDIDATE_SEMANTICS_INVALID",
    providerDiagnostics: { errorCode: "SOD_OPENAI_CANDIDATE_SEMANTICS_INVALID", phase: "RESPONSE_PARSED", requestId: "req_legacy_candidate" } });
  const dir = path.join(f.root, "runs", f.request.runId);
  const before = await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n))));
  const original = f.runner.status(f.request.runId);
  f.restart();
  assert.deepEqual(await f.runner.generate(f.request), original);
  assert.equal(f.runner.status(f.request.runId).providerDiagnostics.semantic, undefined);
  assert.deepEqual(await Promise.all((await fs.readdir(dir)).sort().map(n => fs.readFile(path.join(dir, n)))), before);
  assert.equal(f.counts.provider, 0);
  assert.equal(f.counts.reads, 0);
});
