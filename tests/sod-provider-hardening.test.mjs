import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { sanitizeSodResearchDiagnostics, SOD_RESEARCH_DIAGNOSTIC_LIMITS as DL } from "../schwab-bridge/sod-research-diagnostics.mjs";
import { sanitizeSodTransportDiagnostics } from "../schwab-bridge/sod-transport-diagnostics.mjs";
import { parseStrictSodJson, SOD_PROVIDER_LIMITS as L, serializeSodProviderRequest } from "../schwab-bridge/sod-provider-validation.mjs";
import { normalizeSodArtifactContent } from "../schwab-bridge/sod-artifact-content.mjs";
import { invokeSodAnalysisProvider } from "../schwab-bridge/sod-analysis-provider.mjs";
import { createOpenAiSodAnalysisProvider, extractOpenAiWebSearchSources, parseOpenAiSodResponse, buildOpenAiSodResponseRequest } from "../schwab-bridge/sod-openai-analysis-provider.mjs";
import { createOpenAiResponsesFetchClient } from "../schwab-bridge/sod-openai-production-provider.mjs";
import { sodArtifactContentFixture } from "./helpers/sod-artifact-content-fixture.mjs";
import { transportResult, apiResponse, normalizedRequest, resolvedChart } from "./helpers/sod-openai-fixture.mjs";
const parse = (transport = transportResult(), response = apiResponse(transport)) => parseOpenAiSodResponse({ response, request: normalizedRequest(), resolvedCharts: [resolvedChart()], model: "gpt-test" });

function researchCase(citations, sources = ["https://example.com/vix"]) {
  const transport = transportResult({ candidateProposals: [] });
  transport.researchEvidence[0].sourceUrls = citations;
  const response = apiResponse(transport);
  response.output[0].action.sources = sources.map(url => ({ url }));
  return { transport, response };
}
function researchFailure(citations, sources) {
  const { transport, response } = researchCase(citations, sources);
  let error;
  assert.throws(() => parse(transport, response), e => { error = e; return e.code === "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH"; });
  return error.semanticDiagnostics;
}

for (const [label, url] of [
  ["exact match", "https://example.com/vix"],
  ["ignored fragment", "https://example.com/vix#section"],
  ["stripped tracking parameters", "https://example.com/vix?utm_source=x&UTM_medium=y"],
  ["equivalent trailing slashes", "https://example.com/vix///"],
  ["hostname case", "https://EXAMPLE.COM/vix"],
]) test(`research provenance ${label} still succeeds without modifying input`, () => {
  const { transport, response } = researchCase([url]);
  const before = structuredClone({ transport, response });
  assert.doesNotThrow(() => parse(transport, response));
  assert.deepEqual({ transport, response }, before);
});

for (const [label, url, reason] of [
  ["same host different path", "https://example.com/other", "SOURCE_NOT_IN_WEB_SEARCH_SET"],
  ["unsupported citation", "https://unseen.example/vix", "SOURCE_NOT_IN_WEB_SEARCH_SET"],
  ["malformed citation", "not a URL", "INVALID_URL"],
  ["unsupported scheme", "javascript:alert(1)", "INVALID_URL"],
  ["retained query difference", "https://example.com/vix?date=2026-09-11", "SOURCE_NOT_IN_WEB_SEARCH_SET"],
  ["path case difference", "https://example.com/VIX", "SOURCE_NOT_IN_WEB_SEARCH_SET"],
  ["percent encoded path difference", "https://example.com/%76ix", "SOURCE_NOT_IN_WEB_SEARCH_SET"],
]) test(`research provenance ${label} remains rejected with bounded evidence`, () => {
  const d = researchFailure([url]);
  assert.equal(d.validatorStage, "RESEARCH_SOURCE_MEMBERSHIP");
  assert.equal(d.mismatchCount, 1); assert.equal(d.extractedSourceCount, 1);
  assert.equal(d.mismatches[0].researchIndex, 0); assert.equal(d.mismatches[0].sourceUrlIndex, 0);
  assert.equal(d.mismatches[0].category, "VIX"); assert.equal(d.mismatches[0].reason, reason);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) <= DL.bytes);
});

