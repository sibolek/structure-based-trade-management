import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildManualSodIndividualCandidateBundles, writeManualSodIndividualCandidateFiles } from "../schwab-bridge/manual-sod-deliverables.mjs";
import { buildCanonicalSodCandidateBundle } from "../schwab-bridge/sod-candidate-export.mjs";
import { publishCandidateBundleAtomically } from "../schwab-bridge/sod-candidate-publisher.mjs";
import { prepareManualCandidateImport } from "../src/pretrade/manual-candidate-import.js";
import { createPretradeApiClient } from "../src/pretrade/pretrade-api-client.js";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { createPreTradeCandidateApiHandler } from "../schwab-bridge/pretrade-candidate-api.mjs";
import { candidateContractHash, assertCanonicalCandidateIntegrity } from "../schwab-bridge/pretrade-candidate-contract.mjs";

const fixtureUrl = new URL("../fixtures/v24-sod-candidates.example.json", import.meta.url);
const clock = () => "2026-08-29T15:00:00.000Z";
function bundle() {
  const input = JSON.parse(fs.readFileSync(fixtureUrl, "utf8"));
  Object.assign(input.candidates[0], {
    riskPolicy: { maxPlannedLossPctOfAccountEquity: 0.5, sizeFromStructuralStop: true, tightenStopToFitRisk: false, onRiskFailure: "REDUCE_SIZE_OR_PASS" },
    sourceProvenance: { source: "START_OF_DAY_REPORT", report: "manual-sod-original" },
    extension: JSON.parse('{"__proto__":{"source":"untouched"},"notes":[null,false,"original"]}'),
  });
  return buildCanonicalSodCandidateBundle(input);
}
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sod-deliverables-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("manual individual files contain the policy from generation and preserve every candidate value", t => {
  const dir = directory(t); const input = bundle();
  input.candidates.push({ ...structuredClone(input.candidates[0]), candidateId: "second-candidate", symbol: "MSFT" });
  const before = JSON.stringify(input);
  const files = writeManualSodIndividualCandidateFiles(input, dir);
  assert.equal(files.length, 2);
  for (const [index, file] of files.entries()) {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(parsed.ingressPolicy, "MANUAL_AUTHORIZED");
    assert.equal(parsed.candidates.length, 1);
    assert.equal(JSON.stringify(parsed.candidates[0]), JSON.stringify(input.candidates[index]));
    assert.deepEqual(parsed, { ...input, ingressPolicy: "MANUAL_AUTHORIZED", candidates: [input.candidates[index]] });
    assert.equal(candidateContractHash(parsed.candidates[0]), candidateContractHash(input.candidates[index]));
    assert.equal(Object.hasOwn(parsed.candidates[0], "ingressPolicy"), false);
    const prepared = prepareManualCandidateImport(fs.readFileSync(file, "utf8"));
    assert.equal(prepared.kind, "canonical");
    assert.deepEqual(prepared.body, parsed);
  }
  assert.equal(JSON.stringify(input), before);
  const firstBytes = fs.readFileSync(files[0], "utf8");
  assert.throws(() => writeManualSodIndividualCandidateFiles(input, dir), { code: "EEXIST" });
  assert.equal(fs.readFileSync(files[0], "utf8"), firstBytes);
});

