import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCanonicalContractAuthority,
  candidateContractHash,
} from "../schwab-bridge/pretrade-candidate-contract.mjs";
import { buildCanonicalSodCandidateBundle } from "../schwab-bridge/sod-candidate-export.mjs";
import { createSodChartStore } from "../schwab-bridge/sod-chart-store.mjs";
import {
  createSodOrchestrationApiServer,
  MAX_SOD_ORCHESTRATION_BODY_BYTES,
} from "../schwab-bridge/sod-orchestration-api.mjs";

const ORIGIN = "http://127.0.0.1:5173";
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function proposal(overrides = {}) {
  return {
    candidateId: "sod-2026-09-09-nvda-vwap-reclaim-long",
    symbol: "NVDA",
    direction: "LONG",
    setup: "VWAP reclaim",
    thesis: "Continuation after reclaim and hold.",
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
    managementContract: { mode: "SINGLE_ENTRY", allowReAdd: false, allowFlatReEntry: false },
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
    ...overrides,
  };
}

function request(chart) {
  return {
    sourceDate: "2026-09-09",
    generationMode: "REFRESH",
    charts: [{ chartId: chart.chartId, contentRef: chart.contentRef }],
  };
}

function canonicalPrior() {
  const bundle = buildCanonicalSodCandidateBundle({
    sourceDate: "2026-09-09",
    generatedAt: "2026-09-09T14:00:00.000Z",
    bundleId: "prior-bundle",
    candidates: [proposal()],
  }, { automatedPublication: true });
  const candidate = bundle.candidates[0];
  const hash = candidateContractHash(candidate);
  return {
    ...candidate,
    contentHash: hash,
    contractAuthority: buildCanonicalContractAuthority({
      contentHash: hash,
      bundleSource: "SOD_A_PLUS_TRADES",
      bundleId: "prior-bundle",
      acceptedAt: "2026-09-09T14:00:01.000Z",
    }),
    lifecycleState: "WAITING",
    stateRevision: 0,
    lifecycleJournal: { events: [], operations: [] },
  };
}

function pretradeFetch(snapshot) {
  return async (url) => ({
    ok: true,
    status: 200,
    async json() {
      if (String(url).endsWith("/health")) {
        return {
          ok: true,
          service: "executionos-v24-pretrade",
          candidateContractVersioning: true,
          readOnlyBrokerBoundary: true,
          brokerWriteAuthority: false,
        };
      }
      return structuredClone(snapshot);
    },
  });
}

async function start({ inbox, provider, snapshot = { candidates: [] } }) {
  const chartRoot = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-safety-charts-"));
  const chartStore = createSodChartStore({ rootPath: chartRoot });
  const api = createSodOrchestrationApiServer({
    provider,
    inboxPath: inbox,
    chartStore,
    allowedOrigin: ORIGIN,
    fetchImpl: pretradeFetch(snapshot),
    clock: () => "2026-09-09T16:00:00.000Z",
    sessionToken: "safety-session",
  });
  await new Promise((resolve) => api.server.listen(0, "127.0.0.1", resolve));
  const { port } = api.server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    chartStore,
    async close() {
      await new Promise((resolve) => api.server.close(resolve));
      await fs.rm(chartRoot, { recursive: true, force: true });
    },
  };
}

test("revised SOD remains unpublished at HTTP boundary pending authoritative PRETRADE preflight", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-preflight-"));
  const api = await start({
    inbox,
    snapshot: { candidates: [canonicalPrior()] },
    provider: {
      async generate() {
        return { candidateProposals: [proposal({ thesis: "Revised continuation thesis." })] };
      },
    },
  });
  try {
    const chart = await api.chartStore.ingest({ bytes: PNG_BYTES, mediaType: "image/png", displayName: "NVDA.png" });
    const response = await fetch(`${api.baseUrl}/api/sod/generate`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "content-type": "application/json",
        "x-executionos-sod-session": "safety-session",
      },
      body: JSON.stringify(request(chart)),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, "PRETRADE_PREFLIGHT_REQUIRED");
    assert.equal(payload.lineage[0].classification, "REVISED");
    assert.equal(payload.publication, null);
    assert.deepEqual(await fs.readdir(inbox), []);
  } finally {
    await api.close();
    await fs.rm(inbox, { recursive: true, force: true });
  }
});

test("oversized authorized SOD request receives clean 413 without invoking PRETRADE or provider", async () => {
  const inbox = await fs.mkdtemp(path.join(os.tmpdir(), "executionos-sod-api-body-"));
  let providerCalls = 0;
  const api = await start({
    inbox,
    provider: {
      async generate() {
        providerCalls += 1;
        return { candidateProposals: [] };
      },
    },
  });
  try {
    const response = await fetch(`${api.baseUrl}/api/sod/generate`, {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "content-type": "application/json",
        "x-executionos-sod-session": "safety-session",
      },
      body: JSON.stringify({ padding: "x".repeat(MAX_SOD_ORCHESTRATION_BODY_BYTES + 1) }),
    });
    const payload = await response.json();
    assert.equal(response.status, 413);
    assert.equal(payload.error, "SOD_ORCHESTRATION_BODY_TOO_LARGE");
    assert.equal(providerCalls, 0);
    assert.deepEqual(await fs.readdir(inbox), []);
  } finally {
    await api.close();
    await fs.rm(inbox, { recursive: true, force: true });
  }
});
