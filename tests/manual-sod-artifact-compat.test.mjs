import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalizeManualSodArtifactContent } from "../schwab-bridge/manual-sod-artifact-compat.mjs";
import { writeManualSodPackage } from "../schwab-bridge/manual-sod-package.mjs";
import { SOD_REPORT_SECTIONS } from "../schwab-bridge/sod-artifact-content.mjs";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";

const SECTION_ALIASES = Object.freeze({
  2: "macro-context",
  7: "market-regime",
  8: "semiconductors",
  9: "software-ai",
  10: "momentum-special",
  11: "crude-oil",
});

function packageInput() {
  const { candidates, ...bundleMetadata } = JSON.parse(
    fs.readFileSync(new URL("../fixtures/v24-sod-candidates.example.json", import.meta.url), "utf8"),
  );
  return { artifactContent: sodArtifactContentFixture(), candidateProposals: candidates, bundleMetadata };
}

function tempPackage(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sod-compat-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, "package");
}

test("canonicalizer repairs known chat/manual section aliases and bullets without touching candidates", async t => {
  const input = packageInput();
  const originalCandidates = structuredClone(input.candidateProposals);
  for (const [index, alias] of Object.entries(SECTION_ALIASES)) input.artifactContent.sections[Number(index)].id = alias;
  input.artifactContent.sections[2].blocks = [{ type: "bullets", items: ["Macro context remains a bullet list."] }];

  const output = tempPackage(t);
  const result = await writeManualSodPackage(input, output);
  assert.equal(result.candidateDelivery.status, "DELIVERED");
  assert.deepEqual(input.candidateProposals, originalCandidates);

  const html = fs.readFileSync(result.report.htmlPath, "utf8");
  for (const section of SOD_REPORT_SECTIONS) assert.ok(html.includes(`id="${section.id}"`));
  for (const alias of Object.values(SECTION_ALIASES)) assert.equal(html.includes(`id="${alias}"`), false);
  assert.match(fs.readFileSync(result.report.markdownPath, "utf8"), /Macro context remains a bullet list\./);
});

test("canonicalizer repairs provider-style listItems and metricItems field names", () => {
  const content = sodArtifactContentFixture();
  content.sections[2].blocks = [{ type: "list", style: "bullet", listItems: ["One", "Two"] }];
  content.sections[4].blocks = [
    { type: "paragraph", text: "Current VIX context." },
    { type: "metrics", metricItems: [{ label: "VIX", value: "16.4", tone: "amber" }] },
  ];
  const canonical = canonicalizeManualSodArtifactContent(content);
  assert.deepEqual(canonical.sections[2].blocks[0].items, ["One", "Two"]);
  assert.deepEqual(canonical.sections[4].blocks[1].items, [{ label: "VIX", value: "16.4", tone: "amber" }]);
});

test("unknown section ids, wrong order, unknown block types, and missing VIX stay strict failures", async t => {
  const wrongSection = packageInput();
  wrongSection.artifactContent.sections[2].id = "scheduled-risk";
  await assert.rejects(writeManualSodPackage(wrongSection, tempPackage(t)), /SOD section 3 must be macro-overnight-context/);

  const badBlock = packageInput();
  badBlock.artifactContent.sections[2].blocks[0].type = "bulletz";
  await assert.rejects(writeManualSodPackage(badBlock, tempPackage(t)), /Unsupported SOD block type bulletz/);

  const missingVix = packageInput();
  missingVix.artifactContent.sections[4].blocks = [{ type: "paragraph", text: "Rates context without volatility index label." }];
  await assert.rejects(writeManualSodPackage(missingVix, tempPackage(t)), /must include current VIX context/);
});

test("exactly 19 canonical sections remains mandatory", async t => {
  const input = packageInput();
  input.artifactContent.sections.pop();
  await assert.rejects(writeManualSodPackage(input, tempPackage(t)), /requires exactly 19 report sections/);
});
