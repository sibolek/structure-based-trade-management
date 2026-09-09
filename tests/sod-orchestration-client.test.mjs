import assert from "node:assert/strict";
import test from "node:test";

import {
  createSodOrchestrationApiClient,
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
    lifecycleAuthority: false,
    armAuthority: false,
    executionAuthority: false,
    brokerWriteAuthority: false,
  };
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

test("SOD browser client fails closed on orchestration authority mismatch", async () => {
  const client = createSodOrchestrationApiClient({
    fetchImpl: async () => response(200, { ...healthy(), brokerWriteAuthority: true }),
  });
  await assert.rejects(
    client.health(),
    (error) => error.code === "SOD_CLIENT_CAPABILITY_MISMATCH",
  );
});

test("SOD browser client health-checks, bootstraps session, then generates through SOD service only", async () => {
  const calls = [];
  const client = createSodOrchestrationApiClient({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, method: options.method || "GET", headers: options.headers || {} });
      if (url.endsWith("/health")) return response(200, healthy());
      if (url.endsWith("/api/sod/session")) {
        return response(200, { service: SOD_ORCHESTRATION_SERVICE, sessionToken: "session-1" });
      }
      if (url.endsWith("/api/sod/generate")) {
        assert.equal(options.headers["x-executionos-sod-session"], "session-1");
        return response(200, { status: "NO_CANDIDATES", brokerWriteAuthority: false });
      }
      return response(404, { error: "NOT_FOUND" });
    },
  });

  const result = await client.generate({
    sourceDate: "2026-09-09",
    charts: [{ chartId: "chart-1", contentRef: "trusted:chart-1" }],
  });

  assert.equal(result.status, "NO_CANDIDATES");
  assert.deepEqual(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`), [
    "GET /health",
    "GET /api/sod/session",
    "POST /api/sod/generate",
  ]);
  assert.equal(calls.some((call) => call.url.includes("/api/candidates")), false);
  assert.equal(calls.some((call) => call.url.includes("/api/arm")), false);
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

  const result = await client.generate({ sourceDate: "2026-09-09", charts: [{ chartId: "c", contentRef: "trusted:c" }] });
  assert.equal(result.status, "NO_CANDIDATES");
  assert.equal(session, 2);
  assert.equal(generateAttempts, 2);
});
