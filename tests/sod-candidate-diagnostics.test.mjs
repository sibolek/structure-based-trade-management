import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSodCandidateSemanticDiagnostics,
  sanitizeSodCandidateSemanticDiagnostics,
  SOD_CANDIDATE_DIAGNOSTIC_LIMITS,
} from "../schwab-bridge/sod-candidate-diagnostics.mjs";
import { sanitizeSodTransportDiagnostics } from "../schwab-bridge/sod-transport-diagnostics.mjs";
import { parseOpenAiSodResponse } from "../schwab-bridge/sod-openai-analysis-provider.mjs";
import { apiResponse, normalizedRequest, resolvedChart, transportCandidate, transportResult } from "./helpers/sod-openai-fixture.mjs";

function parseFailure(transport) {
  let failure;
  assert.throws(() => parseOpenAiSodResponse({
    response: apiResponse(transport), request: normalizedRequest(), resolvedCharts: [resolvedChart()], model: "offline-test",
  }), error => { failure = error; return error.code === "SOD_OPENAI_CANDIDATE_SEMANTICS_INVALID"; });
  return failure;
}

test("matching candidate semantic input succeeds without diagnostics", () => {
  const transport = transportResult();
  const before = structuredClone(transport);
  const result = parseOpenAiSodResponse({ response: apiResponse(transport), request: normalizedRequest(), resolvedCharts: [resolvedChart()], model: "offline-test" });
  assert.equal(result.candidateProposals.length, 1);
  assert.deepEqual(transport, before);
});

test("premap timestamp failure records bounded rule and field", () => {
  const transport = transportResult();
  transport.candidateProposals[0].validity.validUntil = "tomorrow";
  const error = parseFailure(transport);
  assert.equal(error.semanticDiagnostics.validatorStage, "TRANSPORT_CANDIDATE_PREMAP");
  assert.equal(error.semanticDiagnostics.violations[0].ruleCode, "VALIDITY_TIMESTAMP_FORMAT");
  assert.equal(error.semanticDiagnostics.violations[0].field, "validity.validUntil");
  assert.equal(error.semanticDiagnostics.violations[0].actual.kind, "string");
  assert.doesNotMatch(JSON.stringify(error.semanticDiagnostics), /tomorrow/);
});

test("premap interval failure records ordering rule", () => {
  const transport = transportResult();
  transport.candidateProposals[0].validity.validUntil = transport.candidateProposals[0].validity.validFrom;
  const error = parseFailure(transport);
  assert.equal(error.semanticDiagnostics.violations[0].ruleCode, "VALIDITY_INTERVAL_ORDER");
  assert.equal(error.semanticDiagnostics.violations[0].expected, "VALID_FROM_BEFORE_VALID_UNTIL");
});

test("premap empty symbol and thesis are separately identifiable", () => {
  const transport = transportResult();
  transport.candidateProposals[0].symbol = "";
  transport.candidateProposals[0].thesis = "";
  const error = parseFailure(transport);
  assert.deepEqual(error.semanticDiagnostics.violations.map(v => v.ruleCode), ["SYMBOL_REQUIRED", "THESIS_REQUIRED"]);
});

test("canonical timezone failure records generated candidate identity", () => {
  const transport = transportResult();
  transport.candidateProposals[0].validity.timezone = "Unknown/Timezone";
  const error = parseFailure(transport);
  const violation = error.semanticDiagnostics.violations[0];
  assert.equal(error.semanticDiagnostics.validatorStage, "CANONICAL_CANDIDATE_COMPATIBILITY");
  assert.equal(violation.ruleCode, "VALIDITY_TIMEZONE");
  assert.equal(violation.field, "validity.timezone");
  assert.equal(violation.candidateId, "sod-2026-09-10-nvda-vwap-reclaim-long");
});

test("canonical trigger compatibility failure is retained as a trigger rule", () => {
  const transport = transportResult();
  transport.candidateProposals[0].trigger.combination = "ALL_OF";
  transport.candidateProposals[0].trigger.persistence = { type: "ONE_SHOT", timeframe: null };
  const error = parseFailure(transport);
  assert.equal(error.semanticDiagnostics.violations[0].ruleCode, "TRIGGER_COMPOUND_CHILDREN");
  assert.equal(error.semanticDiagnostics.violations[0].field, "trigger");
});

test("the two existing semantic throw sites remain distinguishable", () => {
  const premap = transportResult();
  premap.candidateProposals[0].validity.validUntil = "invalid";
  const canonical = transportResult();
  canonical.candidateProposals[0].validity.timezone = "Invalid/Timezone";
  assert.equal(parseFailure(premap).semanticDiagnostics.validatorStage, "TRANSPORT_CANDIDATE_PREMAP");
  assert.equal(parseFailure(canonical).semanticDiagnostics.validatorStage, "CANONICAL_CANDIDATE_COMPATIBILITY");
});

