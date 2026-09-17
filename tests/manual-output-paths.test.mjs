import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { manualOutputPaths, defaultManualPackageDirectory, expandManualPath } from "../schwab-bridge/manual-output-paths.mjs";
import { validateManualSodIndividualCandidateJson } from "../schwab-bridge/manual-sod-deliverables.mjs";
import { prepareManualCandidateImport } from "../src/pretrade/manual-candidate-import.js";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";

const date = "2026-08-29";
const symbol = "NVDA";
function sandbox(t) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "manual-default-home-")));
  fs.mkdirSync(path.join(home, "Downloads"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}
function authored(kind) {
  const { candidates, ...bundleMetadata } = JSON.parse(fs.readFileSync(new URL("../fixtures/v24-sod-candidates.example.json", import.meta.url), "utf8"));
  return { artifactContent: kind === "sod" ? sodArtifactContentFixture() : { html: "<!doctype html><html><body>Exact authored card — unchanged</body></html>\n" },
    candidateProposals: kind === "sod" ? candidates : [candidates[0]], bundleMetadata };
}
function run(home, kind, stage, ...args) {
  return spawnSync(process.execPath, [new URL(`../schwab-bridge/manual-${kind}-${stage}.mjs`, import.meta.url).pathname, ...args],
    { cwd: home, env: { ...process.env, HOME: home }, encoding: "utf8" });
}
function ok(result) { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); }
function source(home, data) { const file = path.join(home, "authored.json"); fs.writeFileSync(file, JSON.stringify(data)); return file; }
function labels(kind) { return kind === "sod" ? [date] : [date, symbol]; }
function expected(home, kind) {
  const directory = kind === "sod" ? path.join(home, "Downloads/ExecutionOS/SOD", date) : path.join(home, "Downloads/ExecutionOS/TradeCards", date, symbol);
  return { directory, transport: `${directory}-transport`, filename: `manual-${kind}-analysis-${date}${kind === "sod" ? "" : `-${symbol}`}.json` };
}
function snapshot(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).map(entry =>
    [entry.name, entry.isDirectory() ? snapshot(path.join(directory, entry.name)) : fs.readFileSync(path.join(directory, entry.name), "utf8")]);
}

