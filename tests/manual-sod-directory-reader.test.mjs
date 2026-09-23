import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createManualSodDirectoryApiHandler } from "../schwab-bridge/manual-sod-directory-api.mjs";
import { readManualSodCandidatePackage } from "../schwab-bridge/manual-sod-directory-reader.mjs";
import { writeManualSodPackage } from "../schwab-bridge/manual-sod-package.mjs";
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
