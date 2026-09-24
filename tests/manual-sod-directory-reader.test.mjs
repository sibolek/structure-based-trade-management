import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createManualSodDirectoryApiHandler } from "../schwab-bridge/manual-sod-directory-api.mjs";
import { readManualSodCandidatePackage } from "../schwab-bridge/manual-sod-directory-reader.mjs";
import { writeManualSodPackage } from "../schwab-bridge/manual-sod-package.mjs";
import { writeManualTradeCardPackage } from "../schwab-bridge/manual-trade-card-package.mjs";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";
import { manualCandidateFixture } from "./helpers/manual-candidate-fixture.mjs";

const DATE = "2026-09-05";

function candidate(overrides = {}) {
  return manualCandidateFixture({
    source: "SOD_A_PLUS_TRADES",
    sourceDate: DATE,
    ...overrides,
  });
}

async function packageAt(root, candidates = [candidate()]) {
  return writeManualSodPackage({
    artifactContent: sodArtifactContentFixture(),
    candidateProposals: candidates,
    bundleMetadata: {
      source: "SOD_A_PLUS_TRADES",
      sourceDate: DATE,
      generatedAt: "2026-09-05T13:00:00.000Z",
      bundleId: "manual-sod-directory-test",
    },
  }, path.join(root, DATE));
}

async function currentPackageAt(root, candidates = [candidate()]) {
  return writeManualSodPackage({
    artifactContent: sodArtifactContentFixture(),
    candidateProposals: candidates,
    bundleMetadata: {
      source: "SOD_A_PLUS_TRADES",
      sourceDate: DATE,
      generatedAt: "2026-09-05T13:00:00.000Z",
      bundleId: "manual-sod-directory-current-test",
    },
  }, path.join(root, DATE, "sod-package"));
}

async function adHocPackageAt(root, id, proposal = candidate({ candidateId: `ad-hoc-${id}` })) {
  return writeManualTradeCardPackage({
    artifactContent: { html: `<!doctype html><html><body>${proposal.symbol} ${id}</body></html>` },
    candidateProposals: [proposal],
    bundleMetadata: {
      source: "SOD_A_PLUS_TRADES",
      sourceDate: DATE,
      generatedAt: "2026-09-05T14:00:00.000Z",
      bundleId: `manual-ad-hoc-${id}`,
    },
  }, path.join(root, DATE, "ad-hoc", id));
}

function temporaryRoot(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sod-directory-"));
  const root = path.join(parent, "SOD");
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return root;
}

async function startApi(t, rootPath) {
  const handler = createManualSodDirectoryApiHandler({ rootPath });
  const server = http.createServer(async (req, res) => {
    if (await handler(req, res)) return;
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("reads the exact dated manual SOD candidates without importing or rewriting them", async (t) => {
  const root = temporaryRoot(t);
  const written = await packageAt(root, [
    candidate(),
    candidate({ candidateId: "contract-MES-1", symbol: "MES" }),
  ]);
  const original = written.candidateDelivery.files.map((file) => fs.readFileSync(file, "utf8"));

  const result = await readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE });
  assert.equal(result.sourceDate, DATE);
  assert.equal(result.packageDirectory, path.join(root, DATE));
  assert.equal(result.delivery.status, "DELIVERED");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.raw), original);
  assert.deepEqual(result.candidates.map((item) => item.filename), written.candidateDelivery.files.map((file) => path.basename(file)));
});

test("returns a legitimate no-candidates package without inventing candidate data", async (t) => {
  const root = temporaryRoot(t);
  await packageAt(root, []);
  const result = await readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE });
  assert.equal(result.delivery.status, "NO_CANDIDATES");
  assert.deepEqual(result.candidates, []);
});

test("loads a validated ad-hoc candidate when the SOD package has not run", async (t) => {
  const root = temporaryRoot(t);
  const written = await adHocPackageAt(root, "AMD-card");
  assert.equal(fs.existsSync(path.join(root, DATE, "sod-package")), false);

  const result = await readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE });
  assert.equal(result.delivery.status, "DELIVERED");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].sourceKind, "AD_HOC");
  assert.equal(result.candidates[0].packageId, "AMD-card");
  assert.equal(result.candidates[0].raw, fs.readFileSync(written.candidateDelivery.files[0], "utf8"));
});

test("aggregates current-layout SOD and ad-hoc packages with isolated provenance", async (t) => {
  const root = temporaryRoot(t);
  await adHocPackageAt(root, "NVDA-card");
  await currentPackageAt(root, [candidate({ candidateId: "sod-MES", symbol: "MES" })]);

  const result = await readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE });
  assert.equal(result.delivery.status, "DELIVERED");
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.sourceKind).sort(), ["AD_HOC", "SOD"]);
  assert.deepEqual(result.packages.map((item) => item.packageId).sort(), ["NVDA-card", "sod-package"]);
});

