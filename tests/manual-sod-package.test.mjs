import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { writeManualSodPackage } from "../schwab-bridge/manual-sod-package.mjs";
import { validateManualSodIndividualCandidateJson } from "../schwab-bridge/manual-sod-deliverables.mjs";
import { SOD_REPORT_SECTIONS } from "../schwab-bridge/sod-artifact-renderer.mjs";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";

function input() {
  const { candidates, ...bundleMetadata } = JSON.parse(fs.readFileSync(new URL("../fixtures/v24-sod-candidates.example.json", import.meta.url), "utf8"));
  candidates[0].thesis = "Independent A+ trade analysis survives candidate withholding";
  return { artifactContent: sodArtifactContentFixture(), candidateProposals: candidates, bundleMetadata };
}
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sod-package-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function assertReports(result) {
  const md = fs.readFileSync(result.report.markdownPath, "utf8");
  const html = fs.readFileSync(result.report.htmlPath, "utf8");
  const dashboard = fs.readFileSync(result.dashboard.htmlPath, "utf8");
  assert.equal((md.match(/^## \d+\. /gm) || []).length, 19);
  for (const section of SOD_REPORT_SECTIONS) assert.ok(html.includes(`id="${section.id}"`));
  for (const report of [md, html, dashboard]) {
    assert.ok(report.replaceAll("\\+", "+").includes("Independent A+ trade analysis survives candidate withholding"));
    assert.match(report, /ExecutionOS candidate JSON (delivered|withheld)/);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(result.candidateDeliveryStatusPath, "utf8")), result.candidateDelivery);
}
function assertWithheld(result, reason) {
  assertReports(result);
  assert.equal(result.candidateDelivery.status, "WITHHELD");
  assert.equal(result.candidateDelivery.reason, reason);
  assert.deepEqual(result.candidateDelivery.files, []);
  assert.deepEqual(fs.readdirSync(path.dirname(result.report.markdownPath)).sort(), ["candidate-delivery-status.json", "dashboard.html", "report.html", "report.md"]);
}

test("manual package delivers reports and only current-validator-passing, unchanged candidates", async t => {
  const analysis = input(); const before = structuredClone(analysis);
  const result = await writeManualSodPackage(analysis, path.join(directory(t), "package"));
  assertReports(result);
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  assert.equal(result.candidateDelivery.files.length, analysis.candidateProposals.length);
  for (const [index, file] of result.candidateDelivery.files.entries()) {
    const delivered = validateManualSodIndividualCandidateJson(fs.readFileSync(file, "utf8"));
    assert.deepEqual(delivered, { ...analysis.bundleMetadata, ingressPolicy: "MANUAL_AUTHORIZED", candidates: [analysis.candidateProposals[index]] });
  }
  assert.deepEqual(analysis, before);
});

test("PRETRADE, Schwab, Execution Board and broker offline: no network or service startup is required", async t => {
  const attempted = [];
  const offline = () => { attempted.push("network/service"); throw new Error("All ExecutionOS services offline"); };
  t.mock.method(globalThis, "fetch", offline);
  for (const transport of [http, https]) {
    t.mock.method(transport, "request", offline);
    t.mock.method(transport, "get", offline);
  }
  t.mock.method(net.Socket.prototype, "connect", offline);
  t.mock.method(net.Server.prototype, "listen", offline);
  const result = await writeManualSodPackage(input(), path.join(directory(t), "package"));
  assertReports(result);
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  assert.deepEqual(attempted, []);
});

for (const mode of ["missing delivery gate", "missing canonical contract", "broken validator"]) {
  test(`${mode}: isolated report runtime completes without the ExecutionOS contract`, t => {
    const dir = directory(t); const runtime = path.join(dir, "runtime");
    fs.mkdirSync(runtime);
    // Only reporting code is installed. No candidate schema or validator copy.
    for (const name of ["manual-sod-package.mjs", "sod-artifact-renderer.mjs", "sod-artifact-content.mjs"]) {
      fs.copyFileSync(new URL(`../schwab-bridge/${name}`, import.meta.url), path.join(runtime, name));
    }
    if (mode === "missing canonical contract") {
      fs.copyFileSync(new URL("../schwab-bridge/manual-sod-deliverables.mjs", import.meta.url), path.join(runtime, "manual-sod-deliverables.mjs"));
    } else if (mode === "broken validator") {
      fs.writeFileSync(path.join(runtime, "manual-sod-deliverables.mjs"), 'throw new Error("Validator initialization failed");');
    }
    const inputPath = path.join(dir, "analysis.json");
    fs.writeFileSync(inputPath, JSON.stringify(input()));
    const run = spawnSync(process.execPath, [path.join(runtime, "manual-sod-package.mjs"), inputPath, path.join(dir, "package")], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assertWithheld(result, "VALIDATOR_UNAVAILABLE");
    assert.match(result.candidateDelivery.diagnostic, /Cannot find module|Validator initialization failed/);
  });
}

test("invalid candidate leaves all analysis artifacts complete and emits no candidate JSON", async t => {
  const analysis = input();
  analysis.candidateProposals[0].armAuthorized = false;
  const before = structuredClone(analysis);
  const result = await writeManualSodPackage(analysis, path.join(directory(t), "package"));
  assertWithheld(result, "VALIDATION_FAILED");
  assert.match(result.candidateDelivery.diagnostic, /candidates\[0\].*armAuthorized is system-owned/);
  assert.deepEqual(analysis, before);
});

for (const defect of ["invalid contract", "oversized final file"]) {
  test(`valid first candidate and second ${defect} withhold the entire candidate package`, async t => {
    const analysis = input();
    const second = structuredClone(analysis.candidateProposals[0]);
    second.candidateId = "second-invalid";
    analysis.candidateProposals.push(second);
    if (defect === "invalid contract") second.armPolicy.armAuthorized = false;
    else {
      analysis.bundleMetadata.deliveryNotes = "x".repeat(60 * 1024);
      second.deliveryNotes = Array.from({ length: 12 }, () => "x".repeat(60 * 1024));
    }
    const result = await writeManualSodPackage(analysis, path.join(directory(t), "package"));
    assertWithheld(result, "VALIDATION_FAILED");
    assert.match(result.candidateDelivery.diagnostic, /candidates\[1\] \(second-invalid\)/);
    assert.match(result.candidateDelivery.diagnostic, defect === "invalid contract" ? /armAuthorized is system-owned/ : /768 KiB/);
  });
}

test("candidate filesystem failure cannot expose a partial package or fail reports", async t => {
  const writeFile = fs.writeFileSync;
  let writes = 0;
  t.mock.method(fs, "writeFileSync", function(file, ...args) {
    if (String(file).includes(`${path.sep}individual-candidates${path.sep}`) && ++writes === 2) {
      throw Object.assign(new Error("Candidate disk write failed"), { code: "EIO", syscall: "write", errno: -5 });
    }
    return writeFile.call(this, file, ...args);
  });
  const analysis = input();
  analysis.candidateProposals.push({ ...structuredClone(analysis.candidateProposals[0]), candidateId: "second" });
  const result = await writeManualSodPackage(analysis, path.join(directory(t), "package"));
  assert.equal(writes, 2);
  assertWithheld(result, "DELIVERY_FAILED");
});

test("manual report ideas need no ExecutionOS bundle metadata", async t => {
  const analysis = input(); delete analysis.bundleMetadata;
  const result = await writeManualSodPackage(analysis, path.join(directory(t), "package"));
  assertWithheld(result, "CANDIDATE_INPUT_UNAVAILABLE");
});

test("empty A+ analysis has reports and an explicit no-candidates status", async t => {
  const analysis = input(); analysis.candidateProposals = []; delete analysis.bundleMetadata;
  const result = await writeManualSodPackage(analysis, path.join(directory(t), "package"));
  assert.equal(result.candidateDelivery.status, "NO_CANDIDATES");
  for (const file of [result.report.markdownPath, result.report.htmlPath, result.dashboard.htmlPath]) {
    assert.ok(fs.readFileSync(file, "utf8").replaceAll("\\+", "+").includes("No A+ trades supplied"));
  }
  assert.deepEqual(result.candidateDelivery.files, []);
});

test("fresh output requirement prevents stale candidate delivery on a retry", async t => {
  const dir = path.join(directory(t), "package");
  const first = await writeManualSodPackage(input(), dir);
  const bytes = fs.readFileSync(first.candidateDelivery.files[0], "utf8");
  const analysis = input(); analysis.candidateProposals[0].armAuthorized = false;
  await assert.rejects(writeManualSodPackage(analysis, dir), { code: "EEXIST" });
  assert.equal(fs.readFileSync(first.candidateDelivery.files[0], "utf8"), bytes);
});

test("report-content failures still fail before output or candidate delivery", async t => {
  const dir = path.join(directory(t), "package");
  const analysis = input(); analysis.artifactContent.sections.pop();
  await assert.rejects(writeManualSodPackage(analysis, dir), /exactly 19/);
  assert.equal(fs.existsSync(dir), false);
});

test("package CLI exits successfully with explicit withholding; validator-only CLI remains strict", t => {
  const dir = directory(t); const analysis = input(); analysis.candidateProposals[0].status = "WAITING";
  const inputPath = path.join(dir, "analysis.json"); fs.writeFileSync(inputPath, JSON.stringify(analysis));
  const cli = new URL("../schwab-bridge/manual-sod-package.mjs", import.meta.url).pathname;
  const run = spawnSync(process.execPath, [cli, inputPath, path.join(dir, "package")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assertWithheld(JSON.parse(run.stdout), "VALIDATION_FAILED");
  const candidatePath = path.join(dir, "invalid.json");
  fs.writeFileSync(candidatePath, JSON.stringify({ ...analysis.bundleMetadata, ingressPolicy: "MANUAL_AUTHORIZED", candidates: analysis.candidateProposals }));
  const validation = spawnSync(process.execPath, [new URL("../schwab-bridge/manual-sod-deliverables.mjs", import.meta.url).pathname, "--validate-only", candidatePath], { encoding: "utf8" });
  assert.equal(validation.status, 1);
  assert.match(validation.stderr, /status is system-owned/);
  assert.equal(spawnSync(process.execPath, [cli], { encoding: "utf8" }).status, 2);
});