test("multiple diagnostics are capped and truncation is explicit", () => {
  const diagnostics = buildSodCandidateSemanticDiagnostics({
    validatorStage: "CANONICAL_CANDIDATE_COMPATIBILITY", candidateIndex: 3, candidateCount: 16,
    candidate: { candidateId: "sod-2026-09-10-nvda-vwap-reclaim-long" },
    errors: Array.from({ length: 20 }, (_, i) => `unrecognized contract error ${i}`),
  });
  assert.equal(diagnostics.violationCount, 20);
  assert.equal(diagnostics.violations.length, SOD_CANDIDATE_DIAGNOSTIC_LIMITS.violations);
  assert.equal(diagnostics.violationsTruncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostics)) <= SOD_CANDIDATE_DIAGNOSTIC_LIMITS.bytes);
});

test("semantic fingerprints are deterministic", () => {
  const args = { validatorStage: "TRANSPORT_CANDIDATE_PREMAP", candidateIndex: 0, candidateCount: 1,
    candidate: {}, violations: [{ ruleCode: "THESIS_REQUIRED", field: "thesis", expected: "NONEMPTY_STRING", actual: "same" }] };
  assert.deepEqual(buildSodCandidateSemanticDiagnostics(args), buildSodCandidateSemanticDiagnostics(args));
  assert.equal(buildSodCandidateSemanticDiagnostics(args).violations[0].actual.sha256,
    "0967115f2813a3541eaef77de9d9d5773f1c0c04314b0bbfe4ff3b3b1c55b5d5");
});

test("secrets and unrestricted prose cannot enter diagnostics", () => {
  const secret = "Bearer secret-token api_key=private-key and unrestricted provider prose";
  const diagnostics = buildSodCandidateSemanticDiagnostics({ validatorStage: "CANONICAL_CANDIDATE_COMPATIBILITY", candidateIndex: 0,
    candidate: { validity: { timezone: secret }, thesis: secret }, errors: ["validity.timezone must be a valid IANA timezone"] });
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /Bearer|secret-token|api_key|private-key|unrestricted provider prose/);
  assert.equal(diagnostics.violations[0].actual.kind, "string");
  assert.equal(diagnostics.violations[0].actual.length, secret.length);
});

test("oversized values are represented by bounded fingerprints", () => {
  const oversized = "x".repeat(200_000);
  const diagnostics = buildSodCandidateSemanticDiagnostics({ validatorStage: "CANONICAL_CANDIDATE_COMPATIBILITY", candidateIndex: 0,
    candidate: { thesis: oversized }, errors: ["thesis is required"] });
  assert.ok(Buffer.byteLength(JSON.stringify(diagnostics)) <= SOD_CANDIDATE_DIAGNOSTIC_LIMITS.bytes);
  assert.equal(diagnostics.violations[0].actual.length, oversized.length);
  assert.equal(diagnostics.violations[0].actual.sha256.length, 64);
});

test("request ID and candidate diagnostics coexist through transport sanitization", () => {
  const value = sanitizeSodTransportDiagnostics({ errorCode: "SOD_OPENAI_CANDIDATE_SEMANTICS_INVALID", phase: "RESPONSE_PARSED",
    requestId: "req_candidate_safe", semantic: buildSodCandidateSemanticDiagnostics({ validatorStage: "CANONICAL_CANDIDATE_COMPATIBILITY",
      candidateIndex: 1, candidateCount: 2, candidate: { candidateId: "sod-2026-09-10-nvda-vwap-reclaim-long" }, errors: ["validity.timezone must be a valid IANA timezone"] }) });
  assert.equal(value.requestId, "req_candidate_safe");
  assert.equal(value.semantic.violations[0].candidateIndex, 1);
});

test("sanitization drops unallowlisted rules and fields", () => {
  const diagnostics = sanitizeSodCandidateSemanticDiagnostics({ version: 1, validatorStage: "CANONICAL_CANDIDATE_COMPATIBILITY",
    candidateIndex: 0, candidateCount: 1, violationCount: 1,
    violations: [{ ruleCode: "EXFILTRATE", field: "secret.path", expected: "secret", actual: "private" }] });
  assert.equal(diagnostics.violations[0].ruleCode, "CANONICAL_CONTRACT_ERROR");
  assert.equal(diagnostics.violations[0].field, "candidate");
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|secret/);
});

test("diagnostic construction does not mutate validator input", () => {
  const candidate = { candidateId: "sod-2026-09-10-nvda-vwap-reclaim-long", thesis: "unchanged" };
  const before = structuredClone(candidate);
  buildSodCandidateSemanticDiagnostics({ validatorStage: "CANONICAL_CANDIDATE_COMPATIBILITY", candidateIndex: 0,
    candidateCount: 1, candidate, errors: ["thesis is required"] });
  assert.deepEqual(candidate, before);
});

test("candidate rejection does not repair or mutate provider transport input", () => {
  const transport = transportResult();
  transport.candidateProposals[0].validity.validUntil = "invalid";
  const before = structuredClone(transport);
  parseFailure(transport);
  assert.deepEqual(transport, before);
});

test("unsupported diagnostic stage is rejected", () => {
  assert.equal(sanitizeSodCandidateSemanticDiagnostics({ version: 1, validatorStage: "RESEARCH_SOURCE_MEMBERSHIP", violations: [] }), null);
});

test("candidate transport fixture remains structurally valid for control tests", () => {
  assert.equal(transportCandidate().armPolicy.requestedMode, "MANUAL");
});
