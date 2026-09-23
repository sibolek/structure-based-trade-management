import { defineConfig } from "@playwright/test";
if (!process.env.PREVIEW_QUALIFICATION_OUTPUT_DIR) throw new Error("Use an explicit disposable browser output directory");
export default defineConfig({
  testDir: ".",
  testMatch: "pretrade-preview-recovery.spec.mjs",
  outputDir: process.env.PREVIEW_QUALIFICATION_OUTPUT_DIR,
  workers: 1,
  reporter: "line",
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4177", browserName: "chromium", headless: true },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 4177 --strictPort", url: "http://127.0.0.1:4177/tests/browser/pretrade-preview-harness.html", reuseExistingServer: false, timeout: 30000 },
});
