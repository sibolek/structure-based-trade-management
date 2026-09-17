import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { serializeManualTradeCardAnalysis, writeManualTradeCardAnalysis } from "../schwab-bridge/manual-trade-card-analysis.mjs";

const input = () => ({ artifactContent: { html: '<!doctype html><html><body>Authored card — unchanged</body></html>\n' }, candidateProposals: [{}], bundleMetadata: null });
function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-card-analysis-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("transport preserves HTML, arbitrary candidate values and metadata without candidate validation", () => {
  const analysis = input();
  analysis.candidateProposals[0] = JSON.parse('{"arbitrary":{"__proto__":{"x":1}},"invalidCandidate":true}');
  analysis.bundleMetadata = { source: "not validated here" };
  assert.deepEqual(JSON.parse(serializeManualTradeCardAnalysis(analysis)), analysis);
});

test("dated symbol transport writes exclusively and reads back unchanged", t => {
  const analysis = input(); const dir = directory(t);
  const file = writeManualTradeCardAnalysis(analysis, "2026-09-16", "NVDA", dir);
  assert.equal(path.basename(file), "manual-trade-card-analysis-2026-09-16-NVDA.json");
  assert.equal(fs.readFileSync(file, "utf8"), serializeManualTradeCardAnalysis(analysis));
  assert.throws(() => writeManualTradeCardAnalysis(analysis, "2026-09-16", "NVDA", dir), { code: "EEXIST" });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), analysis);
});

test("transport rejects non-single proposals, lossy JSON, absent HTML and unsafe filename labels before writing", t => {
  for (const proposals of [[], [{}, {}], null, [null], [1]]) {
    assert.throws(() => serializeManualTradeCardAnalysis({ ...input(), candidateProposals: proposals }), /exactly one/);
  }
  for (const value of [undefined, NaN, Infinity, new Date(), [, 1]]) {
    assert.throws(() => serializeManualTradeCardAnalysis({ ...input(), candidateProposals: [{ value }] }), /losslessly/);
  }
  assert.throws(() => serializeManualTradeCardAnalysis({ ...input(), artifactContent: {} }), /HTML/);
  assert.throws(() => serializeManualTradeCardAnalysis({ ...input(), bundleMetadata: [] }), /metadata|bundleMetadata/);
  const dir = directory(t);
  for (const date of ["2026-02-30", "2026-13-01", "../2026-09-16"]) assert.throws(() => writeManualTradeCardAnalysis(input(), date, "NVDA", dir), /calendar date/);
  for (const symbol of ["../NVDA", "nvda", "", "/MNQ"]) assert.throws(() => writeManualTradeCardAnalysis(input(), "2026-09-16", symbol, dir), /filename symbol/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("isolated serializer CLI works without validator, renderer, runtime or repository", t => {
  const dir = directory(t); const cli = path.join(dir, "manual-trade-card-analysis.mjs");
  fs.copyFileSync(new URL("../schwab-bridge/manual-trade-card-analysis.mjs", import.meta.url), cli);
  fs.copyFileSync(new URL("../schwab-bridge/manual-output-paths.mjs", import.meta.url), path.join(dir, "manual-output-paths.mjs"));
  const source = path.join(dir, "authored.json"); fs.writeFileSync(source, JSON.stringify(input()));
  const run = spawnSync(process.execPath, [cli, source, "2026-09-16", "NVDA", path.join(dir, "transport")], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(JSON.parse(run.stdout).analysisPath, "utf8")), input());
  assert.equal(spawnSync(process.execPath, [cli], { encoding: "utf8" }).status, 2);
  assert.equal(spawnSync(process.execPath, [cli, source, "bad", "NVDA", dir], { encoding: "utf8" }).status, 1);
});

test("permission failure makes one write attempt; caller can write the preserved serialization to a fresh path", t => {
  const dir = directory(t); const analysis = input();
  const serialized = serializeManualTradeCardAnalysis(analysis);
  const write = fs.writeFileSync; let attempts = 0;
  const mock = t.mock.method(fs, "writeFileSync", () => {
    attempts++;
    throw Object.assign(new Error("permission denied"), { code: "EACCES", syscall: "open", errno: -13 });
  });
  assert.throws(() => writeManualTradeCardAnalysis(analysis, "2026-09-16", "NVDA", dir), { code: "EACCES" });
  assert.equal(attempts, 1);
  mock.mock.restore();
  const fresh = fs.mkdtempSync(path.join(dir, "recovery-"));
  const file = path.join(fresh, "manual-trade-card-analysis-2026-09-16-NVDA.json");
  write(file, serialized, { flag: "wx" });
  assert.equal(fs.readFileSync(file, "utf8"), serialized);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), analysis);
});
