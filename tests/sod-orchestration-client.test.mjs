import assert from "node:assert/strict";
import test from "node:test";

import {
  createSodOrchestrationApiClient,
  SOD_CHART_INGESTION_CAPABILITY,
  SOD_ORCHESTRATION_SERVICE,
} from "../src/sod/sod-orchestration-api-client.js";

function response(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function healthy() {
  return {
    ok: true,
    service: SOD_ORCHESTRATION_SERVICE,
    providerConfigured: true,
    pretradeAccess: "READ_ONLY_HTTP",
    candidatePublication: "ATOMIC_INBOX_ONLY",
    chartIngestion: SOD_CHART_INGESTION_CAPABILITY,
    chartMaxBytes: 8 * 1024 * 1024,
    lifecycleAuthority: false,
    armAuthority: false,
    executionAuthority: false,
    brokerWriteAuthority: false,
  };
}

function chartFile() {
  const file = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });
  Object.defineProperty(file, "name", { value: "NVDA 5m.png" });
  return file;
}

test("SOD browser client permits only loopback HTTP orchestration service", () => {
  assert.throws(
    () => createSodOrchestrationApiClient({ baseUrl: "https://127.0.0.1:8790", fetchImpl: async () => response(200, {}) }),
    (error) => error.code === "SOD_CLIENT_URL_INVALID",
  );
  assert.throws(
    () => createSodOrchestrationApiClient({ baseUrl: "http://example.com:8790", fetchImpl: async () => response(200, {}) }),
    (error) => error.code === "SOD_CLIENT_URL_INVALID",
  );
});

test("SOD browser client fails closed on orchestration authority or chart-ingestion mismatch", async () => {
  const brokerClient = createSodOrchestrationApiClient({
    fetchImpl: async () => response(200, { ...healthy(), brokerWriteAuthority: true }),
  });
  await assert.rejects(
    brokerClient.health(),
    (error) => error.code === "SOD_CLIENT_CAPABILITY_MISMATCH",
  );

  const chartClient = createSodOrchestrationApiClient({
    fetchImpl: async () => response(200, { ...healthy(), chartIngestion: "UNTRUSTED" }),
  });
  await assert.rejects(
    chartClient.health(),
    (error) => error.code === "SOD_CLIENT_CAPABILITY_MISMATCH",
  );
});

test("SOD browser client uploads chart bytes, reuses session, then generates through SOD service only", async () => {
  const calls = [];
  const descriptor = {
    chartId: "chart-upload-0001",
    contentRef: "sod-chart:upload-0001",
    mediaType: "image/png",
    byteLength: 8,
    sha256: "abc123",
    displayName: "NVDA 5m.png",
  };
  const client = createSodOrchestrationApiClient({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", headers: options.headers || {}, body: options.body });
      if (url.endsWith("/health")) return response(200, healthy());
      if (url.endsWith("/api/sod/session")) {
        return response(200, { service: SOD_ORCHESTRATION_SERVICE, sessionToken: "session-1" });
      }
      if (url.endsWith("/api/sod/charts")) {
        assert.equal(options.headers["x-executionos-sod-session"], "session-1");
        assert.equal(options.headers["content-type"], "image/png");
        assert.equal(options.headers["x-executionos-chart-name"], encodeURIComponent("NVDA 5m.png"));
        assert.equal(options.body instanceof Blob, true);
        return response(201, { chart: descriptor });
      }
      if (url.endsWith("/api/sod/generate")) {
        assert.equal(options.headers["x-executionos-sod-session"], "session-1");
        return response(200, { status: "NO_CANDIDATES", brokerWriteAuthority: false });
      }
      return response(404, { error: "NOT_FOUND" });
    },
  });

  const chart = await client.uploadChart(chartFile());
  assert.deepEqual(chart, descriptor);

  const result = await client.generate({
    sourceDate: "2026-09-09",
    charts: [{ chartId: chart.chartId, contentRef: chart.contentRef }],
  });

  assert.equal(result.status, "NO_CANDIDATES");
  assert.deepEqual(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), [
    "GET /health",
    "GET /api/sod/session",
    "POST /api/sod/charts",
    "GET /health",
    "POST /api/sod/generate",
  ]);
  assert.equal(calls.some((call) => call.url.includes("/api/candidates")), false);
  assert.equal(calls.some((call) => call.url.includes("/api/arm")), false);
});

test("SOD browser client rejects unsupported chart media before making a request", async () => {
  let calls = 0;
  const client = createSodOrchestrationApiClient({
    fetchImpl: async () => {
      calls += 1;
      return response(200, healthy());
    },
  });
  const file = new Blob(["<svg></svg>"], { type: "image/svg+xml" });
  await assert.rejects(
    client.uploadChart(file),
    (error) => error.code === "SOD_CLIENT_CHART_MEDIA_UNSUPPORTED",
  );
  assert.equal(calls, 0);
});

test("SOD browser client refreshes an expired service session once", async () => {
  let session = 0;
  let generateAttempts = 0;
  const client = createSodOrchestrationApiClient({
    fetchImpl: async (url) => {
      if (url.endsWith("/health")) return response(200, healthy());
      if (url.endsWith("/api/sod/session")) {
        session += 1;
        return response(200, { service: SOD_ORCHESTRATION_SERVICE, sessionToken: `session-${session}` });
      }
      if (url.endsWith("/api/sod/generate")) {
        generateAttempts += 1;
        if (generateAttempts === 1) return response(403, { error: "SOD_ORCHESTRATION_SESSION_FORBIDDEN" });
        return response(200, { status: "NO_CANDIDATES" });
      }
      return response(404, {});
    },
  });

  const result = await client.generate({ sourceDate: "2026-09-09", charts: [{ chartId: "c", contentRef: "sod-chart:trusted000" }] });
  assert.equal(result.status, "NO_CANDIDATES");
  assert.equal(session, 2);
  assert.equal(generateAttempts, 2);
});
