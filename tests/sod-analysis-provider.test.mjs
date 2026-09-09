import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSodAnalysisRequest,
  invokeSodAnalysisProvider,
  normalizeSodAnalysisResult,
  SOD_GENERATION_INITIAL,
  SOD_GENERATION_REFRESH,
} from "../schwab-bridge/sod-analysis-provider.mjs";

function request(overrides = {}) {
  return {
    sourceDate: "2026-09-09",
    generationMode: SOD_GENERATION_INITIAL,
    charts: [
      {
        chartId: "nvda-5m",
        contentRef: "chart-upload:abc123",
        symbol: "NVDA",
        timeframe: "5m",
      },
    ],
    marketContext: { vix: 18.2 },
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    candidateProposals: [
      {
        candidateId: "sod-2026-09-09-nvda-vwap-reclaim-long",
        symbol: "NVDA",
        direction: "LONG",
        setup: "VWAP reclaim",
        thesis: "Reclaim and continuation.",
      },
    ],
    report: { markdown: "# SOD" },
    dashboard: { html: "<html></html>" },
    ...overrides,
  };
}

test("analysis request accepts orchestrator-issued chart refs and no filesystem authority", () => {
  const built = buildSodAnalysisRequest(request({ generationMode: SOD_GENERATION_REFRESH }));
  assert.equal(built.sourceDate, "2026-09-09");
  assert.equal(built.generationMode, SOD_GENERATION_REFRESH);
  assert.deepEqual(built.charts[0], {
    chartId: "nvda-5m",
    contentRef: "chart-upload:abc123",
    symbol: "NVDA",
    timeframe: "5m",
    label: null,
  });
});

test("analysis request refuses caller-controlled orchestration output paths and chart filesystem paths", () => {
  assert.throws(
    () => buildSodAnalysisRequest(request({ inboxPath: "/tmp/evil" })),
    (error) => error.code === "SOD_ANALYSIS_REQUEST_PATH_FORBIDDEN",
  );
  assert.throws(
    () => buildSodAnalysisRequest(request({ charts: [{ chartId: "x", filePath: "/tmp/x.png", contentRef: "ref" }] })),
    (error) => error.code === "SOD_ANALYSIS_CHART_PATH_FORBIDDEN",
  );
});

test("analysis provider may propose trade substance but not version lineage lifecycle or execution authority", () => {
  const normalized = normalizeSodAnalysisResult(result());
  assert.equal(normalized.candidateProposals.length, 1);

  for (const field of [
    "contractVersion",
    "generatedAt",
    "sourceDate",
    "lineageClassification",
    "publicationIntent",
    "lifecycleState",
    "armAuthorized",
    "selectedQuantity",
  ]) {
    assert.throws(
      () => normalizeSodAnalysisResult(result({
        candidateProposals: [{ ...result().candidateProposals[0], [field]: field === "contractVersion" ? 2 : true }],
      })),
      (error) => error.code === "SOD_ANALYSIS_PROVIDER_AUTHORITY_VIOLATION",
    );
  }
});

test("provider invocation validates both request and result around injected provider", async () => {
  const seen = [];
  const provider = {
    async generate(input) {
      seen.push(input);
      return result({ generationMetadata: { provider: "test-double" } });
    },
  };

  const invocation = await invokeSodAnalysisProvider(provider, request());
  assert.equal(seen.length, 1);
  assert.equal(seen[0].generationMode, SOD_GENERATION_INITIAL);
  assert.equal(invocation.result.generationMetadata.provider, "test-double");
});
