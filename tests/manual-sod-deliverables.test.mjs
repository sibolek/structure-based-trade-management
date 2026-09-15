import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildManualSodIndividualCandidateBundles, writeManualSodIndividualCandidateFiles, validateManualSodIndividualCandidateJson } from "../schwab-bridge/manual-sod-deliverables.mjs";
import { buildCanonicalSodCandidateBundle } from "../schwab-bridge/sod-candidate-export.mjs";
import { publishCandidateBundleAtomically } from "../schwab-bridge/sod-candidate-publisher.mjs";
import { prepareManualCandidateImport } from "../src/pretrade/manual-candidate-import.js";
import { createPretradeApiClient } from "../src/pretrade/pretrade-api-client.js";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";
import { PreTradeLifecycleCoordinator } from "../schwab-bridge/pretrade-lifecycle-coordinator.mjs";
import { createPreTradeCandidateApiHandler } from "../schwab-bridge/pretrade-candidate-api.mjs";
import { candidateContractHash, assertCanonicalCandidateIntegrity, normalizeCanonicalCandidateProposal } from "../schwab-bridge/pretrade-candidate-contract.mjs";

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

// Each legacy defect is tested independently so one error cannot hide another.
const legacyCases = [
  ["status", c => { c.status = "WAITING"; }, /status is system-owned/],
  ["armAuthorized true", c => { c.armAuthorized = true; }, /armAuthorized is system-owned/],
  ["armAuthorized false", c => { c.armAuthorized = false; }, /armAuthorized is system-owned/],
  ["nested armPolicy.armAuthorized true", c => { c.armPolicy.armAuthorized = true; }, /armPolicy\.armAuthorized is system-owned/],
  ["nested armPolicy.armAuthorized false", c => { c.armPolicy.armAuthorized = false; }, /armPolicy\.armAuthorized is system-owned/],
  ["invalid schemaVersion", c => { c.schemaVersion = 0; }, /schemaVersion must be an integer >= 1/],
  ["timeframe conflict", c => { c.timeframe = "1h"; c.entryTimeframe = "2m"; }, /timeframe.*conflict/],
  ["free-text managementPlan", c => { c.managementPlan = "Take half at T1"; }, /managementPlan.*structured JSON object/],
  ["missing trigger", c => { delete c.trigger; }, /structured trigger object is required/],
  ["free-text trigger", c => { c.trigger = "Break above resistance"; }, /structured trigger object is required/],
  ["unsupported shorthand trigger", c => { c.trigger = { type: "OBSOLETE", description: "Unsupported trigger." }; }, /trigger: satisfaction\.type OBSOLETE is not supported/],
  ["missing invalidation", c => { delete c.structuralInvalidation; }, /structuralInvalidation/],
  ["free-text invalidation", c => { c.structuralInvalidation = "Below support"; }, /structuralInvalidation/],
  ["missing invalidation rule", c => { delete c.structuralInvalidation.rule; }, /structuralInvalidation.rule/],
  ["missing resolved invalidation price/reference", c => {
    delete c.structuralInvalidation.price;
    delete c.structuralInvalidation.referenceType;
    delete c.structuralInvalidation.reference;
  }, /structuralInvalidation requires a resolved price or structured reference definition/],
  ["missing management contract", c => { delete c.managementContract; }, /structured managementContract is required/],
  ["missing validity", c => { delete c.validity; }, /validity.validFrom/],
  ["local validFrom", c => { c.validity.validFrom = "2026-08-29T09:30:00"; }, /validity.validFrom.*absolute timestamp/],
  ["local validUntil", c => { c.validity.validUntil = "2026-08-29T16:00:00"; }, /validity.validUntil.*absolute timestamp/],
  ["malformed validFrom", c => { c.validity.validFrom = "not-a-dateZ"; }, /validity.validFrom/],
  ["malformed validUntil", c => { c.validity.validUntil = "2026-13-29T20:00:00Z"; }, /validity.validUntil/],
  ["reversed validity", c => { c.validity.validUntil = "2026-08-28T20:00:00Z"; }, /validUntil must be after/],
  ["equal validity", c => { c.validity.validUntil = c.validity.validFrom; }, /validUntil must be after/],
  ["invalid timezone", c => { c.validity.timezone = "Mountain-ish"; }, /validity.timezone.*IANA/],
  ["missing timezone", c => { delete c.validity.timezone; }, /validity.timezone.*IANA/],
  ["automatic ARM request", c => { c.armPolicy.requestedMode = "AUTO"; }, /MANUAL ARM review/],
  ["execution authority", c => { c.executionState = {}; }, /executionState is system-owned/],
  ["handoff authority", c => { c.handoff = {}; }, /handoff is system-owned/],
];

