import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { writeManualTradeCardAnalysis } from "../schwab-bridge/manual-trade-card-analysis.mjs";
import { writeManualTradeCardPackage } from "../schwab-bridge/manual-trade-card-package.mjs";
import { validateManualSodIndividualCandidateJson } from "../schwab-bridge/manual-sod-deliverables.mjs";
import { prepareManualCandidateImport } from "../src/pretrade/manual-candidate-import.js";
import { PreTradeStore } from "../schwab-bridge/pretrade-state.mjs";
import { PreTradeCandidateIngress } from "../schwab-bridge/pretrade-candidate-ingress.mjs";

function input() {
  const { candidates, ...bundleMetadata } = JSON.parse(fs.readFileSync(new URL("../fixtures/v24-sod-candidates.example.json", import.meta.url), "utf8"));
  const c = candidates[0];
  c.context.standaloneTradeCard = true;
  c.context.notes = JSON.parse('{"__proto__":{"inert":true},"values":[null,false,0,"—"]}');
  return { artifactContent: { html: `<!doctype html><html><head><style>body{background:#101827;color:#fff}h1{font-size:32px}</style></head><body><h1>${c.symbol} — ${c.setup}</h1><p>${c.thesis}</p></body></html>\n` }, candidateProposals: [c], bundleMetadata };
}
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-card-package-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function assertHtml(result, analysis) {
  assert.equal(fs.readFileSync(result.htmlPath, "utf8"), analysis.artifactContent.html);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.candidateDeliveryStatusPath, "utf8")), result.candidateDelivery);
}
function assertWithheld(result, analysis, reason) {
  assertHtml(result, analysis);
  assert.equal(result.candidateDelivery.status, "WITHHELD");
  assert.equal(result.candidateDelivery.reason, reason);
  assert.deepEqual(result.candidateDelivery.files, []);
  assert.deepEqual(fs.readdirSync(path.dirname(result.htmlPath)).sort(), ["candidate-delivery-status.json", "trade-card.html"]);
}

test("transport to package preserves standalone HTML and exact candidate values through the authoritative manual gate", async t => {
  const analysis = input(); const before = structuredClone(analysis); const dir = directory(t);
  const transport = writeManualTradeCardAnalysis(analysis, "2026-08-29", "NVDA", path.join(dir, "transport"));
  const result = await writeManualTradeCardPackage(JSON.parse(fs.readFileSync(transport, "utf8")), path.join(dir, "package"));
  assertHtml(result, analysis);
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  assert.equal(result.candidateDelivery.files.length, 1);
  const raw = fs.readFileSync(result.candidateDelivery.files[0], "utf8");
  const bundle = validateManualSodIndividualCandidateJson(raw);
  assert.deepEqual(bundle, { ...analysis.bundleMetadata, ingressPolicy: "MANUAL_AUTHORIZED", candidates: analysis.candidateProposals });
  assert.deepEqual(prepareManualCandidateImport(raw).body, bundle);
  assert.deepEqual(analysis, before);
  assert.equal(fs.readdirSync(path.dirname(result.htmlPath)).length, 3);
});

test("all services offline: HTML and validated candidate require no network, service startup or automatic import", async t => {
  const attempts = [];
  const offline = () => { attempts.push("service"); throw new Error("PRETRADE/Schwab/Execution Board/broker offline"); };
  t.mock.method(globalThis, "fetch", offline);
  for (const transport of [http, https]) for (const method of ["request", "get"]) t.mock.method(transport, method, offline);
  t.mock.method(net.Socket.prototype, "connect", offline);
  t.mock.method(net.Server.prototype, "listen", offline);
  t.mock.method(PreTradeCandidateIngress.prototype, "importBundle", offline);
  t.mock.method(PreTradeStore.prototype, "load", offline);
  const analysis = input();
  const result = await writeManualTradeCardPackage(analysis, path.join(directory(t), "package"));
  assertHtml(result, analysis);
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  assert.deepEqual(attempts, []);
});