test("component hashes distinguish path, query, percent encoding and ignored normalization features", () => {
  const d = researchFailure(["https://EXAMPLE.COM/%76ix///?date=secret&utm_source=private#hidden"]);
  const a = d.mismatches[0].url, b = d.extractedSources[0];
  assert.equal(a.hostSha256, b.hostSha256); assert.notEqual(a.pathSha256, b.pathSha256);
  assert.equal(a.decodedPathSha256, b.decodedPathSha256); assert.notEqual(a.querySha256, b.querySha256);
  for (const key of ["fragmentPresent", "utmRemoved", "trailingSlashRemoved", "hostnameCaseNormalized", "percentEncodingPresent", "queryRetained"]) assert.equal(a[key], true, key);
  assert.doesNotMatch(JSON.stringify(d), /secret|private|hidden|example\.com|date=/);
});

test("empty extracted source set records missing arrays, invalid sources and non-authoritative URL observations", () => {
  const { transport, response } = researchCase(["https://example.com/vix"], []);
  response.output[0].action.sources = [{ url: "not a URL" }];
  response.output[0].action.url = "https://example.com/vix";
  response.output.push({ type: "web_search_call", action: {} });
  response.output[1].content[0].annotations = [{ type: "url_citation", url: "https://example.com/vix" }];
  assert.throws(() => parse(transport, response), e => {
    const d = e.semanticDiagnostics;
    assert.equal(e.code, "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH");
    assert.equal(d.mismatches[0].reason, "EMPTY_EXTRACTED_SOURCE_SET");
    assert.equal(d.extraction.webSearchCallCount, 2); assert.equal(d.extraction.missingSourcesArrayCount, 1);
    assert.equal(d.extraction.invalidSourceCount, 1); assert.equal(d.extractedSourceCount, 0);
    assert.equal(d.observedLinks.length, 2); assert.equal(d.redirectResolution, "NOT_PERFORMED");
    assert.equal(d.mismatches[0].url.canonicalSha256, d.observedLinks[0].url.canonicalSha256);
    return true;
  });
});

test("query percent encoding is observable but is not normalized into a match", () => {
  const d = researchFailure(["https://example.com/vix?q=%41"], ["https://example.com/vix?q=A"]);
  const a = d.mismatches[0].url, b = d.extractedSources[0];
  assert.equal(d.mismatches[0].reason, "SOURCE_NOT_IN_WEB_SEARCH_SET");
  assert.notEqual(a.canonicalSha256, b.canonicalSha256);
  assert.notEqual(a.querySha256, b.querySha256);
  assert.equal(a.decodedQuerySha256, b.decodedQuerySha256);
  assert.doesNotMatch(JSON.stringify(d), /q=|%41/);
});

test("duplicate search sources deduplicate deterministically and fingerprint the unchanged canonical URL", () => {
  const urls = ["https://example.com/vix", "https://EXAMPLE.COM/vix/#frag", "https://example.com/vix?utm_source=x"];
  const d = researchFailure(["https://example.com/other"], urls);
  assert.equal(d.extraction.rawSourceCount, 3); assert.equal(d.extraction.duplicateSourceCount, 2);
  assert.equal(d.extractedSourceCount, 1); assert.equal(d.extraction.distinctSourceCount, 1);
  assert.equal(d.extractedSources[0].canonicalSha256, crypto.createHash("sha256").update(urls[0]).digest("hex"));
  assert.deepEqual(researchFailure(["https://example.com/other"], urls), d);
});