for (const kind of ["sod", "trade-card"]) {
  test(`${kind}: default CLI smoke test verifies exact layout, transport round trip and canonical candidate bytes`, t => {
    const home = sandbox(t); const data = authored(kind); const paths = expected(home, kind);
    const { analysisPath } = ok(run(home, kind, "analysis", source(home, data), ...labels(kind)));
    assert.equal(analysisPath, path.join(paths.transport, paths.filename));
    assert.deepEqual(JSON.parse(fs.readFileSync(analysisPath, "utf8")), data);
    assert.deepEqual(fs.readdirSync(paths.transport), [paths.filename]);
    assert.equal(fs.existsSync(paths.directory), false);
    const result = ok(run(home, kind, "package", analysisPath));
    assert.equal(path.dirname(result.candidateDeliveryStatusPath), paths.directory);
    assert.equal(result.candidateDelivery.status, "DELIVERED");
    assert.deepEqual(JSON.parse(fs.readFileSync(result.candidateDeliveryStatusPath, "utf8")), result.candidateDelivery);
    const expectedFiles = kind === "sod" ? ["report.md", "report.html", "dashboard.html", "candidate-delivery-status.json", "individual-candidates"]
      : ["trade-card.html", "candidate-delivery-status.json", path.basename(result.candidateDelivery.files[0])];
    assert.deepEqual(fs.readdirSync(paths.directory).sort(), expectedFiles.sort());
    if (kind === "sod") assert.deepEqual(fs.readdirSync(path.join(paths.directory, "individual-candidates")).sort(), result.candidateDelivery.files.map(file => path.basename(file)).sort());
    else assert.equal(fs.readFileSync(result.htmlPath, "utf8"), data.artifactContent.html);
    assert.equal(result.candidateDelivery.files.length, data.candidateProposals.length);
    for (const [index, file] of result.candidateDelivery.files.entries()) {
      const raw = fs.readFileSync(file, "utf8");
      const bundle = { ...data.bundleMetadata, ingressPolicy: "MANUAL_AUTHORIZED", candidates: [data.candidateProposals[index]] };
      assert.deepEqual(validateManualSodIndividualCandidateJson(raw), bundle);
      assert.deepEqual(prepareManualCandidateImport(raw).body, bundle);
    }
    // Existing explicit paths produce identical reports/HTML and candidate bytes.
    const direct = ok(run(home, kind, "package", analysisPath, path.join(home, "explicit-package")));
    for (const name of kind === "sod" ? ["report.md", "report.html", "dashboard.html"] : ["trade-card.html"]) {
      assert.equal(fs.readFileSync(path.join(paths.directory, name), "utf8"), fs.readFileSync(path.join(home, "explicit-package", name), "utf8"));
    }
    for (const [i, file] of result.candidateDelivery.files.entries()) assert.equal(fs.readFileSync(file, "utf8"), fs.readFileSync(direct.candidateDelivery.files[i], "utf8"));
    const before = snapshot(path.join(home, "Downloads"));
    assert.match(run(home, kind, "analysis", path.join(home, "authored.json"), ...labels(kind)).stderr, /EEXIST/);
    assert.match(run(home, kind, "package", analysisPath).stderr, /EEXIST/);
    assert.deepEqual(snapshot(path.join(home, "Downloads")), before);
  });

  test(`${kind}: explicit relative and quoted tilde paths bypass defaults, even without Downloads`, t => {
    const home = sandbox(t); fs.rmdirSync(path.join(home, "Downloads")); source(home, authored(kind));
    const { analysisPath } = ok(run(home, kind, "analysis", "~/authored.json", ...labels(kind), "~/custom transport"));
    assert.equal(path.dirname(analysisPath), path.join(home, "custom transport"));
    const result = ok(run(home, kind, "package", `~/custom transport/${path.basename(analysisPath)}`, "relative-package"));
    assert.equal(path.dirname(result.candidateDeliveryStatusPath), path.join(home, "relative-package"));
    const arbitrary = source(home, authored(kind));
    const override = ok(run(home, kind, "package", arbitrary, "~/custom package"));
    assert.equal(path.dirname(override.candidateDeliveryStatusPath), path.join(home, "custom package"));
    assert.equal(run(home, kind, "analysis", arbitrary, ...labels(kind), "").status, 2);
    assert.equal(run(home, kind, "package", arbitrary, "").status, 2);
    assert.equal(fs.existsSync(path.join(home, "Downloads")), false);
  });

  for (const type of ["empty directory", "symlink"]) {
    test(`${kind}: default transport and package refuse existing ${type}`, t => {
      const home = sandbox(t); const data = authored(kind); const paths = expected(home, kind); const input = source(home, data);
      fs.mkdirSync(path.dirname(paths.directory), { recursive: true });
      const target = path.join(home, "protected"); fs.mkdirSync(target);
      for (const directory of [paths.transport, paths.directory]) {
        if (type === "symlink") fs.symlinkSync(target, directory); else fs.mkdirSync(directory);
      }
      assert.match(run(home, kind, "analysis", input, ...labels(kind)).stderr, /EEXIST/);
      const named = path.join(home, paths.filename); fs.copyFileSync(input, named);
      assert.match(run(home, kind, "package", named).stderr, /EEXIST/);
      assert.deepEqual(fs.readdirSync(target), []);
    });
  }

  for (const defect of ["invalid contract", "authority", "automated policy", "missing metadata"]) {
    test(`${kind}: default path preserves validator withholding for ${defect}`, t => {
      const home = sandbox(t); const data = authored(kind);
      if (defect === "invalid contract") delete data.candidateProposals[0].structuralInvalidation;
      if (defect === "authority") data.candidateProposals[0].armAuthorized = false;
      if (defect === "automated policy") data.bundleMetadata.ingressPolicy = "AUTOMATED_UNTOUCHED_ONLY";
      if (defect === "missing metadata") data.bundleMetadata = null;
      const { analysisPath } = ok(run(home, kind, "analysis", source(home, data), ...labels(kind)));
      assert.deepEqual(JSON.parse(fs.readFileSync(analysisPath, "utf8")), data);
      const result = ok(run(home, kind, "package", analysisPath));
      assert.equal(result.candidateDelivery.status, "WITHHELD");
      assert.equal(result.candidateDelivery.reason, defect === "missing metadata" ? "CANDIDATE_INPUT_UNAVAILABLE" : "VALIDATION_FAILED");
      assert.deepEqual(result.candidateDelivery.files, []);
      assert.deepEqual(fs.readdirSync(expected(home, kind).directory).sort(),
        (kind === "sod" ? ["report.md", "report.html", "dashboard.html", "candidate-delivery-status.json"] : ["trade-card.html", "candidate-delivery-status.json"]).sort());
    });
  }

  test(`${kind}: missing or unusable Downloads fails clearly, with no fallback`, t => {
    const home = sandbox(t); const input = source(home, authored(kind));
    fs.rmdirSync(path.join(home, "Downloads"));
    for (const blocked of [false, true]) {
      if (blocked) fs.writeFileSync(path.join(home, "Downloads"), "not a directory");
      const failure = run(home, kind, "analysis", input, ...labels(kind));
      assert.equal(failure.status, 1); assert.match(failure.stderr, /Downloads destination unavailable.*explicit output directory/);
      const named = path.join(home, expected(home, kind).filename); fs.copyFileSync(input, named);
      const packageFailure = run(home, kind, "package", named);
      assert.equal(packageFailure.status, 1); assert.match(packageFailure.stderr, /Downloads destination unavailable/);
      assert.equal(fs.existsSync(path.join(home, "ExecutionOS")), false);
    }
  });

  test(`${kind}: unrecognized filenames and invalid calendar labels require explicit output`, t => {
    const home = sandbox(t); const input = source(home, authored(kind));
    const unrecognized = run(home, kind, "package", input);
    assert.equal(unrecognized.status, 1); assert.match(unrecognized.stderr, /Cannot infer.*explicit output directory/);
    const badDate = path.join(home, expected(home, kind).filename.replace(date, "2026-02-30")); fs.copyFileSync(input, badDate);
    assert.match(run(home, kind, "package", badDate).stderr, /calendar date/);
    assert.match(run(home, kind, "analysis", input, "2026-02-30", ...(kind === "sod" ? [] : [symbol])).stderr, /calendar date/);
    assert.deepEqual(fs.readdirSync(path.join(home, "Downloads")), []);
  });
}

