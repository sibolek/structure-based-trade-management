import assert from "node:assert/strict";
import test from "node:test";

import {
  assignDeterministicSodCandidateIds,
  buildDeterministicSodCandidateId,
  buildOpenAiSodResponseRequest,
  createOpenAiSodAnalysisProvider,
  parseOpenAiSodResponse,
} from "../schwab-bridge/sod-openai-analysis-provider.mjs";
import { normalizeSodAnalysisResult } from "../schwab-bridge/sod-analysis-provider.mjs";

function proposal(overrides = {}) {
  return {
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
    setup: "PML sweep → VWAP reclaim → continuation",
    thesis: "Reclaim holds and buyers defend VWAP.",
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function normalizedRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceDate: "2026-09-10",
    generationMode: "INITIAL",
    charts: [
      {
        chartId: "nvda-5m",
        contentRef: "sod-chart:abc",
        symbol: "NVDA",
        timeframe: "5m",
        label: "NVDA 5m",
      },
    ],
    marketContext: null,
    priorSodRef: null,
    ...overrides,
  };
}

function resolvedChart(overrides = {}) {
  return {
    chartId: "nvda-5m",
    contentRef: "sod-chart:abc",
    mediaType: "image/png",
    byteLength: 4,
    sha256: "abc",
    displayName: "nvda.png",
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    ...overrides,
  };
}

function emptyBlock(type = "paragraph", blockText = "Context") {
  return {
    type,
    text: blockText,
    tone: type === "callout" ? "blue" : null,
    style: type === "list" ? "bullet" : null,
    listItems: type === "list" ? ["Item"] : [],
    columns: [],
    rows: [],
    metricItems: [],
  };
}

const SECTION_IDS = [
  "executive-summary",
  "execution-discipline",
  "macro-overnight-context",
  "scheduled-risk",
  "rates-volatility-commodities",
  "mes",
  "mnq",
  "market-regime-breadth",
  "semiconductors-primary-sector",
  "mega-cap-tech",
  "momentum-special-situations",
  "crude-oil-mcl",
  "key-levels",
  "validation-no-trade-zones",
  "a-plus-trades",
  "morning-priority",
  "earnings-risk-events",
  "risk-management",
  "opening-game-plan",
];

function transportCandidate(overrides = {}) {
  return {
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
    setup: "VWAP reclaim",
    decisionTimeframe: "5m",
    entryTimeframe: "2m",
    volatilityTimeframe: "2m",
    thesis: "Reclaim and hold with improving momentum.",
    plan: {
      bullCase: "Hold above VWAP.",
      bearCase: "Lose reclaim structure.",
      noTradeZone: "Mid-range chop.",
      bestLocation: "VWAP retest.",
    },
    trigger: {
      combination: "SINGLE",
      conditions: [{
        type: "QUOTE_COMPARISON",
        prompt: null,
        side: "LAST",
        operator: "GT",
        value: 180,
        timeframe: null,
        referenceLabel: "VWAP reclaim",
      }],
      persistence: { type: "CONDITION_HELD", timeframe: null },
    },
    structuralInvalidation: {
      price: 178.5,
      rule: "Break below reclaim low",
      referenceType: "SWING_LOW",
      reason: "Long thesis invalid",
      sourceTimeframe: "2m",
      referenceLabel: "reclaim low",
    },
    entryIntent: { mode: "BREAKOUT_PULLBACK" },
    plannedEntryReference: { label: "VWAP hold", price: 180 },
    entryConstraints: { summary: "Do not chase extension." },
    disqualifiers: ["Failed reclaim"],
    noTradeConditions: ["Mid-range chop"],
    targets: [
      { label: "T1", price: 181, reference: null },
      { label: "T2", price: 182, reference: null },
    ],
    managementContract: {
      mode: "SINGLE_ENTRY",
      allowReAdd: false,
      allowFlatReEntry: false,
    },
    bestLocation: "VWAP retest",
    context: "Bullish intraday structure",
    catalyst: "Relative strength",
    rating: "A+",
    morningPriority: 1,
    sourceProvenance: {
      chartIds: ["nvda-5m"],
      researchSourceUrls: ["https://example.com/vix"],
    },
    validity: {
      validFrom: "2026-09-10T13:30:00.000Z",
      validUntil: "2026-09-10T20:00:00.000Z",
      timezone: "America/New_York",
      session: "RTH",
    },
    armPolicy: { requestedMode: "MANUAL" },
    ...overrides,
  };
}