for (const mode of ["missing gate", "missing contract", "broken validator"]) {
  test(`${mode}: isolated package CLI still delivers identical HTML`, t => {
    const dir = directory(t); const runtime = path.join(dir, "runtime"); fs.mkdirSync(runtime);
    for (const name of ["manual-output-paths.mjs", "manual-trade-card-package.mjs", "manual-trade-card-analysis.mjs"]) fs.copyFileSync(new URL(`../schwab-bridge/${name}`, import.meta.url), path.join(runtime, name));
    if (mode === "missing contract") fs.copyFileSync(new URL("../schwab-bridge/manual-sod-deliverables.mjs", import.meta.url), path.join(runtime, "manual-sod-deliverables.mjs"));
    if (mode === "broken validator") fs.writeFileSync(path.join(runtime, "manual-sod-deliverables.mjs"), 'throw new Error("Validator initialization failed");');
    const analysis = input(); const file = path.join(dir, "analysis.json"); fs.writeFileSync(file, JSON.stringify(analysis));
    const run = spawnSync(process.execPath, [path.join(runtime, "manual-trade-card-package.mjs"), file, path.join(dir, "package")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assertWithheld(JSON.parse(run.stdout), analysis, "VALIDATOR_UNAVAILABLE");
  });
}

for (const defect of ["invalid contract", "authority", "automated policy", "oversized file", "date mismatch"]) {
  test(`${defect}: HTML succeeds and all candidate output is withheld`, async t => {
    const analysis = input();
    if (defect === "invalid contract") delete analysis.candidateProposals[0].structuralInvalidation;
    if (defect === "authority") analysis.candidateProposals[0].armAuthorized = false;
    if (defect === "automated policy") analysis.bundleMetadata.ingressPolicy = "AUTOMATED_UNTOUCHED_ONLY";
    if (defect === "date mismatch") analysis.bundleMetadata.sourceDate = "2026-08-30";
    if (defect === "oversized file") analysis.candidateProposals[0].notes = Array.from({ length: 13 }, () => "x".repeat(60 * 1024));
    const before = structuredClone(analysis);
    assertWithheld(await writeManualTradeCardPackage(analysis, path.join(directory(t), "package")), analysis, "VALIDATION_FAILED");
    assert.deepEqual(analysis, before);
  });
}

for (const proposals of [[], [{}, {}], null, [null]]) {
  test(`non-single candidate transport ${JSON.stringify(proposals)} preserves HTML and delivers no partial candidate`, async t => {
    const analysis = input(); analysis.candidateProposals = proposals;
    assertWithheld(await writeManualTradeCardPackage(analysis, path.join(directory(t), "package")), analysis, "CANDIDATE_INPUT_INVALID");
  });
}

test("missing bundle metadata keeps the authored standalone card available", async t => {
  const analysis = input(); delete analysis.bundleMetadata;
  assertWithheld(await writeManualTradeCardPackage(analysis, path.join(directory(t), "package")), analysis, "CANDIDATE_INPUT_UNAVAILABLE");
});

for (const phase of ["partial write", "publish"]) {
  test(`candidate ${phase} failure exposes no candidate and leaves complete HTML/status`, async t => {
    const dir = directory(t); const analysis = input();
    const failure = () => Object.assign(new Error("disk failure"), { code: "EIO", syscall: "write", errno: -5 });
    if (phase === "partial write") {
      const write = fs.writeFileSync;
      t.mock.method(fs, "writeFileSync", function(file, ...args) {
        if (String(file).includes(`${path.sep}individual-candidates${path.sep}`)) { write.call(this, file, "partial"); throw failure(); }
        return write.call(this, file, ...args);
      });
    } else t.mock.method(fs, "renameSync", () => { throw failure(); });
    assertWithheld(await writeManualTradeCardPackage(analysis, path.join(dir, "package")), analysis, "DELIVERY_FAILED");
    assert.deepEqual(fs.readdirSync(dir), ["package"]);
  });
}

test("final status write failure removes delivered candidate and never reports success", async t => {
  const dir = directory(t); const analysis = input(); const write = fs.writeFileSync; let statuses = 0;
  t.mock.method(fs, "writeFileSync", function(file, ...args) {
    if (String(file).endsWith("candidate-delivery-status.json") && ++statuses === 2) throw Object.assign(new Error("status disk failure"), { code: "EIO" });
    return write.call(this, file, ...args);
  });
  const output = path.join(dir, "package");
  await assert.rejects(writeManualTradeCardPackage(analysis, output), { code: "EIO" });
  assert.equal(fs.readFileSync(path.join(output, "trade-card.html"), "utf8"), analysis.artifactContent.html);
  assert.deepEqual(fs.readdirSync(output).sort(), ["candidate-delivery-status.json", "trade-card.html"]);
});

test("fresh output enforced; invalid HTML fails before creating a package", async t => {
  const output = path.join(directory(t), "package"); const analysis = input();
  const first = await writeManualTradeCardPackage(analysis, output);
  const bytes = fs.readFileSync(first.candidateDelivery.files[0], "utf8");
  await assert.rejects(writeManualTradeCardPackage(analysis, output), { code: "EEXIST" });
  assert.equal(fs.readFileSync(first.candidateDelivery.files[0], "utf8"), bytes);
  const invalidOutput = path.join(directory(t), "bad");
  await assert.rejects(writeManualTradeCardPackage({ ...analysis, artifactContent: {} }, invalidOutput), /HTML/);
  assert.equal(fs.existsSync(invalidOutput), false);
});

test("delivered file uses existing explicit import: ACCEPTED/WAITING then DUPLICATE, no ARM or execution authority", async t => {
  const dir = directory(t); const clock = () => "2026-08-29T15:00:00.000Z";
  const store = new PreTradeStore({ filePath: path.join(dir, "test-state.json"), clock }); store.load();
  const ingress = new PreTradeCandidateIngress({ store, clock });
  const before = store.snapshot();
  const result = await writeManualTradeCardPackage(input(), path.join(dir, "package"));
  assert.deepEqual(store.snapshot(), before);
  const { body } = prepareManualCandidateImport(fs.readFileSync(result.candidateDelivery.files[0], "utf8"));
  const accepted = ingress.importBundle(body).outcomes[0];
  assert.equal(accepted.status, "ACCEPTED"); assert.equal(accepted.lifecycleState, "WAITING");
  assert.equal(ingress.importBundle(body).outcomes[0].status, "DUPLICATE");
  assert.equal(store.state.candidates.length, 1);
  const candidate = store.state.candidates[0];
  assert.equal(candidate.arm, null); assert.equal(candidate.armAuthorized, false);
  assert.equal(candidate.executionState, undefined); assert.equal(candidate.handoff, undefined);
});

test("package CLI returns zero with explicit withholding and uses nonzero input/usage errors", t => {
  const dir = directory(t); const analysis = input(); analysis.candidateProposals[0].status = "WAITING";
  const file = path.join(dir, "analysis.json"); fs.writeFileSync(file, JSON.stringify(analysis));
  const cli = new URL("../schwab-bridge/manual-trade-card-package.mjs", import.meta.url).pathname;
  const run = spawnSync(process.execPath, [cli, file, path.join(dir, "package")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assertWithheld(JSON.parse(run.stdout), analysis, "VALIDATION_FAILED");
  assert.equal(spawnSync(process.execPath, [cli], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, file, path.join(dir, "package")], { encoding: "utf8" }).status, 1);
});