for (const reserved of ["NVDA-TRANSPORT", "nvda-transport", "NvDa-TrAnSpOrT"]) {
  test(`trade-card: reserved suffix rejects default paths for ${reserved}`, t => {
    const home = sandbox(t); t.mock.method(os, "homedir", () => home);
    const error = /-TRANSPORT suffix.*reserved for transport-directory naming.*explicit output directory/;
    const input = source(home, authored("trade-card"));
    const named = path.join(home, `manual-trade-card-analysis-${date}-${reserved}.json`);
    fs.copyFileSync(input, named);
    assert.throws(() => manualOutputPaths("trade-card", date, reserved), error);
    assert.throws(() => defaultManualPackageDirectory("trade-card", named), error);
    const analysis = run(home, "trade-card", "analysis", input, date, reserved);
    assert.equal(analysis.status, 1); assert.match(analysis.stderr, error);
    const packaged = run(home, "trade-card", "package", named);
    assert.equal(packaged.status, 1); assert.match(packaged.stderr, error);
    assert.deepEqual(fs.readdirSync(path.join(home, "Downloads")), []);
  });
}

test("trade-card: ordinary symbol keeps package and sibling transport paths", t => {
  const home = sandbox(t); t.mock.method(os, "homedir", () => home);
  const directory = path.join(home, "Downloads", "ExecutionOS", "TradeCards", date, "NVDA");
  assert.deepEqual(manualOutputPaths("trade-card", date, "NVDA"), {
    packageDirectory: directory,
    transportDirectory: `${directory}-transport`,
    analysisPath: path.join(`${directory}-transport`, `manual-trade-card-analysis-${date}-NVDA.json`),
  });
  assert.equal(defaultManualPackageDirectory("trade-card", `manual-trade-card-analysis-${date}-NVDA.json`), directory);
  assert.throws(() => defaultManualPackageDirectory("trade-card", `manual-trade-card-analysis-${date}-nvda.json`), /uppercase filename symbol/);
});

