import crypto from "node:crypto";
import { createSodRunStore } from "../schwab-bridge/sod-run-store.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSodChartStore } from "../schwab-bridge/sod-chart-store.mjs";
import { createSodOrchestrationApiServer } from "../schwab-bridge/sod-orchestration-api.mjs";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";

const ALLOWED_ORIGIN = "http://127.0.0.1:5173";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function proposal() {
  return {
    candidateId: "sod-2026-09-09-nvda-vwap-reclaim-long",
    symbol: "NVDA",
    direction: "LONG",
    setup: "VWAP reclaim",
    decisionTimeframe: "5m",
    entryTimeframe: "2m",
    volatilityTimeframe: "2m",
    timeframe: "2m",
    thesis: "Continuation after reclaim and hold.",
    plan: null,
    trigger: {
      schemaVersion: 1,
      evaluatorVersion: 1,
      satisfaction: {
        nodeId: "operator-confirm-vwap-reclaim",
        type: "MANUAL_CONFIRMATION",
        prompt: "Confirm VWAP reclaim and hold",
      },
      persistence: { type: "ONE_SHOT" },
    },
    structuralInvalidation: {
      price: 178.5,
      rule: "break below reclaim low",
      referenceType: "SWING_LOW",
      reason: "long thesis invalid",
      sourceTimeframe: "2m",
    },
    targets: [{ targetId: "T1", label: "T1", price: 181 }],
    managementContract: {
      mode: "SINGLE_ENTRY",
      allowReAdd: false,
      allowFlatReEntry: false,
    },
    rating: "A+",
    morningPriority: 1,
    sourceProvenance: { chartSet: "sod-2026-09-09" },
    validity: {
      validFrom: "2026-09-09T13:30:00.000Z",
      validUntil: "2026-09-09T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
      sourceLabel: "SOD",
      provenance: { tradeDate: "2026-09-09" },
    },
    armPolicy: { requestedMode: "MANUAL" },
  };
}

function analysisRequest(chart) {
  return {
    runId: crypto.randomUUID(),
    sourceDate: "2026-09-09",
    generationMode: "INITIAL",
    charts: [{
      chartId: chart.chartId,
      contentRef: chart.contentRef,
      symbol: "NVDA",
      timeframe: "5m",
    }],
    marketContext: { session: "RTH" },
  };
}

function pretradeFetch(snapshot = { candidates: [] }) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method });
    if (String(url).endsWith("/health")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            service: "executionos-v24-pretrade",
            candidateContractVersioning: true,
            readOnlyBrokerBoundary: true,
            brokerWriteAuthority: false,
          };
        },
      };
    }
    if (String(url).endsWith("/api/candidates")) {
      return {
        ok: true,
        status: 200,
        async json() { return structuredClone(snapshot); },
      };
    }
    return { ok: false, status: 404, async json() { return {}; } };
  };
  return { fetchImpl, calls };
}

async function startApi({ provider, inboxPath, fetchImpl }) {
  const chartRoot = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-chart-store-"));
  const chartStore = createSodChartStore({ rootPath: chartRoot });
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sod-run-api-"));
  const runStore = createSodRunStore({ rootPath: runRoot });
  const api = createSodOrchestrationApiServer({
    runStore,
    provider,
    inboxPath,
    chartStore,
    allowedOrigin: ALLOWED_ORIGIN,
    pretradeUrl: "http://127.0.0.1:8788",
    fetchImpl,
    clock: () => "2026-09-09T15:00:00.000Z",
    publicationIdFactory: () => "api-test",
    sessionToken: "test-session-token",
  });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  const address = api.server.address();
  return {
    ...api,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      runStore.close();
      await fs.rm(runRoot, { recursive: true, force: true });
      await new Promise((resolve, reject) => api.server.close((error) => error ? reject(error) : resolve()));
      await fs.rm(chartRoot, { recursive: true, force: true });
    },
  };
}

async function getJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  return { response, payload };
}

async function uploadChart(api, name = "NVDA-5m.png") {
  const uploaded = await getJson(`${api.baseUrl}/api/sod/charts`, {
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      "content-type": "image/png",
      "x-executionos-chart-name": encodeURIComponent(name),
      "x-executionos-sod-session": "test-session-token",
    },
    body: PNG_BYTES,
  });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.payload.chart.contentRef.startsWith("sod-chart:"), true);
  assert.equal("path" in uploaded.payload.chart, false);
  return uploaded.payload.chart;
}