function transportResult(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactContent: {
      hero: {
        kicker: "ExecutionOS • Start of Day",
        title: "Start of Day — 2026-09-10",
        snapshot: "Premarket snapshot",
        badges: [],
      },
      sections: SECTION_IDS.map((id) => ({
        id,
        title: id,
        blocks: [emptyBlock("paragraph", id === "rates-volatility-commodities" ? "VIX 18.2; volatility contained." : `${id} context`)],
      })),
      sources: [{ label: "VIX source", url: "https://example.com/vix", note: "Current-session context" }],
    },
    candidateProposals: [transportCandidate()],
    researchEvidence: [{
      category: "VIX",
      classification: "CURRENT_SESSION",
      label: "CBOE VIX",
      value: "18.2",
      asOf: "2026-09-10T13:15:00Z",
      sourceUrls: ["https://example.com/vix"],
    }],
    ...overrides,
  };
}

function apiResponse(transport = transportResult(), overrides = {}) {
  return {
    id: "resp_test",
    status: "completed",
    model: "gpt-test",
    created_at: 1789045200,
    output: [
      {
        type: "web_search_call",
        action: { sources: [{ url: "https://example.com/vix" }] },
      },
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(transport) }],
      },
    ],
    usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
    ...overrides,
  };
}

test("deterministic candidate identity is stable across free-form setup wording changes", () => {
  const first = buildDeterministicSodCandidateId({
    sourceDate: "2026-09-10",
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
  });
  const second = assignDeterministicSodCandidateIds({
    sourceDate: "2026-09-10",
    candidateProposals: [proposal({ setup: "VWAP reclaim and H2 continuation" })],
  })[0].candidateId;

  assert.equal(first, "sod-2026-09-10-nvda-vwap-reclaim-long");
  assert.equal(second, first);
});

test("different semantic setup keys create different candidate identities", () => {
  const vwap = buildDeterministicSodCandidateId({
    sourceDate: "2026-09-10",
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "VWAP_RECLAIM",
  });
  const breakout = buildDeterministicSodCandidateId({
    sourceDate: "2026-09-10",
    symbol: "NVDA",
    direction: "LONG",
    setupKey: "BREAKOUT_PULLBACK",
  });

  assert.notEqual(vwap, breakout);
  assert.equal(breakout, "sod-2026-09-10-nvda-breakout-pullback-long");
});

test("model-authored candidate identity is forbidden", () => {
  for (const override of [
    { candidateId: "model-picked-id" },
    { candidateKey: "model-picked-key" },
  ]) {
    assert.throws(
      () => assignDeterministicSodCandidateIds({
        sourceDate: "2026-09-10",
        candidateProposals: [proposal(override)],
      }),
      (error) => error.code === "SOD_OPENAI_CANDIDATE_IDENTITY_AUTHORITY_FORBIDDEN",
    );
  }
});

test("unsupported setup keys fail closed rather than deriving identity from prose", () => {
  assert.throws(
    () => assignDeterministicSodCandidateIds({
      sourceDate: "2026-09-10",
      candidateProposals: [proposal({ setupKey: "VWAP_RECLAIM_H2_SPECIAL" })],
    }),
    (error) => error.code === "SOD_OPENAI_SETUP_KEY_UNSUPPORTED",
  );
});

test("duplicate semantic identities fail closed", () => {
  assert.throws(
    () => assignDeterministicSodCandidateIds({
      sourceDate: "2026-09-10",
      candidateProposals: [
        proposal({ setup: "VWAP reclaim" }),
        proposal({ setup: "VWAP reclaim with H2" }),
      ],
    }),
    (error) => error.code === "SOD_OPENAI_CANDIDATE_ID_COLLISION",
  );
});

test("private setupKey is stripped before the generic provider boundary", () => {
  const candidates = assignDeterministicSodCandidateIds({
    sourceDate: "2026-09-10",
    candidateProposals: [proposal()],
  });

  assert.equal(candidates[0].candidateId, "sod-2026-09-10-nvda-vwap-reclaim-long");
  assert.equal("setupKey" in candidates[0], false);
  assert.doesNotThrow(() => normalizeSodAnalysisResult({
    candidateProposals: candidates,
    artifactContent: null,
  }));
});

test("Responses request is stateless, requires web search, uses strict schema, and sends authorized charts as data URLs", () => {
  const payload = buildOpenAiSodResponseRequest({
    request: normalizedRequest(),
    resolvedCharts: [resolvedChart()],
    model: "gpt-test",
    maxToolCalls: 7,
  });

  assert.equal(payload.model, "gpt-test");
  assert.equal(payload.store, false);
  assert.deepEqual(payload.tools, [{ type: "web_search" }]);
  assert.equal(payload.tool_choice, "required");
  assert.equal(payload.max_tool_calls, 7);
  assert.deepEqual(payload.include, ["web_search_call.action.sources"]);
  assert.equal(payload.text.format.type, "json_schema");
  assert.equal(payload.text.format.strict, true);
  assert.equal(payload.text.format.schema.additionalProperties, false);

  const image = payload.input[0].content.find((item) => item.type === "input_image");
  assert.match(image.image_url, /^data:image\/png;base64,/);
  assert.equal(image.detail, "high");
  assert.doesNotMatch(JSON.stringify(payload.text.format.schema), /candidateId/);
});