test("trade-card: reserved suffix allows explicit transport and package destinations", t => {
  const home = sandbox(t); fs.rmdirSync(path.join(home, "Downloads"));
  const data = authored("trade-card");
  const { analysisPath } = ok(run(home, "trade-card", "analysis", source(home, data), date, "NVDA-TRANSPORT", "custom-transport"));
  assert.equal(analysisPath, path.join(home, "custom-transport", `manual-trade-card-analysis-${date}-NVDA-TRANSPORT.json`));
  assert.deepEqual(JSON.parse(fs.readFileSync(analysisPath, "utf8")), data);
  const result = ok(run(home, "trade-card", "package", analysisPath, "custom-package"));
  assert.equal(path.dirname(result.candidateDeliveryStatusPath), path.join(home, "custom-package"));
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  assert.equal(fs.readFileSync(result.htmlPath, "utf8"), data.artifactContent.html);
  assert.equal(fs.existsSync(path.join(home, "Downloads")), false);
});

test("SOD: reserved trade-card suffix does not affect default path resolution", t => {
  const home = sandbox(t); t.mock.method(os, "homedir", () => home);
  const directory = path.join(home, "Downloads", "ExecutionOS", "SOD", date);
  for (const label of [undefined, "NVDA-TRANSPORT", "nvda-transport", "NvDa-TrAnSpOrT"]) {
    assert.deepEqual(manualOutputPaths("sod", date, label), {
      packageDirectory: directory,
      transportDirectory: `${directory}-transport`,
      analysisPath: path.join(`${directory}-transport`, `manual-sod-analysis-${date}.json`),
    });
  }
  assert.equal(defaultManualPackageDirectory("sod", `manual-sod-analysis-${date}.json`), directory);
});

test("default resolver uses current home and fails on permission denial without fallback", t => {
  const home = sandbox(t); t.mock.method(os, "homedir", () => home);
  assert.equal(expandManualPath("~"), home); assert.equal(expandManualPath("~/a b"), path.join(home, "a b"));
  assert.throws(() => expandManualPath("~someone/Downloads"), /current user's home/);
  assert.equal(manualOutputPaths("sod", date).packageDirectory, expected(home, "sod").directory);
  assert.equal(manualOutputPaths("trade-card", date, symbol).packageDirectory, expected(home, "trade-card").directory);
  for (const unsafe of ["../NVDA", "/NVDA", "nvda", ".."]) assert.throws(() => manualOutputPaths("trade-card", date, unsafe), /filename symbol/);
  t.mock.method(fs, "accessSync", () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); });
  assert.throws(() => manualOutputPaths("sod", date), /Downloads destination unavailable.*permission denied.*explicit output directory/);
});

test("SOD default keeps reports available when no A+ candidates exist", t => {
  const home = sandbox(t); const data = authored("sod"); data.candidateProposals = []; data.bundleMetadata = null;
  const { analysisPath } = ok(run(home, "sod", "analysis", source(home, data), date));
  const result = ok(run(home, "sod", "package", analysisPath));
  assert.equal(result.candidateDelivery.status, "NO_CANDIDATES");
  assert.equal(fs.existsSync(path.join(expected(home, "sod").directory, "individual-candidates")), false);
});