test("manual packaging refuses automated policies, envelopes and invalid candidates instead of rewriting them", t => {
  const dir = directory(t);
  const input = bundle();
  for (const ingressPolicy of ["AUTOMATED_UNTOUCHED_ONLY", "UNKNOWN", null]) {
    assert.throws(() => writeManualSodIndividualCandidateFiles({ ...input, ingressPolicy }, dir), /cannot relabel/);
  }
  assert.throws(() => buildManualSodIndividualCandidateBundles({ ...input, ingestionSchemaVersion: 1 }), /completed canonical/);
  assert.throws(() => buildManualSodIndividualCandidateBundles({ ...input, source: "AD_HOC_CHATGPT" }), /completed canonical/);
  for (const change of [{ source: "AD_HOC_CHATGPT" }, { sourceDate: "2026-08-28" }, { armAuthorized: true }, { structuralInvalidation: null }]) {
    assert.throws(() => writeManualSodIndividualCandidateFiles({ ...input, candidates: [input.candidates[0], { ...input.candidates[0], ...change }] }, dir));
  }
  assert.throws(() => buildManualSodIndividualCandidateBundles({ ...input, candidates: [input.candidates[0], input.candidates[0]] }), /unique/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("already-manual input stays intact and no-candidate manual reports emit no import files", t => {
  const input = { ...bundle(), ingressPolicy: "MANUAL_AUTHORIZED" };
  assert.deepEqual(buildManualSodIndividualCandidateBundles(input), [input]);
  const output = buildManualSodIndividualCandidateBundles(input);
  output[0].candidates[0].sourceProvenance.source = "changed copy";
  assert.equal(input.candidates[0].sourceProvenance.source, "START_OF_DAY_REPORT");
  assert.deepEqual(writeManualSodIndividualCandidateFiles({ ...input, candidates: [] }, directory(t)), []);
});

test("manual package CLI writes ready-to-import files and leaves the combined artifact byte-identical", t => {
  const dir = directory(t); const inputPath = path.join(dir, "combined.json");
  const bytes = JSON.stringify(bundle(), null, 4) + "\n";
  fs.writeFileSync(inputPath, bytes);
  const output = path.join(dir, "individual");
  const result = spawnSync(process.execPath, [new URL("../schwab-bridge/manual-sod-deliverables.mjs", import.meta.url).pathname, inputPath, output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(inputPath, "utf8"), bytes);
  const files = fs.readdirSync(output); assert.equal(files.length, 1);
  assert.equal(prepareManualCandidateImport(fs.readFileSync(path.join(output, files[0]), "utf8")).body.ingressPolicy, "MANUAL_AUTHORIZED");
});

test("generated manual file uses real canonical HTTP admission: ACCEPTED/WAITING then DUPLICATE with no execution authority", async t => {
  const dir = directory(t); const input = bundle();
  const [file] = writeManualSodIndividualCandidateFiles(input, path.join(dir, "individual"));
  const prepared = prepareManualCandidateImport(fs.readFileSync(file, "utf8"));
  const store = new PreTradeStore({ filePath: path.join(dir, "state.json"), clock }); store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock });
  const lifecycleCoordinator = new PreTradeLifecycleCoordinator({ store, clock });
  const handler = createPreTradeCandidateApiHandler({ candidateIngress: ingress, lifecycleCoordinator });
  const requests = [];
  const server = http.createServer(async (req, res) => {
    requests.push([req.method, req.url]);
    if (!await handler(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const client = createPretradeApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  const accepted = await client.importCandidateBundle(prepared.body);
  assert.equal(accepted.outcomes[0].status, "ACCEPTED");
  assert.equal(accepted.outcomes[0].lifecycleState, "WAITING");
  const admitted = store.snapshot().candidates[0];
  assertCanonicalCandidateIntegrity(admitted);
  assert.equal(admitted.contentHash, candidateContractHash(input.candidates[0]));
  for (const key of ["candidateId", "source", "sourceDate", "trigger", "structuralInvalidation", "targets", "riskPolicy", "sourceProvenance", "extension"]) {
    assert.deepEqual(admitted[key], input.candidates[0][key], key);
  }
  assert.equal(admitted.lifecycleState, "WAITING");
  assert.equal(admitted.armAuthorized, false); assert.equal(admitted.arm, null);
  for (const key of ["handoff", "executionState", "brokerWriteAuthority", "brokerAuthority"]) assert.equal(admitted[key], undefined, key);
  assert.equal(admitted.authorizedDssEvaluationId, null);
  assert.equal(admitted.authorizedRiskEvaluationId ?? null, null);
  assert.equal(admitted.selectedQuantity ?? null, null);
  assert.deepEqual(store.snapshot().manualSupersessionAuthorizations, []);
  assert.equal(admitted.lifecycleJournal.events[0].provenance.ingressPolicy, "MANUAL_AUTHORIZED");
  const beforeRetry = store.snapshot().candidates;
  const retry = await client.importCandidateBundle(prepared.body);
  assert.equal(retry.outcomes[0].status, "DUPLICATE");
  assert.deepEqual(store.snapshot().candidates, beforeRetry);
  assert.deepEqual(requests, [["POST", "/api/candidates/import"], ["POST", "/api/candidates/import"]]);
  // This harness has only PRETRADE storage/ingress/lifecycle; no execution or broker provider is instantiated.
  assert.deepEqual(fs.readdirSync(dir).sort(), ["individual", "state.json"]);
});

test("combined exports and automated publication bytes retain their existing policy and payload", async t => {
  const dir = directory(t); const input = bundle();
  const combined = buildCanonicalSodCandidateBundle(input);
  assert.equal(Object.hasOwn(combined, "ingressPolicy"), false);
  const automated = buildCanonicalSodCandidateBundle(input, { automatedPublication: true });
  const expected = { schemaVersion: combined.schemaVersion, source: combined.source, sourceDate: combined.sourceDate,
    generatedAt: combined.generatedAt, bundleId: combined.bundleId, ingressPolicy: "AUTOMATED_UNTOUCHED_ONLY", candidates: combined.candidates };
  assert.deepEqual(automated, expected);
  const before = `${JSON.stringify(expected, null, 2)}\n`;
  writeManualSodIndividualCandidateFiles(combined, path.join(dir, "individual"));
  assert.equal(Object.hasOwn(combined, "ingressPolicy"), false);
  assert.deepEqual(buildCanonicalSodCandidateBundle({ ...input, ingressPolicy: "MANUAL_AUTHORIZED" }, { automatedPublication: true }), expected);
  assert.deepEqual(buildCanonicalSodCandidateBundle(input), combined);
  const publication = await publishCandidateBundleAtomically({ inboxPath: dir, bundle: automated, idFactory: () => "offline-automated-regression" });
  assert.equal(fs.readFileSync(publication.finalPath, "utf8"), before);
  assert.equal(fs.readFileSync(publication.finalPath, "utf8").includes("MANUAL_AUTHORIZED"), false);
});

test("manual individual template produces a valid import bundle after authoring placeholders", t => {
  const raw = fs.readFileSync(new URL("../examples/ExecutionOS_MANUAL_SOD_individual_candidate_v24_template.json", import.meta.url), "utf8")
    .replaceAll("YYYY-MM-DDTHH:MM:SS.sssZ", "2026-08-29T14:30:00.000Z")
    .replace('"validFrom": "YYYY-MM-DDTHH:MM:SSZ"', '"validFrom": "2026-08-29T14:30:00Z"')
    .replace('"validUntil": "YYYY-MM-DDTHH:MM:SSZ"', '"validUntil": "2026-08-29T20:00:00Z"')
    .replaceAll("YYYY-MM-DD", "2026-08-29");
  const input = JSON.parse(raw);
  const [file] = writeManualSodIndividualCandidateFiles(input, directory(t));
  assert.deepEqual(prepareManualCandidateImport(fs.readFileSync(file, "utf8")).body, input);
});