test("research diagnostics separate source arrays, qualified page actions, and rejected actions", () => {
  const transport = transportResult({ candidateProposals: [] });
  transport.researchEvidence[0].sourceUrls = ["https://example.com/missing"];
  const response = apiResponse(transport);
  response.output[0].action = { type: "open_page", url: "https://example.com/vix", sources: [{ url: "https://example.com/vix" }] };
  response.output[0].status = "completed";
  response.output.push(
    { type: "web_search_call", status: "failed", action: { type: "open_page", url: "https://example.com/failed", sources: [] } },
    { type: "web_search_call", status: "completed", action: { type: "search", url: "https://example.com/search", sources: [] } },
  );
  assert.throws(() => parse(transport, response), error => {
    const d = error.semanticDiagnostics;
    assert.equal(error.code, "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH");
    assert.equal(d.extraction.sourceArrayRawCount, 1);
    assert.equal(d.extraction.sourceArrayDistinctCount, 1);
    assert.equal(d.extraction.qualifyingPageActionCount, 1);
    assert.equal(d.extraction.qualifyingPageActionDistinctCount, 1);
    assert.equal(d.extraction.combinedAuthoritativeDistinctCount, 1);
    assert.equal(d.extraction.actionObservationCount, 3);
    assert.equal(d.extraction.rejectedActionObservationCount, 2);
    assert.equal(d.actionObservations.length, 3);
    assert.deepEqual(d.actionObservations.map(item => [item.actionType, item.status, item.eligible, item.reason]), [
      ["open_page", "completed", true, "QUALIFIED_PAGE_ACTION"],
      ["open_page", "failed", false, "STATUS_NOT_COMPLETED"],
      ["search", "completed", false, "ACTION_TYPE_NOT_QUALIFIED"],
    ]);
    assert.ok(Buffer.byteLength(JSON.stringify(d)) <= DL.bytes);
    return true;
  });
  const many = apiResponse(transportResult({ candidateProposals: [] }));
  many.output = Array.from({ length: 40 }, (_, index) => ({ type: "web_search_call", status: "failed", action: { type: "open_page", url: `https://example.com/f-${index}`, sources: [] } }));
  const extracted = extractOpenAiWebSearchSources(many);
  assert.equal(extracted.actionObservationCount, 40);
  assert.equal(extracted.rejectedActionObservationCount, 40);
  assert.equal(extracted.pageActionObservations.length, DL.actionObservations);
});

test("page-action diagnostics remain bounded and cannot retain raw URL material", () => {
  const transport = transportResult({ candidateProposals: [] });
  transport.researchEvidence[0].sourceUrls = ["https://example.com/missing"];
  const response = apiResponse(transport);
  response.output[0].action = { type: "open_page", url: `https://user:password@example.com/${"secret".repeat(1000)}?api_key=${"secret".repeat(1000)}`, sources: [] };
  response.output[0].status = "completed";
  assert.throws(() => parse(transport, response), error => {
    const serialized = JSON.stringify(error.semanticDiagnostics);
    assert.doesNotMatch(serialized, /secret|password|api_key|example\.com/);
    assert.equal(error.semanticDiagnostics.actionObservations[0].url.oversized, true);
    assert.ok(Buffer.byteLength(serialized) <= DL.bytes);
    return true;
  });
});

test("multiple evidence indexes, mismatch records, sources and extra observations have strict caps", () => {
  const sources = Array.from({ length: 40 }, (_, i) => `https://example.com/source-${i}`);
  const { transport, response } = researchCase(Array.from({ length: 12 }, (_, i) => `https://example.com/missing-${i}`), sources);
  transport.researchEvidence.unshift({ ...transport.researchEvidence[0], sourceUrls: [sources[0]], category: "INDEX" });
  response.output[1].content[0].text = JSON.stringify(transport);
  response.output[1].content[0].annotations = Array.from({ length: 20 }, () => ({ type: "url_citation", url: sources[0] }));
  assert.throws(() => parse(transport, response), e => {
    const d = e.semanticDiagnostics;
    assert.equal(d.mismatchCount, 12); assert.equal(d.mismatches.length, DL.mismatches); assert.equal(d.mismatchesTruncated, true);
    assert.equal(d.mismatches[0].researchIndex, 1); assert.equal(d.mismatches[7].sourceUrlIndex, 7);
    assert.equal(d.extractedSourceCount, 40); assert.equal(d.extractedSources.length, DL.extractedSources); assert.equal(d.extractedSourcesTruncated, true);
    assert.equal(d.observedLinkCount, 20); assert.equal(d.observedLinks.length, DL.observedLinks); assert.equal(d.observedLinksTruncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(d)) <= DL.bytes); return true;
  });
});

