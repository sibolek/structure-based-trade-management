import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeManualTradeCardAnalysis } from "../../schwab-bridge/manual-trade-card-analysis.mjs";
import { writeManualTradeCardPackage } from "../../schwab-bridge/manual-trade-card-package.mjs";

for (const valid of [true, false]) {
  test(`standalone authored card keeps styling with candidate ${valid ? "delivered" : "withheld"}`, async ({ page }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-card-browser-"));
    try {
      const { candidates, ...bundleMetadata } = JSON.parse(fs.readFileSync(new URL("../../fixtures/v24-sod-candidates.example.json", import.meta.url), "utf8"));
      if (!valid) candidates[0].armAuthorized = false;
      const html = '<!doctype html><html><head><style>body{background:rgb(16,24,39);color:white}.card{max-width:780px;margin:auto}h1{font-size:32px}</style></head><body><main class="card"><h1>NVDA standalone trade card</h1><p>Authored chart analysis remains visible.</p></main></body></html>';
      const transport = writeManualTradeCardAnalysis({ artifactContent: { html }, candidateProposals: [candidates[0]], bundleMetadata }, "2026-08-29", "NVDA", path.join(dir, "transport"));
      const result = await writeManualTradeCardPackage(JSON.parse(fs.readFileSync(transport, "utf8")), path.join(dir, "package"));
      expect(fs.readFileSync(result.htmlPath, "utf8")).toBe(html);
      await page.setContent(fs.readFileSync(result.htmlPath, "utf8"));
      await expect(page.getByRole("heading", { name: "NVDA standalone trade card" })).toBeVisible();
      await expect(page.locator("body")).toHaveCSS("background-color", "rgb(16, 24, 39)");
      await expect(page.locator("h1")).toHaveCSS("font-size", "32px");
      await expect(page.getByText("Authored chart analysis remains visible.")).toBeVisible();
      expect(result.candidateDelivery.status).toBe(valid ? "DELIVERED" : "WITHHELD");
      expect(result.candidateDelivery.files).toHaveLength(valid ? 1 : 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}
