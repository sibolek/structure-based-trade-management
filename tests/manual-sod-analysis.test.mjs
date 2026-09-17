import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { serializeManualSodAnalysis, writeManualSodAnalysis } from "../schwab-bridge/manual-sod-analysis.mjs";
import { writeManualSodPackage } from "../schwab-bridge/manual-sod-package.mjs";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";

const serializerCli = new URL("../schwab-bridge/manual-sod-analysis.mjs", import.meta.url).pathname;
const packageCli = new URL("../schwab-bridge/manual-sod-package.mjs", import.meta.url).pathname;
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sod-analysis-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function input() {
  const { candidates, ...bundleMetadata } = JSON.parse(fs.readFileSync(new URL("../fixtures/v24-sod-candidates.example.json", import.meta.url), "utf8"));
  candidates[0].trigger = { type: "MANUAL_CONFIRMATION", description: "Preserve authored shorthand" };
  candidates[0].thesis = "Transported A+ analysis";
  candidates[0].deliveryNotes = { text: "  Unicode → ★ < > &\nunchanged  ", values: [null, false, 0, 1.23456789, "001.2300"] };
  return { artifactContent: sodArtifactContentFixture(), candidateProposals: candidates, bundleMetadata };
}
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function run(cli, ...args) { return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }); }
function assertReports(result) {
  assert.equal((fs.readFileSync(result.report.markdownPath, "utf8").match(/^## \d+\. /gm) || []).length, 19);
  for (const file of [result.report.markdownPath, result.report.htmlPath, result.dashboard.htmlPath]) {
    assert.match(fs.readFileSync(file, "utf8").replaceAll("\\+", "+"), /Transported A\+ analysis/);
  }
}

test("transport CLI round-trips unchanged through the existing packager CLI and matches direct input", async t => {
  const dir = directory(t); const analysis = input(); const before = structuredClone(analysis);
  const authoredPath = path.join(dir, "authored.json");
  fs.writeFileSync(authoredPath, JSON.stringify(analysis));
  const serialized = run(serializerCli, authoredPath, "2026-09-16", dir);
  assert.equal(serialized.status, 0, serialized.stderr);
  const { analysisPath } = JSON.parse(serialized.stdout);
  assert.equal(path.basename(analysisPath), "manual-sod-analysis-2026-09-16.json");
  assert.deepEqual(read(analysisPath), before);
  assert.equal(fs.readFileSync(analysisPath, "utf8"), serializeManualSodAnalysis(analysis));
  const packaged = run(packageCli, analysisPath, path.join(dir, "transport-package"));
  assert.equal(packaged.status, 0, packaged.stderr);
  const result = JSON.parse(packaged.stdout);
  const direct = await writeManualSodPackage(analysis, path.join(dir, "direct-package"));
  assertReports(result);
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  for (const [index, file] of result.candidateDelivery.files.entries()) {
    assert.deepEqual(read(file), { ...analysis.bundleMetadata, ingressPolicy: "MANUAL_AUTHORIZED", candidates: [analysis.candidateProposals[index]] });
    assert.equal(fs.readFileSync(file, "utf8"), fs.readFileSync(direct.candidateDelivery.files[index], "utf8"));
  }
  for (const [left, right] of [[result.report.markdownPath, direct.report.markdownPath], [result.report.htmlPath, direct.report.htmlPath], [result.dashboard.htmlPath, direct.dashboard.htmlPath]]) {
    assert.equal(fs.readFileSync(left, "utf8"), fs.readFileSync(right, "utf8"));
  }
  assert.deepEqual(analysis, before);
});

test("transport and local candidate delivery work with network and service startup blocked", async t => {
  const attempted = [];
  const offline = () => { attempted.push("network/service"); throw new Error("Services offline"); };
  t.mock.method(globalThis, "fetch", offline);
  for (const transport of [http, https]) {
    t.mock.method(transport, "request", offline);
    t.mock.method(transport, "get", offline);
  }
  t.mock.method(net.Socket.prototype, "connect", offline);
  t.mock.method(net.Server.prototype, "listen", offline);
  const dir = directory(t);
  const file = writeManualSodAnalysis(input(), "2026-09-16", dir);
  const result = await writeManualSodPackage(read(file), path.join(dir, "package"));
  assertReports(result);
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  assert.deepEqual(attempted, []);
});

test("standalone serializer CLI needs no validator, renderer, provider, or ExecutionOS runtime", t => {
  const dir = directory(t); const isolatedCli = path.join(dir, "manual-sod-analysis.mjs");
  fs.copyFileSync(serializerCli, isolatedCli);
  fs.copyFileSync(new URL("../schwab-bridge/manual-output-paths.mjs", import.meta.url), path.join(dir, "manual-output-paths.mjs"));
  const analysis = { artifactContent: {}, candidateProposals: [{ arbitraryDraft: true, armAuthorized: false }], bundleMetadata: null };
  const authoredPath = path.join(dir, "authored.json");
  fs.writeFileSync(authoredPath, JSON.stringify(analysis));
  const result = run(isolatedCli, authoredPath, "2024-02-29", path.join(dir, "output"));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(read(JSON.parse(result.stdout).analysisPath), analysis);
  assert.deepEqual(fs.readdirSync(path.join(dir, "output")), ["manual-sod-analysis-2024-02-29.json"]);
});

test("transport remains reportable when the downstream local validator is unavailable", t => {
  const dir = directory(t); const runtime = path.join(dir, "report-runtime");
  const file = writeManualSodAnalysis(input(), "2026-09-16", dir);
  fs.mkdirSync(runtime);
  for (const name of ["manual-output-paths.mjs", "manual-sod-package.mjs", "sod-artifact-renderer.mjs", "sod-artifact-content.mjs"]) {
    fs.copyFileSync(new URL(`../schwab-bridge/${name}`, import.meta.url), path.join(runtime, name));
  }
  const packaged = run(path.join(runtime, "manual-sod-package.mjs"), file, path.join(dir, "package"));
  assert.equal(packaged.status, 0, packaged.stderr);
  const result = JSON.parse(packaged.stdout);
  assertReports(result);
  assert.equal(result.candidateDelivery.reason, "VALIDATOR_UNAVAILABLE");
  assert.equal(fs.existsSync(path.join(dir, "package", "individual-candidates")), false);
});

test("serializer preserves a rejected later candidate; downstream gate withholds all candidates but completes reports", async t => {
  const dir = directory(t); const analysis = input();
  analysis.candidateProposals.push({ ...structuredClone(analysis.candidateProposals[0]), candidateId: "invalid-second", armAuthorized: false });
  const before = structuredClone(analysis);
  const file = writeManualSodAnalysis(analysis, "2026-09-16", dir);
  assert.deepEqual(read(file), before);
  const result = await writeManualSodPackage(read(file), path.join(dir, "package"));
  assertReports(result);
  assert.equal(result.candidateDelivery.status, "WITHHELD");
  assert.equal(result.candidateDelivery.reason, "VALIDATION_FAILED");
  assert.match(result.candidateDelivery.diagnostic, /candidates\[1\].*armAuthorized/);
  assert.deepEqual(result.candidateDelivery.files, []);
  assert.equal(fs.existsSync(path.join(dir, "package", "individual-candidates")), false);
  assert.deepEqual(analysis, before);
});

test("deterministic serializer defaults support the existing report-only direct shape", async t => {
  const analysis = { artifactContent: sodArtifactContentFixture() };
  const first = serializeManualSodAnalysis(analysis);
  assert.equal(serializeManualSodAnalysis(analysis), first);
  assert.deepEqual(JSON.parse(first), { ...analysis, candidateProposals: [], bundleMetadata: null });
  const dir = directory(t);
  const direct = await writeManualSodPackage(analysis, path.join(dir, "direct"));
  const transported = await writeManualSodPackage(JSON.parse(first), path.join(dir, "transported"));
  assert.equal(transported.candidateDelivery.status, "NO_CANDIDATES");
  assert.deepEqual(transported.candidateDelivery, direct.candidateDelivery);
  assert.equal(fs.readFileSync(transported.report.htmlPath, "utf8"), fs.readFileSync(direct.report.htmlPath, "utf8"));
});

test("report ideas without canonical bundle metadata survive transport and explicitly withhold candidate delivery", async t => {
  const analysis = input(); delete analysis.bundleMetadata;
  const result = await writeManualSodPackage(JSON.parse(serializeManualSodAnalysis(analysis)), path.join(directory(t), "package"));
  assertReports(result);
  assert.equal(result.candidateDelivery.reason, "CANDIDATE_INPUT_UNAVAILABLE");
});

test("writer rejects invalid calendar/path dates and refuses to overwrite a prior artifact", t => {
  const dir = directory(t); const analysis = input();
  for (const date of ["2026-02-29", "2026-09-31", "2026-13-01", "../2026-09-16", "2026-9-16", undefined]) {
    assert.throws(() => writeManualSodAnalysis(analysis, date, path.join(dir, "invalid")), /YYYY-MM-DD/);
  }
  assert.equal(fs.existsSync(path.join(dir, "invalid")), false);
  const file = writeManualSodAnalysis(analysis, "2026-09-16", dir);
  const original = fs.readFileSync(file, "utf8");
  analysis.candidateProposals[0].thesis = "Different analysis";
  assert.throws(() => writeManualSodAnalysis(analysis, "2026-09-16", dir), { code: "EEXIST" });
  assert.equal(fs.readFileSync(file, "utf8"), original);
});

test("serializer checks only transport containers and refuses silent JSON value loss", t => {
  for (const analysis of [null, [], {}, { artifactContent: [] }, { artifactContent: {}, candidateProposals: {} }, { artifactContent: {}, bundleMetadata: [] }]) {
    assert.throws(() => serializeManualSodAnalysis(analysis), /must be/);
  }
  for (const value of [undefined, NaN, Infinity, -0, new Date("2026-09-16T00:00:00Z"), [, 1]]) {
    const analysis = input(); analysis.candidateProposals[0].optional = value;
    assert.throws(() => serializeManualSodAnalysis(analysis), /losslessly/);
  }
  const dir = path.join(directory(t), "not-written");
  const analysis = input(); analysis.candidateProposals[0].optional = undefined;
  assert.throws(() => writeManualSodAnalysis(analysis, "2026-09-16", dir), /losslessly/);
  assert.equal(fs.existsSync(dir), false);
});

test("serializer CLI distinguishes usage, unreadable input, invalid JSON and existing output failures", t => {
  assert.equal(run(serializerCli).status, 2);
  const dir = directory(t); const inputPath = path.join(dir, "input.json");
  assert.equal(run(serializerCli, inputPath, "2026-09-16", dir).status, 1);
  fs.writeFileSync(inputPath, "{broken");
  assert.equal(run(serializerCli, inputPath, "2026-09-16", dir).status, 1);
  fs.writeFileSync(inputPath, serializeManualSodAnalysis(input()));
  assert.equal(run(serializerCli, inputPath, "2026-09-16", dir).status, 0);
  assert.equal(run(serializerCli, inputPath, "2026-09-16", dir).status, 1);
});

test("canonical transport template is consumable report-shape guidance with no copied candidate schema", async t => {
  const template = read(new URL("../examples/manual-sod-analysis.template.json", import.meta.url));
  assert.deepEqual(Object.keys(template), ["artifactContent", "candidateProposals", "bundleMetadata"]);
  assert.deepEqual(template.candidateProposals, []);
  assert.equal(template.bundleMetadata, null);
  const dir = directory(t);
  const file = writeManualSodAnalysis(template, "2026-09-16", dir);
  const result = await writeManualSodPackage(read(file), path.join(dir, "package"));
  assert.equal(result.candidateDelivery.status, "NO_CANDIDATES");
  assert.equal((fs.readFileSync(result.report.markdownPath, "utf8").match(/^## \d+\. /gm) || []).length, 19);
  assert.match(fs.readFileSync(result.report.htmlPath, "utf8"), /TRANSPORT TEMPLATE/);
});