for (const [name, change, diagnostic] of legacyCases) {
  test(`manual delivery rejects ${name} through the current canonical contract before writing files`, t => {
    const input = bundle();
    const invalid = structuredClone(input.candidates[0]);
    invalid.candidateId = "legacy-sep15";
    change(invalid);
    const { errors } = normalizeCanonicalCandidateProposal(invalid, { bundleSource: input.source });
    assert.match(errors.join("; "), diagnostic);
    const before = JSON.stringify(invalid);
    const raw = JSON.stringify({ ...input, ingressPolicy: "MANUAL_AUTHORIZED", candidates: [invalid] });
    assert.throws(() => validateManualSodIndividualCandidateJson(raw), error => {
      assert.match(error.message, /candidates\[0\] \(legacy-sep15\)/);
      for (const reason of errors) assert.ok(error.message.includes(reason), reason);
      return true;
    });
    // A valid first candidate must not be emitted before a later failure.
    const output = path.join(directory(t), "not-created");
    assert.throws(() => writeManualSodIndividualCandidateFiles({
      ...input, candidates: [input.candidates[0], invalid],
    }, output), error => {
      assert.match(error.message, /candidates\[1\] \(legacy-sep15\)/);
      assert.match(error.message, diagnostic);
      return true;
    });
    assert.equal(fs.existsSync(output), false);
    assert.equal(JSON.stringify(invalid), before);
  });
}

test("delivery gate requires an already-manual individual canonical bundle, never implicit repair", () => {
  const input = { ...bundle(), ingressPolicy: "MANUAL_AUTHORIZED" };
  for (const altered of [
    input.candidates[0],
    { ...input, ingestionSchemaVersion: 1 },
    { ...input, ingressPolicy: undefined },
    { ...input, ingressPolicy: "AUTOMATED_UNTOUCHED_ONLY" },
    { ...input, candidates: [] },
    { ...input, candidates: [input.candidates[0], input.candidates[0]] },
    { ...input, candidates: [null] },
    { ...input, candidates: ["legacy"] },
  ]) {
    assert.throws(() => validateManualSodIndividualCandidateJson(JSON.stringify(altered)));
  }
  const duplicateKey = JSON.stringify(input).replace('"ingressPolicy":', '"ingressPolicy":"AUTOMATED_UNTOUCHED_ONLY","ingressPolicy":');
  assert.throws(() => validateManualSodIndividualCandidateJson(duplicateKey), /duplicate object key/);
  assert.throws(() => validateManualSodIndividualCandidateJson("{"), /Malformed JSON/);
});

test("CLI validation is deterministic, read-only and checks authored values without normalizing", t => {
  const dir = directory(t);
  const input = { ...bundle(), ingressPolicy: "MANUAL_AUTHORIZED" };
  const candidate = input.candidates[0];
  Object.assign(candidate, { symbol: "nvda", managementPlan: { notes: "Keep the author's exact content." } });
  Object.assign(candidate.validity, { validFrom: "2026-08-29T08:30:00-06:00", validUntil: "2026-08-29T14:00:00-06:00" });
  const bytes = JSON.stringify(input, null, 4) + "\n";
  const inputPath = path.join(dir, "candidate.json");
  fs.writeFileSync(inputPath, bytes);
  const cli = new URL("../schwab-bridge/manual-sod-deliverables.mjs", import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: "utf8" });
  const args = ["--validate-only", inputPath];
  const first = run(...args);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /VALID manual SOD file/);
  assert.equal(run(...args).stdout, first.stdout);
  assert.deepEqual(validateManualSodIndividualCandidateJson(bytes), input);
  assert.equal(fs.readFileSync(inputPath, "utf8"), bytes);
  assert.deepEqual(fs.readdirSync(dir), ["candidate.json"]);
  const [file] = writeManualSodIndividualCandidateFiles(input, path.join(dir, "packaged"));
  assert.deepEqual(validateManualSodIndividualCandidateJson(fs.readFileSync(file, "utf8")), input);

  candidate.status = "WAITING";
  const invalidBytes = JSON.stringify(input, null, 4);
  fs.writeFileSync(inputPath, invalidBytes);
  const rejected = run(...args);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /candidates\[0\].*status is system-owned/);
  assert.equal(rejected.stdout, "");
  assert.equal(fs.readFileSync(inputPath, "utf8"), invalidBytes);
  assert.equal(run("--validate-only").status, 2);
  assert.equal(run(...args, path.join(dir, "unexpected-output")).status, 2);
  assert.equal(fs.existsSync(path.join(dir, "unexpected-output")), false);
});

