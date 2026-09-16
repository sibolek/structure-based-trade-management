import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeManualSodAnalysis } from "../../schwab-bridge/manual-sod-analysis.mjs";
import { writeManualSodPackage } from "../../schwab-bridge/manual-sod-package.mjs";
import { sodArtifactContentFixture } from "../helpers/sod-artifact-content-fixture.mjs";

for (const valid of [true, false]) {
  test(`manual SOD reports display A+ analysis and ${valid ? "delivered" : "withheld"} candidate status`, async ({ page }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-sod-browser-"));
    try {
      const { candidates, ...bundleMetadata } = JSON.parse(fs.readFileSync(new URL("../../fixtures/v24-sod-candidates.example.json", import.meta.url), "utf8"));
      candidates[0].thesis = "Independent A+ analysis remains visible";
      if (!valid) candidates[0].armAuthorized = false;
      const analysisPath = writeManualSodAnalysis({ artifactContent: sodArtifactContentFixture(), candidateProposals: candidates, bundleMetadata }, "2026-09-16", dir);
      const result = await writeManualSodPackage(JSON.parse(fs.readFileSync(analysisPath, "utf8")), path.join(dir, "package"));
      for (const file of [result.report.htmlPath, result.dashboard.htmlPath]) {
        await page.setContent(fs.readFileSync(file, "utf8"));
        await expect(page.locator("header.hero")).toContainText(valid ? "ExecutionOS candidate JSON delivered" : "ExecutionOS candidate JSON withheld: candidate validation failed");
        await expect(page.getByText("Independent A+ analysis remains visible", { exact: true }).first()).toBeVisible();
        await expect(page.getByRole("heading", { name: "15. A+ Trades", exact: true })).toBeVisible();
      }
      expect(result.candidateDelivery.status).toBe(valid ? "DELIVERED" : "WITHHELD");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
