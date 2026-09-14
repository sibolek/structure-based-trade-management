import assert from "node:assert/strict";
import test from "node:test";

import {
  assignDeterministicSodCandidateIds,
  buildDeterministicSodCandidateId,
  buildOpenAiSodResponseRequest,
  createOpenAiSodAnalysisProvider,
  extractOpenAiWebSearchSources,
  parseOpenAiSodResponse,
} from "../schwab-bridge/sod-openai-analysis-provider.mjs";
import { normalizeSodAnalysisResult } from "../schwab-bridge/sod-analysis-provider.mjs";
import { SOD_REPORT_SECTIONS } from "../schwab-bridge/sod-artifact-content.mjs";

import { proposal, normalizedRequest, resolvedChart, emptyBlock, transportCandidate, transportResult, apiResponse } from "./helpers/sod-openai-fixture.mjs";

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

  // The schema enum and prompt share REPORT_SECTION_IDS; compare their actual
  // output with the independently frozen canonical renderer contract.
  const sectionIds = payload.text.format.schema.properties.artifactContent.properties.sections.items.properties.id.enum;
  const orderLine = payload.instructions.split("\n").find(line => line.startsWith("Canonical section IDs in required array order: "));
  assert.ok(orderLine);
  assert.deepEqual(JSON.parse(orderLine.slice(orderLine.indexOf(": ") + 2)), sectionIds);
  assert.deepEqual(sectionIds, SOD_REPORT_SECTIONS.map(section => section.id));
  assert.match(payload.instructions, /artifactContent\.sections must contain exactly 19 sections, with exactly one section for every canonical ID\./);
  assert.match(payload.instructions, /each array position must use the corresponding canonical ID/);
  assert.match(payload.instructions, /No section may be substituted by another allowed section ID/);
  assert.match(payload.instructions, /title and blocks must remain semantically associated with that section ID/);
  assert.match(payload.instructions, /If evidence is insufficient, state that inside the correct section rather than omitting, replacing, duplicating, or moving a section/);

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

test("completed page actions join the same authoritative provenance set", () => {
  for (const actionType of ["open_page", "find_in_page"]) {
    const transport = transportResult({ candidateProposals: [] });
    const response = apiResponse(transport);
    response.output[0].action = { type: actionType, url: "https://example.com/vix", sources: [] };
    response.output[0].status = "completed";
    const extracted = extractOpenAiWebSearchSources(response);
    assert.deepEqual(extracted.sourceUrls, ["https://example.com/vix"]);
    assert.equal(extracted.sourceArrayRawCount, 0);
    assert.equal(extracted.qualifyingPageActionCount, 1);
    assert.equal(extracted.qualifyingPageActionDistinctCount, 1);
    assert.equal(extracted.combinedAuthoritativeDistinctCount, 1);
    assert.doesNotThrow(() => parseOpenAiSodResponse({ response, request: normalizedRequest(), resolvedCharts: [resolvedChart()], model: "gpt-test" }));
  }
  const duplicate = apiResponse(transportResult({ candidateProposals: [] }));
  duplicate.output[0].status = "completed";
  duplicate.output[0].action = { type: "open_page", url: "https://example.com/vix", sources: [{ url: "https://example.com/vix" }] };
  assert.deepEqual(extractOpenAiWebSearchSources(duplicate).sourceUrls, ["https://example.com/vix"]);
  assert.equal(extractOpenAiWebSearchSources(duplicate).combinedAuthoritativeDistinctCount, 1);
});

test("page-action authority is exact, completed, and response-local", () => {
  const base = "https://example.com/vix";
  const make = (action, status = "completed") => {
    const response = apiResponse(transportResult({ candidateProposals: [] }));
    response.output[0].action = { ...action, sources: [] };
    response.output[0].status = status;
    return response;
  };
  for (const [label, action, status] of [
    ["failed open_page", { type: "open_page", url: base }, "failed"],
    ["incomplete find_in_page", { type: "find_in_page", url: base }, "incomplete"],
    ["search action", { type: "search", url: base }, "completed"],
    ["unknown action", { type: "other", url: base }, "completed"],
    ["malformed action", { type: "open_page", url: "not a URL" }, "completed"],
    ["non-http action", { type: "find_in_page", url: "javascript:alert(1)" }, "completed"],
  ]) {
    const response = make(action, status);
    assert.deepEqual(extractOpenAiWebSearchSources(response).sourceUrls, [], label);
  }
  const missingStatus = make({ type: "open_page", url: base });
  delete missingStatus.output[0].status;
  assert.deepEqual(extractOpenAiWebSearchSources(missingStatus).sourceUrls, []);
  const otherRun = make({ type: "open_page", url: "https://other.example/vix" });
  const current = make({ type: "open_page", url: base });
  assert.equal(extractOpenAiWebSearchSources(otherRun).sourceUrls.includes(base), false);
  assert.equal(extractOpenAiWebSearchSources(current).sourceUrls.includes(base), true);
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
