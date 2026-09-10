import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createSodChartStore } from "../schwab-bridge/sod-chart-store.mjs";
import { createSodOrchestrationApiServer } from "../schwab-bridge/sod-orchestration-api.mjs";

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
  const api = createSodOrchestrationApiServer({
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

test("SOD API ingests chart bytes, resolves only opaque refs, reads PRETRADE, and publishes without leaking paths", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-publish-"));
  const pretrade = pretradeFetch();
  let providerResolvedChart = null;
  const provider = {
    async generate(request, context) {
      providerResolvedChart = await context.resolveChart(request.charts[0].contentRef);
      return {
        candidateProposals: [proposal()],
        report: { markdown: "# SOD" },
        dashboard: { html: "<html>SOD</html>" },
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
    assert.deepEqual(pretrade.calls.map((item) => item.method), ["GET", "GET"]);
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

test("SOD API returns valid no-candidate analysis without creating a feeder publication", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-empty-"));
  const pretrade = pretradeFetch();
  const provider = {
    async generate() {
      return {
        candidateProposals: [],
        report: { markdown: "# SOD\n\nNo A+ candidates." },
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
    assert.deepEqual(await fs.readdir(inbox), []);
  } finally {
    await api.close();
    await fs.rm(inbox, { recursive: true, force: true });
  }
});