test("oversized path and query strings are fingerprinted without retaining any raw components", () => {
  const secret = 'do-not-retain-this-secret';
  const d = researchFailure([`https://example.com/${secret.repeat(200)}?api_key=${secret.repeat(200)}#${secret}`]);
  assert.equal(d.mismatches[0].url.oversized, true);
  assert.match(d.mismatches[0].url.canonicalSha256, /^[a-f0-9]{64}$/);
  assert.equal(d.mismatches[0].url.pathSha256, undefined);
  assert.doesNotMatch(JSON.stringify(d), /do-not-retain|api_key|example\.com/);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) <= DL.bytes);
});

test("nested diagnostic sanitizer drops injected prose, raw secrets, headers and invalid fingerprint values", () => {
  const d = researchFailure(["https://user:secret@example.com/secret?key=secret"]);
  Object.assign(d, { report: "private prose", headers: { authorization: "Bearer secret" }, cookie: "secret" });
  Object.assign(d.mismatches[0], { category: "secret", sourceUrl: "secret" });
  Object.assign(d.mismatches[0].url, { canonicalSha256: "secret", hostname: "secret", path: "secret", query: "secret" });
  const safe = sanitizeSodTransportDiagnostics({ errorCode: "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH", requestId: "req_safe", semantic: d });
  assert.equal(safe.requestId, "req_safe"); assert.equal(safe.semantic.mismatches[0].category, "OTHER");
  assert.doesNotMatch(JSON.stringify(safe), /secret|private prose|Bearer|authorization|cookie|"hostname"/);
  assert.equal(sanitizeSodTransportDiagnostics({ errorCode: "SOD_OPENAI_TIMEOUT", semantic: d }).semantic, undefined);
  assert.equal(sanitizeSodResearchDiagnostics({ ...d, validatorStage: "secret" }), null);
});

test("research rejection never mutates or repairs validator input", () => {
  const { transport, response } = researchCase(["https://example.com/missing?secret=value"]);
  const before = structuredClone({ transport, response });
  assert.throws(() => parse(transport, response), e => {
    assert.equal(e.code, "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH");
    assert.equal(e.details, undefined); return true;
  });
  assert.deepEqual({ transport, response }, before);
});

for (const [label, mutate, code] of [
  ["valid IDs shuffled", sections => { [sections[5], sections[6]] = [sections[6], sections[5]]; }, "SOD_OPENAI_ARTIFACT_SECTION_ORDER_INVALID"],
  ["duplicate allowed ID replaces required section", sections => { sections[6].id = sections[5].id; }, "SOD_OPENAI_ARTIFACT_SECTION_ORDER_INVALID"],
  ["missing section", sections => { sections.pop(); }, "SOD_OPENAI_RESPONSE_SCHEMA_INVALID"],
  ["extra section", sections => { sections.push(structuredClone(sections[0])); }, "SOD_OPENAI_RESPONSE_SCHEMA_INVALID"],
  ["unknown ID", sections => { sections[5].id = "unknown-section"; }, "SOD_OPENAI_RESPONSE_SCHEMA_INVALID"],
  ["malformed section structure", sections => { sections[5].blocks = {}; }, "SOD_OPENAI_RESPONSE_SCHEMA_INVALID"],
]) test(`section contract rejects ${label} without repairing provider output`, () => {
  const transport = transportResult({ candidateProposals: [] });
  mutate(transport.artifactContent.sections);
  const response = apiResponse(transport);
  const transportBefore = structuredClone(transport);
  const responseBefore = structuredClone(response);
  assert.throws(() => parse(transport, response), { code });
  assert.deepEqual(transport, transportBefore);
  assert.deepEqual(response, responseBefore);
});