test("SOD API requires exact browser origin and session before generation", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-auth-"));
  const pretrade = pretradeFetch();
  const provider = { async generate() { return { candidateProposals: [proposal()] }; } };
  const api = await startApi({ provider, inboxPath: inbox, fetchImpl: pretrade.fetchImpl });
  try {
    const wrongOrigin = await getJson(`${api.baseUrl}/api/sod/session`, {
      headers: { Origin: "http://127.0.0.1:9999" },
    });
    assert.equal(wrongOrigin.response.status, 403);

    const missingSession = await getJson(`${api.baseUrl}/api/sod/generate`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        runId: crypto.randomUUID(),
        sourceDate: "2026-09-09",
        charts: [{ chartId: "fabricated", contentRef: "sod-chart:fabricated00" }],
      }),
    });
    assert.equal(missingSession.response.status, 403);
    assert.equal(pretrade.calls.length, 0);
  } finally {
    await api.close();
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("SOD API ingests chart bytes, resolves opaque refs, renders deterministically, reads PRETRADE, and publishes without leaking paths", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-publish-"));
  const pretrade = pretradeFetch();
  let providerResolvedChart = null;
  const provider = {
    async generate(request, context) {
      providerResolvedChart = await context.resolveChart(request.charts[0].contentRef);
      return {
        candidateProposals: [proposal()],
        artifactContent: sodArtifactContentFixture(),
      };
    },
  };
  const api = await startApi({ provider, inboxPath: inbox, fetchImpl: pretrade.fetchImpl });
  try {
    const session = await getJson(`${api.baseUrl}/api/sod/session`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(session.response.status, 200);
    assert.equal(session.payload.sessionToken, "test-session-token");

    const chart = await uploadChart(api);
    const generated = await getJson(`${api.baseUrl}/api/sod/generate`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        "x-executionos-sod-session": session.payload.sessionToken,
      },
      body: JSON.stringify(analysisRequest(chart)),
    });

    assert.equal(generated.response.status, 200);
    assert.equal(generated.payload.status, "READY_TO_PUBLISH");
    assert.equal(generated.payload.lineage[0].classification, "NEW");
    assert.equal(generated.payload.publication.finalName.endsWith(".json"), true);
    assert.equal("finalPath" in generated.payload.publication, false);
    assert.equal(JSON.stringify(generated.payload).includes(inbox), false);
    assert.equal(generated.payload.brokerWriteAuthority, false);
    assert.equal(generated.payload.analysis.rendererVersion, 1);
    assert.match(generated.payload.analysis.report.html, /NVDA/);
    assert.match(generated.payload.analysis.report.markdown, /Confirm VWAP reclaim and hold/);
    assert.match(generated.payload.analysis.dashboard.html, /Long Candidates/);
    assert.deepEqual(pretrade.calls.map((item) => item.method), ["GET", "GET", "GET", "GET", "GET", "GET"]);
    assert.equal(Buffer.compare(providerResolvedChart.bytes, PNG_BYTES), 0);
    assert.equal("path" in providerResolvedChart, false);

    const names = await fs.readdir(inbox);
    assert.deepEqual(names, [generated.payload.publication.finalName]);
    const parsed = JSON.parse(await fs.readFile(path.join(inbox, names[0]), "utf8"));
    assert.equal(parsed.candidates[0].candidateId, proposal().candidateId);
  } finally {
    await api.close();
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("SOD API rejects fabricated chart refs before any PRETRADE read", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-forged-ref-"));
  const pretrade = pretradeFetch();
  let providerCalls = 0;
  const api = await startApi({
    inboxPath: inbox,
    fetchImpl: pretrade.fetchImpl,
    provider: {
      async generate() {
        providerCalls += 1;
        return { candidateProposals: [] };
      },
    },
  });
  try {
    const generated = await getJson(`${api.baseUrl}/api/sod/generate`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        "x-executionos-sod-session": "test-session-token",
      },
      body: JSON.stringify({
        runId: crypto.randomUUID(),
        sourceDate: "2026-09-09",
        charts: [{ chartId: "chart-fabricated00", contentRef: "sod-chart:fabricated00" }],
      }),
    });
    assert.equal(generated.response.status, 400);
    assert.equal(generated.payload.error, "SOD_CHART_REF_UNAVAILABLE");
    assert.equal(pretrade.calls.length, 0);
    assert.equal(providerCalls, 0);
  } finally {
    await api.close();
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("SOD API returns valid rendered no-candidate analysis without creating a feeder publication", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-empty-"));
  const pretrade = pretradeFetch();
  const provider = {
    async generate() {
      return {
        candidateProposals: [],
        artifactContent: sodArtifactContentFixture({ sectionText: "No A+ candidates." }),
      };
    },
  };
  const api = await startApi({ provider, inboxPath: inbox, fetchImpl: pretrade.fetchImpl });
  try {
    const chart = await uploadChart(api, "QQQ-5m.png");
    const generated = await getJson(`${api.baseUrl}/api/sod/generate`, {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        "content-type": "application/json",
        "x-executionos-sod-session": "test-session-token",
      },
      body: JSON.stringify(analysisRequest(chart)),
    });
    assert.equal(generated.response.status, 200);
    assert.equal(generated.payload.status, "NO_CANDIDATES");
    assert.equal(generated.payload.publication, null);
    assert.equal(generated.payload.analysis.report.markdown.includes("No A\\+ candidates"), true);
    assert.deepEqual(await fs.readdir(inbox), []);
  } finally {
    await api.close();
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("SOD run status and abandonment preserve session auth; lost HTTP response replay is terminal", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "sod-api-replay-"));
  let calls = 0;
  const api = await startApi({ provider: { async generate() { calls++; return { candidateProposals: [], artifactContent: sodArtifactContentFixture() }; } }, inboxPath: inbox, fetchImpl: pretradeFetch().fetchImpl });
  try {
    const chart = await uploadChart(api); const request = analysisRequest(chart);
    const headers = { Origin: ALLOWED_ORIGIN, "content-type": "application/json", "x-executionos-sod-session": "test-session-token" };
    const first = await getJson(`${api.baseUrl}/api/sod/generate`, { method: "POST", headers, body: JSON.stringify(request) });
    const replay = await getJson(`${api.baseUrl}/api/sod/generate`, { method: "POST", headers, body: JSON.stringify(request) });
    assert.deepEqual(replay.payload, first.payload); assert.equal(calls, 1);
    const statusUrl = `${api.baseUrl}/api/sod/runs/${request.runId}`;
    assert.equal((await getJson(statusUrl)).response.status, 403);
    assert.equal((await getJson(statusUrl, { headers })).payload.stage, "NO_CANDIDATES");
    assert.equal((await getJson(`${statusUrl}/abandon`, { method: "POST", headers })).payload.error, "SOD_RUN_ABANDON_NOT_ELIGIBLE");
    const conflict = await getJson(`${api.baseUrl}/api/sod/generate`, { method: "POST", headers, body: JSON.stringify({ ...request, priorSodRef: "changed" }) });
    assert.equal(conflict.response.status, 409); assert.equal(calls, 1);
  } finally { await api.close(); await fs.rm(inbox, { recursive: true, force: true }); }
});
test("SOD API exposes ambiguous recovery and eligible explicit abandonment without leaking errors", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "sod-api-abandon-"));
  let calls = 0;
  const api = await startApi({ provider: { async generate() { calls++; throw new Error("Authorization: Bearer private-secret /private/local/path"); } }, inboxPath: inbox, fetchImpl: pretradeFetch().fetchImpl });
  try {
    const chart = await uploadChart(api); const request = analysisRequest(chart);
    const headers = { Origin: ALLOWED_ORIGIN, "content-type": "application/json", "x-executionos-sod-session": "test-session-token" };
    const failed = await getJson(`${api.baseUrl}/api/sod/generate`, { method: "POST", headers, body: JSON.stringify(request) });
    assert.equal(failed.response.status, 409); assert.equal(failed.payload.stage, "RECOVERY_REQUIRED");
    assert.doesNotMatch(JSON.stringify(failed.payload), /private-secret|Bearer|\/private\/local/);
    const statusUrl = `${api.baseUrl}/api/sod/runs/${request.runId}`;
    assert.equal((await getJson(`${statusUrl}/abandon`, { method: "POST" })).response.status, 403);
    assert.equal((await getJson(`${statusUrl}/abandon`, { method: "POST", headers })).payload.stage, "ABANDONED");
    assert.equal((await getJson(`${api.baseUrl}/api/sod/generate`, { method: "POST", headers, body: JSON.stringify(request) })).payload.stage, "ABANDONED");
    assert.equal(calls, 1);
  } finally { await api.close(); await fs.rm(inbox, { recursive: true, force: true }); }
});
test("SOD health truthfully reports loaded but unconfigured provider without network", async () => {
  const { createOpenAiSodProductionProvider } = await import("../schwab-bridge/sod-openai-production-provider.mjs");
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "sod-api-readiness-"));
  const api = await startApi({ provider: createOpenAiSodProductionProvider({ env: {}, fetchImpl: async () => { throw new Error("network forbidden"); } }), inboxPath: inbox,
    fetchImpl: async () => { throw new Error("PRETRADE health must not be called"); } });
  try {
    const { payload } = await getJson(`${api.baseUrl}/health`);
    assert.equal(payload.providerLoaded, true); assert.equal(payload.providerConfigured, false);
    assert.equal(payload.modelConfigured, false); assert.equal(payload.liveAcceptanceValidated, false);
  } finally { await api.close(); await fs.rm(inbox, { recursive: true, force: true }); }
});
