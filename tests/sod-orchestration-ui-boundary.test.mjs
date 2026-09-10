import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return fs.readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("ExecutionOS shell exposes SOD as third workspace without changing PRETRADE default", async () => {
  const [app, nav] = await Promise.all([
    source("src/App.jsx"),
    source("src/components/WorkspaceNav.jsx"),
  ]);

  assert.match(app, /useState\("PRETRADE"\)/);
  assert.match(app, /workspace === "SOD"/);
  assert.match(app, /<SodWorkspace sod=\{sod\}/);
  assert.match(nav, /\{ id: "SOD", label: "SOD" \}/);
  assert.match(nav, /grid-cols-3/);
});

test("SOD workspace accepts chart bytes without browser-controlled filesystem or PRETRADE mutation inputs", async () => {
  const workspace = await source("src/components/SodWorkspace.jsx");
  const client = await source("src/sod/sod-orchestration-api-client.js");

  for (const forbidden of [
    "outputPath",
    "destinationPath",
    "candidateInboxPath",
    "pretradeStateFile",
    "/api/candidates/import",
    "/api/arm",
    "/api/oco",
    "/api/handoff",
  ]) {
    assert.equal(workspace.includes(forbidden), false, `workspace must not contain ${forbidden}`);
    assert.equal(client.includes(forbidden), false, `client must not contain ${forbidden}`);
  }

  assert.match(workspace, /type="file"/);
  assert.match(workspace, /accept="image\/png,image\/jpeg,image\/webp"/);
  assert.match(workspace, /The browser never supplies a storage path/);
  assert.equal(workspace.includes('name="contentRef"'), false);
  assert.equal(workspace.includes('name="filePath"'), false);
  assert.match(client, /\/api\/sod\/charts/);
  assert.match(client, /\/api\/sod\/generate/);
});

test("SOD result surface never injects provider HTML into the ExecutionOS DOM", async () => {
  const workspace = await source("src/components/SodWorkspace.jsx");
  assert.equal(workspace.includes("dangerouslySetInnerHTML"), false);
  assert.equal(workspace.includes("innerHTML"), false);
  assert.match(workspace, /Dashboard \{result\.analysis\?\.dashboard \? "available" : "not returned"\}/);
});