for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///tmp/private", "ftp://example.com", "sod:custom", "/relative", "not a URL", "https://", "https://example.com\\@evil.test", "https://user:secret@example.com"]) {
  test(`artifact rejects unsafe source ${url.split(':')[0]}`, () => {
    const content = sodArtifactContentFixture(); content.sources = [{ label: "unsafe", url }];
    assert.throws(() => normalizeSodArtifactContent(content), { code: "SOD_ARTIFACT_SOURCE_URL_INVALID" });
    const transport = transportResult(); transport.artifactContent.sources[0].url = url;
    assert.throws(() => parse(transport), { code: "SOD_ARTIFACT_SOURCE_URL_INVALID" });
  });
}
test("artifact permits HTTP(S), binds actual run search sources with canonical normalization", () => {
  for (const url of ["http://example.com/source", "https://example.com/source"]) {
    const c = sodArtifactContentFixture(); c.sources = [{ label: "safe", url }]; assert.equal(normalizeSodArtifactContent(c).sources[0].url, url);
  }
  const transport = transportResult(); transport.artifactContent.sources[0].url = "https://example.com/arbitrary";
  assert.throws(() => parse(transport), { code: "SOD_OPENAI_ARTIFACT_SOURCE_MISMATCH" });
  transport.artifactContent.sources[0].url = "https://EXAMPLE.com/vix/?utm_source=test#fragment";
  assert.equal(parse(transport).candidateProposals.length, 1);
});
for (const raw of ['{"a":1,"a":2}', '{"nested":{"a":1,"\\u0061":2}}', '{"array":[{"x":0,"x":1}]}']) {
  test("raw parser rejects decoded duplicate keys at all nesting levels", () => assert.throws(() => parseStrictSodJson(raw), { code: "SOD_OPENAI_JSON_DUPLICATE_KEYS" }));
}
for (const [label, value] of [
  ["depth", "[".repeat(49) + "0" + "]".repeat(49)],
  ["nodes", JSON.stringify(Array.from({ length: 5 }, () => Array(5000).fill(0)))],
  ["keys", JSON.stringify(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, 0])))],
  ["items", JSON.stringify(Array(5001).fill(0))],
  ["decoded UTF-8 string", JSON.stringify("é".repeat(32769))],
]) test(`raw parser rejects excess ${label}`, () => assert.throws(() => parseStrictSodJson(value), { code: "SOD_OPENAI_JSON_STRUCTURAL_LIMIT" }));
test("raw parser accepts exact structural boundaries and ordinary JSON", () => {
  assert.equal(parseStrictSodJson(JSON.stringify("é".repeat(32768))).length, 32768);
  assert.equal(parseStrictSodJson(JSON.stringify(Array(5000).fill(1))).length, 5000);
  assert.equal(Object.keys(parseStrictSodJson(JSON.stringify(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, 0]))))).length, 500);
  assert.doesNotThrow(() => parseStrictSodJson("[".repeat(48) + "0" + "]".repeat(48)));
  assert.deepEqual(parseStrictSodJson('{"a": [true, null, -1.2e3]}'), { a: [true, null, -1200] });
});
test("output ceiling applies before trim/parsing and across text segments", () => {
  for (const response of [apiResponse(undefined, { output_text: " ".repeat(L.maxSerializedBytes + 1) }),
    apiResponse(undefined, { output: [{ type: "message", content: [{ type: "output_text", text: " ".repeat(400000) }, { type: "output_text", text: " ".repeat(400000) }] }] })]) {
    assert.throws(() => parse(undefined, response), { code: "SOD_OPENAI_OUTPUT_TEXT_LIMIT" });
  }
});
for (const [label, mutate] of [
  ["missing required", t => delete t.candidateProposals],
  ["unknown top field", t => { t.extra = true; }],
  ["model candidate identity", t => { t.candidateProposals[0].candidateId = "evil"; }],
  ["model candidate key", t => { t.candidateProposals[0].candidateKey = "evil"; }],
  ["wrong type", t => { t.schemaVersion = "1"; }],
  ["malformed nested", t => { t.artifactContent.hero = []; }],
  ["missing nested", t => delete t.candidateProposals[0].trigger.persistence],
  ["unknown nested", t => { t.candidateProposals[0].trigger.conditions[0].extra = 2; }],
  ["enum", t => { t.candidateProposals[0].direction = "NEUTRAL"; }],
  ["minimum", t => { t.candidateProposals[0].morningPriority = 0; }],
  ["integer", t => { t.candidateProposals[0].morningPriority = 1.1; }],
  ["minItems", t => { t.candidateProposals[0].trigger.conditions = []; }],
  ["maxItems", t => { t.artifactContent.sections.push(t.artifactContent.sections[0]); }],
]) test(`local schema rejects ${label} before mapping defaults`, () => { const t = transportResult(); mutate(t); assert.throws(() => parse(t), { code: "SOD_OPENAI_RESPONSE_SCHEMA_INVALID" }); });
test("semantic and provenance contradictions fail after schema validation", () => {
  const t = transportResult(); t.candidateProposals[0].trigger.conditions[0].side = null;
  assert.throws(() => parse(t), { code: "SOD_OPENAI_TRIGGER_INVALID" });
  const bad = transportResult(); bad.candidateProposals[0].validity.validUntil = "invalid";
  assert.throws(() => parse(bad), { code: "SOD_OPENAI_CANDIDATE_SEMANTICS_INVALID" });
  const research = transportResult(); research.researchEvidence[0].sourceUrls = ["https://example.com/unseen"];
  assert.throws(() => parse(research), { code: "SOD_OPENAI_RESEARCH_SOURCE_MISMATCH" });
});
test("17 charts fail before resolving any bytes at generic and direct OpenAI boundaries", async () => {
  let resolved = 0, called = 0;
  const request = normalizedRequest({ charts: Array(17).fill(normalizedRequest().charts[0]) });
  const provider = createOpenAiSodAnalysisProvider({ model: "test", client: { responses: { create: async () => { called++; } } } });
  await assert.rejects(invokeSodAnalysisProvider(provider, request, { resolveChart: async () => { resolved++; } }), { code: "SOD_OPENAI_CHART_COUNT_LIMIT" });
  await assert.rejects(provider.generate(request, { resolveChart: async () => { resolved++; } }), { code: "SOD_OPENAI_CHART_COUNT_LIMIT" });
  assert.equal(resolved, 0); assert.equal(called, 0);
});
test("16 charts and exactly 32 MiB allowed; aggregate overflow stops at first excess chart", async () => {
  const charts = Array.from({ length: 16 }, (_, i) => ({ ...normalizedRequest().charts[0], chartId: `chart-${i}`, contentRef: `sod-chart:${i}` }));
  let resolved = 0, called = 0;
  const provider = createOpenAiSodAnalysisProvider({ model: "test", client: { responses: { create: async () => { called++; return apiResponse(transportResult({ candidateProposals: [] })); } } } });
  const resolveChart = async ref => { resolved++; return resolvedChart({ ...charts.find(c => c.contentRef === ref), bytes: Buffer.alloc(2 * 1024 * 1024) }); };
  const result = await invokeSodAnalysisProvider(provider, normalizedRequest({ charts }), { resolveChart });
  assert.equal(result.result.generationMetadata.chartBytes, L.maxChartBytes); assert.equal(resolved, 16); assert.equal(called, 1);
  resolved = 0; called = 0;
  await assert.rejects(invokeSodAnalysisProvider(provider, normalizedRequest({ charts }), { resolveChart: async ref => {
    resolved++; return resolvedChart({ ...charts.find(c => c.contentRef === ref), bytes: Buffer.alloc(8 * 1024 * 1024) });
  } }), { code: "SOD_OPENAI_CHART_BYTES_LIMIT" });
  assert.equal(resolved, 5); assert.equal(called, 0);
});
test("serialized 48 MiB request ceiling includes JSON and image expansion before network", async () => {
  const payload = { text: "x".repeat(L.maxRequestBytes) };
  assert.throws(() => serializeSodProviderRequest(payload), { code: "SOD_OPENAI_REQUEST_BYTES_LIMIT" });
  let calls = 0;
  const client = createOpenAiResponsesFetchClient({ apiKey: "test-secret", fetchImpl: async () => { calls++; } });
  await assert.rejects(client.responses.create(payload), { code: "SOD_OPENAI_REQUEST_BYTES_LIMIT" });
  assert.equal(calls, 0);
  assert.throws(() => buildOpenAiSodResponseRequest({ request: normalizedRequest({ marketContext: payload }), resolvedCharts: [resolvedChart()], model: "test" }), { code: "SOD_OPENAI_REQUEST_BYTES_LIMIT" });
});
test("raw 4 MiB reader bounds actual chunks, cancels overflow, and never calls response.json", async () => {
  let pulls = 0, canceled = false;
  const client = createOpenAiResponsesFetchClient({ apiKey: "test-secret", fetchImpl: async () => ({
    ok: true, headers: new Headers({ "content-length": "1" }),
    body: new ReadableStream({ pull(c) { pulls++; c.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { canceled = true; } }, { highWaterMark: 0 }),
    json() { throw new Error("unbounded parser forbidden"); },
  }) });
  await assert.rejects(client.responses.create({}), { code: "SOD_OPENAI_RAW_RESPONSE_LIMIT" });
  assert.equal(pulls, 5); assert.equal(canceled, true);
});
test("raw envelope rejects malformed JSON, invalid UTF-8 and oversized Content-Length without body reads", async () => {
  for (const bytes of ["{", new Uint8Array([0xff]), "[]", "null"]) {
    const client = createOpenAiResponsesFetchClient({ apiKey: "secret", fetchImpl: async () => new Response(bytes) });
    await assert.rejects(client.responses.create({}), { code: "SOD_OPENAI_RESPONSE_INVALID" });
  }
  let reads = 0;
  const client = createOpenAiResponsesFetchClient({ apiKey: "secret", fetchImpl: async () => ({ ok: true,
    headers: new Headers({ "content-length": String(L.maxResponseBytes + 1) }), body: { cancel: async () => {}, getReader: () => { reads++; } } }) });
  await assert.rejects(client.responses.create({}), { code: "SOD_OPENAI_RAW_RESPONSE_LIMIT" }); assert.equal(reads, 0);
});
test("transport timeout/network classification is sanitized and never retried", async () => {
  for (const timeout of [false, true]) {
    let calls = 0;
    const client = createOpenAiResponsesFetchClient({ apiKey: "secret", timeoutMs: 1, fetchImpl: async (_url, { signal }) => {
      calls++;
      if (!timeout) throw new Error("Authorization: Bearer secret /private/local/path");
      return new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("late")), 100); signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("private")); }); });
    } });
    await assert.rejects(client.responses.create({}), error => error.code === (timeout ? "SOD_OPENAI_TIMEOUT" : "SOD_OPENAI_NETWORK_FAILED") && !error.message.includes("private"));
    assert.equal(calls, 1);
  }
});