test("excludes incomplete ad-hoc packages and rejects duplicate identities across package sources", async (t) => {
  const root = temporaryRoot(t);
  const pending = path.join(root, DATE, "ad-hoc", "pending-card");
  fs.mkdirSync(pending, { recursive: true });
  fs.writeFileSync(path.join(pending, "candidate-delivery-status.json"), JSON.stringify({
    status: "PENDING",
    message: "Candidate delivery is incomplete; no candidate is ready for Import.",
    files: [],
  }));
  const unique = candidate({ candidateId: "unique-SOD" });
  await currentPackageAt(root, [unique]);
  const result = await readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE });
  assert.equal(result.candidates.length, 1);
  assert.match(result.delivery.message, /incomplete or withheld/);

  fs.rmSync(pending, { recursive: true, force: true });
  await adHocPackageAt(root, "duplicate-card", unique);
  await assert.rejects(
    readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE }),
    { code: "MANUAL_SOD_PACKAGE_INCONSISTENT" },
  );
});

test("completed ad-hoc candidates remain readable during private ad-hoc staging and incomplete SOD publication", async (t) => {
  const root = temporaryRoot(t);
  await adHocPackageAt(root, "completed-card");
  const dateDirectory = path.join(root, DATE);
  fs.mkdirSync(path.join(dateDirectory, "ad-hoc", ".manual-trade-card-candidate-interrupted"));
  fs.mkdirSync(path.join(dateDirectory, "sod-package"));

  const result = await readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].packageId, "completed-card");
  assert.deepEqual(result.packages.map((item) => [item.packageId, item.delivery.status]), [
    ["sod-package", "PENDING"],
    ["completed-card", "DELIVERED"],
  ]);
  assert.match(result.delivery.message, /incomplete or withheld/);

  fs.rmSync(path.join(dateDirectory, "ad-hoc", ".manual-trade-card-candidate-interrupted"), { recursive: true });
  fs.symlinkSync(path.join(dateDirectory, "sod-package"), path.join(dateDirectory, "ad-hoc", ".manual-trade-card-candidate-substituted"));
  await assert.rejects(
    readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE }),
    { code: "MANUAL_SOD_PACKAGE_INVALID" },
  );
});

test("rejects traversal dates, stale files, manifest disagreement, and source-date substitution", async (t) => {
  const root = temporaryRoot(t);
  const written = await packageAt(root);
  await assert.rejects(
    readManualSodCandidatePackage({ rootPath: root, sourceDate: "../2026-09-05" }),
    { code: "MANUAL_SOD_SOURCE_DATE_INVALID" },
  );

  const candidateDirectory = path.dirname(written.candidateDelivery.files[0]);
  fs.copyFileSync(written.candidateDelivery.files[0], path.join(candidateDirectory, "99-stale.json"));
  await assert.rejects(
    readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE }),
    { code: "MANUAL_SOD_PACKAGE_INCONSISTENT" },
  );
  fs.unlinkSync(path.join(candidateDirectory, "99-stale.json"));

  const raw = JSON.parse(fs.readFileSync(written.candidateDelivery.files[0], "utf8"));
  raw.sourceDate = "2026-09-04";
  raw.candidates[0].sourceDate = "2026-09-04";
  fs.writeFileSync(written.candidateDelivery.files[0], JSON.stringify(raw));
  await assert.rejects(
    readManualSodCandidatePackage({ rootPath: root, sourceDate: DATE }),
    { code: "MANUAL_SOD_SOURCE_DATE_MISMATCH" },
  );
});

test("directory API is read-only, date-bounded, origin-restricted, and reports missing packages", async (t) => {
  const root = temporaryRoot(t);
  await packageAt(root);
  const base = await startApi(t, root);

  const response = await fetch(`${base}/api/manual-sod/candidates?sourceDate=${DATE}`);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.delivery.status, "DELIVERED");
  assert.equal(payload.candidates.length, 1);

  const missing = await fetch(`${base}/api/manual-sod/candidates?sourceDate=2026-09-06`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "MANUAL_SOD_PACKAGE_NOT_FOUND");

  const invalid = await fetch(`${base}/api/manual-sod/candidates?sourceDate=..%2F2026-09-05`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "MANUAL_SOD_SOURCE_DATE_INVALID");

  const nonLocal = await fetch(`${base}/api/manual-sod/candidates?sourceDate=${DATE}`, {
    headers: { origin: "https://example.com" },
  });
  assert.equal(nonLocal.status, 403);

  const mutation = await fetch(`${base}/api/manual-sod/candidates?sourceDate=${DATE}`, { method: "POST" });
  assert.equal(mutation.status, 405);
});