test("completed mocked response maps into provider result with deterministic identity and safe metadata", () => {
  const parsed = parseOpenAiSodResponse({
    response: apiResponse(),
    request: normalizedRequest(),
    resolvedCharts: [resolvedChart()],
    model: "gpt-test",
    clock: () => "2026-09-10T13:20:00.000Z",
  });

  assert.equal(parsed.candidateProposals[0].candidateId, "sod-2026-09-10-nvda-vwap-reclaim-long");
  assert.equal("setupKey" in parsed.candidateProposals[0], false);
  assert.equal(parsed.candidateProposals[0].armPolicy.requestedMode, "MANUAL");
  assert.equal(parsed.artifactContent.sections.length, 19);
  assert.equal(parsed.generationMetadata.provider, "openai");
  assert.equal(parsed.generationMetadata.webSearchCallCount, 1);
  assert.equal(parsed.generationMetadata.sourceCount, 1);
  assert.equal(parsed.generationMetadata.usage.total_tokens, 300);
  assert.equal("apiKey" in parsed.generationMetadata, false);
});

test("provider factory resolves only request charts and invokes injected client once", async () => {
  const calls = [];
  const client = {
    responses: {
      async create(payload) {
        calls.push(payload);
        return apiResponse();
      },
    },
  };
  const provider = createOpenAiSodAnalysisProvider({
    client,
    model: "gpt-test",
    clock: () => "2026-09-10T13:20:00.000Z",
  });
  const resolvedRefs = [];
  const result = await provider.generate(normalizedRequest(), {
    async resolveChart(contentRef) {
      resolvedRefs.push(contentRef);
      return resolvedChart();
    },
  });

  assert.deepEqual(resolvedRefs, ["sod-chart:abc"]);
  assert.equal(calls.length, 1);
  assert.equal(result.candidateProposals[0].candidateId, "sod-2026-09-10-nvda-vwap-reclaim-long");
});

test("response parsing fails closed when web research is missing or source claims do not match actual search sources", () => {
  assert.throws(
    () => parseOpenAiSodResponse({
      response: apiResponse(transportResult(), { output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(transportResult()) }] }] }),
      request: normalizedRequest(),
      resolvedCharts: [resolvedChart()],
      model: "gpt-test",
    }),
    (error) => error.code === "SOD_OPENAI_RESEARCH_REQUIRED",
  );

  const mismatch = transportResult({
    researchEvidence: [{
      category: "VIX",
      classification: "CURRENT_SESSION",
      label: "VIX",
      value: "18.2",
      asOf: "2026-09-10T13:15:00Z",
      sourceUrls: ["https://different.example/vix"],
    }],
  });
  assert.throws(
    () => parseOpenAiSodResponse({
      response: apiResponse(mismatch),
      request: normalizedRequest(),
      resolvedCharts: [resolvedChart()],
      model: "gpt-test",
    }),
    (error) => error.code === "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH",
  );
});

test("candidate provenance may reference only authorized charts and actual web-search sources", () => {
  const badChart = transportResult({
    candidateProposals: [transportCandidate({
      sourceProvenance: { chartIds: ["secret-chart"], researchSourceUrls: ["https://example.com/vix"] },
    })],
  });
  assert.throws(
    () => parseOpenAiSodResponse({
      response: apiResponse(badChart),
      request: normalizedRequest(),
      resolvedCharts: [resolvedChart()],
      model: "gpt-test",
    }),
    (error) => error.code === "SOD_OPENAI_CANDIDATE_PROVENANCE_INVALID",
  );

  const badSource = transportResult({
    candidateProposals: [transportCandidate({
      sourceProvenance: { chartIds: ["nvda-5m"], researchSourceUrls: ["https://different.example/news"] },
    })],
  });
  assert.throws(
    () => parseOpenAiSodResponse({
      response: apiResponse(badSource),
      request: normalizedRequest(),
      resolvedCharts: [resolvedChart()],
      model: "gpt-test",
    }),
    (error) => error.code === "SOD_OPENAI_CANDIDATE_PROVENANCE_INVALID",
  );
});

test("provider sanitizes upstream authentication failures", async () => {
  const provider = createOpenAiSodAnalysisProvider({
    client: { responses: { async create() { throw Object.assign(new Error("secret upstream detail"), { status: 401 }); } } },
    model: "gpt-test",
  });

  await assert.rejects(
    () => provider.generate(normalizedRequest(), { async resolveChart() { return resolvedChart(); } }),
    (error) => error.code === "SOD_OPENAI_AUTH_FAILED" && !error.message.includes("secret upstream detail"),
  );
});