test("unfilled current repository template fails the delivery gate", () => {
  const raw = fs.readFileSync(new URL("../examples/ExecutionOS_MANUAL_SOD_individual_candidate_v24_template.json", import.meta.url), "utf8");
  assert.throws(() => validateManualSodIndividualCandidateJson(raw), /validity.validFrom/);
});

test("packaging validates final Preview size before writing any candidate files", t => {
  const input = bundle();
  // Candidate is valid; bundle metadata pushes the delivered file past Preview's limit.
  input.deliveryNotes = Array.from({ length: 14 }, () => "x".repeat(60 * 1024));
  const output = path.join(directory(t), "not-created");
  assert.throws(() => writeManualSodIndividualCandidateFiles(input, output), /768 KiB/);
  assert.equal(fs.existsSync(output), false);
});

test("manual confirmation shorthand is accepted by the authoritative validator and packaged unchanged", t => {
  const input = bundle();
  const candidate = input.candidates[0];
  candidate.trigger = { type: "MANUAL_CONFIRMATION", description: "Confirm the authored setup manually." };
  const before = structuredClone(input);
  const { normalized, errors } = normalizeCanonicalCandidateProposal(candidate, { bundleSource: input.source });
  assert.deepEqual(errors, []);
  assert.equal(normalized.trigger.satisfaction.type, "MANUAL_CONFIRMATION");
  assert.notDeepEqual(normalized.trigger, candidate.trigger);
  const expected = { ...before, ingressPolicy: "MANUAL_AUTHORIZED" };
  assert.deepEqual(validateManualSodIndividualCandidateJson(JSON.stringify(expected)), expected);
  const [file] = writeManualSodIndividualCandidateFiles(input, directory(t));
  assert.deepEqual(validateManualSodIndividualCandidateJson(fs.readFileSync(file, "utf8")), expected);
  assert.deepEqual(input, before);
});

test("a second candidate exceeding final Preview size reports its original index and ID before any writes", t => {
  const input = bundle();
  const second = structuredClone(input.candidates[0]);
  second.candidateId = "oversized-second-candidate";
  // Both candidates pass canonical limits; shared delivery metadata makes only
  // the second final file exceed Preview's 768 KiB limit.
  input.deliveryNotes = "x".repeat(60 * 1024);
  second.deliveryNotes = Array.from({ length: 12 }, () => "x".repeat(60 * 1024));
  input.candidates.push(second);
  const before = structuredClone(input);
  const individuals = buildManualSodIndividualCandidateBundles(input);
  assert.doesNotThrow(() => validateManualSodIndividualCandidateJson(JSON.stringify(individuals[0], null, 2)));
  assert.throws(() => validateManualSodIndividualCandidateJson(JSON.stringify(individuals[1], null, 2)), /JSON exceeds the 768 KiB limit/);
  const parent = directory(t);
  const output = path.join(parent, "not-created");
  assert.throws(() => writeManualSodIndividualCandidateFiles(input, output), error => {
    assert.match(error.message, /candidates\[1\] \(oversized-second-candidate\)/);
    assert.match(error.message, /JSON exceeds the 768 KiB limit/);
    assert.match(error.cause.message, /JSON exceeds the 768 KiB limit/);
    return true;
  });
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(fs.readdirSync(parent), []);
  assert.deepEqual(input, before);
});
