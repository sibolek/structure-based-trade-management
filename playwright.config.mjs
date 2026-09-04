import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "VITE_EXECUTIONOS_V24_ROUTER_ENABLED=true npm run dev -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174/tests/browser/v24-router-harness.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
