import crypto from "node:crypto";
import { SYSTEM_CANDIDATE_ROOTS } from "./candidate-integrity-roots.mjs";

// Candidate diagnostics are failure evidence only. They never become a
// candidate proposal and never influence validation or publication.
export const SOD_CANDIDATE_DIAGNOSTIC_LIMITS = Object.freeze({
  violations: 8,
  bytes: 16 * 1024,
  candidateIdChars: 160,
});

const L = SOD_CANDIDATE_DIAGNOSTIC_LIMITS;
const STAGES = new Set(["TRANSPORT_CANDIDATE_PREMAP", "CANONICAL_CANDIDATE_COMPATIBILITY"]);
const FIELDS = new Set([
  "candidateId", "contractVersion", "schemaVersion", "source", "sourceDate", "generatedAt",
  "symbol", "direction", "setup", "setupKey", "decisionTimeframe", "entryTimeframe",
  "volatilityTimeframe", "timeframe", "thesis", "trigger", "trigger.schemaVersion",
  "trigger.evaluatorVersion", "trigger.persistence", "validity.validFrom", "validity.validUntil",
  "validity.timezone", "validity.session", "structuralInvalidation.rule",
  "structuralInvalidation.reference", "structuralInvalidation.price", "managementContract",
  "managementPlan", "armPolicy.requestedMode", "candidate",
  ...SYSTEM_CANDIDATE_ROOTS, "armPolicy.armAuthorized", "armPolicy.manualApproved", "armPolicy.forceImport", "armPolicy.supersessionApproved",
]);
const RULES = new Set([
  "VALIDITY_TIMESTAMP_FORMAT", "VALIDITY_INTERVAL_ORDER", "SYMBOL_REQUIRED", "THESIS_REQUIRED",
  "CANDIDATE_ID_REQUIRED", "CONTRACT_VERSION", "SCHEMA_VERSION", "SOURCE_REQUIRED",
  "SOURCE_MISMATCH", "SOURCE_DATE", "GENERATED_AT", "DIRECTION", "SETUP_REQUIRED",
  "DECISION_TIMEFRAME", "ENTRY_TIMEFRAME", "VOLATILITY_TIMEFRAME", "TRIGGER_REQUIRED",
  "TRIGGER_SCHEMA_VERSION", "TRIGGER_EVALUATOR_VERSION", "TRIGGER_NODE_TYPE",
  "TRIGGER_COMPOUND_CHILDREN", "TRIGGER_OPERATOR", "TRIGGER_VALUE", "TRIGGER_QUOTE_SIDE",
  "TRIGGER_BAR_TIMEFRAME", "TRIGGER_PERSISTENCE_TYPE", "TRIGGER_PERSISTENCE_TIMEFRAME",
  "TRIGGER_PERSISTENCE_COMPATIBILITY", "TIMEFRAME_CONFLICT", "MANAGEMENT_PLAN",
  "MANUAL_ARM_REQUIRED", "AUTHORITY_FIELD", "STRUCTURAL_INVALIDATION_RULE",
  "STRUCTURAL_INVALIDATION_REFERENCE", "MANAGEMENT_CONTRACT", "VALIDITY_TIMEZONE",
  "VALIDITY_SESSION", "STRUCTURAL_JSON_SAFETY", "CANONICAL_CONTRACT_ERROR",
]);
const EXPECTED = new Set([
  "ABSOLUTE_TIMESTAMP_WITH_OFFSET_OR_Z", "VALID_FROM_BEFORE_VALID_UNTIL", "NONEMPTY_STRING",
  "NONEMPTY_CANDIDATE_ID", "INTEGER_AT_LEAST_ONE", "SOD_A_PLUS_TRADES_SOURCE",
  "EXACT_YYYY_MM_DD", "ABSOLUTE_TIMESTAMP_WITH_OFFSET_OR_Z", "LONG_OR_SHORT",
  "SUPPORTED_SETUP", "NONEMPTY_TIMEFRAME", "STRUCTURED_TRIGGER", "SUPPORTED_TRIGGER_VERSION",
  "SUPPORTED_TRIGGER_NODE", "AT_LEAST_TWO_CHILDREN", "GT_GTE_LT_OR_LTE", "FINITE_NUMBER",
  "BID_ASK_OR_LAST", "NONEMPTY_BAR_TIMEFRAME", "SUPPORTED_PERSISTENCE", "COMPATIBLE_PERSISTENCE",
  "NO_CONFLICTING_TIMEFRAME", "OPTIONAL_STRUCTURED_OBJECT", "MANUAL", "SYSTEM_AUTHORITY_FORBIDDEN",
  "NONEMPTY_RULE", "RESOLVED_PRICE_OR_STRUCTURED_REFERENCE", "STRUCTURED_OBJECT",
  "VALID_IANA_TIMEZONE", "SESSION_PROVENANCE", "BOUNDED_STRICT_JSON", "CANONICAL_CONTRACT_RULE",
]);

const digest = value => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
const count = value => Number.isInteger(value) && value >= 0 && value <= 10_000 ? value : 0;

function safeActual(value) {
  if (value === null || value === undefined) return { kind: value === null ? "null" : "undefined" };
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "number") return Number.isFinite(value)
    ? { kind: "number", value }
    : { kind: "number", finite: false };
  if (typeof value === "string") return { kind: "string", length: value.length, sha256: digest(value) };
  if (Array.isArray(value)) return { kind: "array", length: count(value.length) };
  if (typeof value === "object") return { kind: "object", keyCount: count(Object.keys(value).length) };
  return { kind: typeof value };
}

function sanitizeActual(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.kind !== "string") return safeActual(value);
  if (value.kind === "string") {
    return Number.isInteger(value.length) && value.length >= 0 && value.length <= 10_000_000 && /^[a-f0-9]{64}$/.test(value.sha256 || "")
      ? { kind: "string", length: value.length, sha256: value.sha256 }
      : safeActual(value);
  }
  if (value.kind === "number") {
    return value.finite === false ? { kind: "number", finite: false } : Number.isFinite(value.value) ? { kind: "number", value: value.value } : { kind: "number", finite: false };
  }
  if (value.kind === "boolean") return { kind: "boolean", value: value.value === true };
  if (value.kind === "null" || value.kind === "undefined") return { kind: value.kind };
  if (value.kind === "array") return { kind: "array", length: count(value.length) };
  if (value.kind === "object") return { kind: "object", keyCount: count(value.keyCount) };
  return safeActual(value);
}

function safeCandidateId(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.length <= L.candidateIdChars && /^sod-\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*-(?:long|short)$/.test(raw)) return raw;
  return { length: raw.length, sha256: digest(raw) };
}

function fieldValue(candidate, field) {
  if (field === "validity.validFrom") return candidate?.validity?.validFrom;
  if (field === "validity.validUntil") return candidate?.validity?.validUntil;
  if (field === "validity.timezone") return candidate?.validity?.timezone;
  if (field === "validity.session") return candidate?.validity?.session;
  if (field.startsWith("trigger.")) return candidate?.trigger?.[field.slice("trigger.".length)];
  return candidate?.[field];
}

function inferField(ruleCode, message) {
  const text = String(message || "");
  if (ruleCode === "AUTHORITY_FIELD") {
    const authorityField = /^([A-Za-z][A-Za-z0-9.]*) is system-owned authority/.exec(text)?.[1] || "";
    return FIELDS.has(authorityField) ? authorityField : "candidate";
  }
  if (ruleCode === "VALIDITY_TIMESTAMP_FORMAT") return text.includes("validUntil") ? "validity.validUntil" : "validity.validFrom";
  if (ruleCode === "VALIDITY_INTERVAL_ORDER") return "validity.validUntil";
  if (ruleCode === "SYMBOL_REQUIRED") return "symbol";
  if (ruleCode === "THESIS_REQUIRED") return "thesis";
  if (ruleCode === "VALIDITY_TIMEZONE") return "validity.timezone";
  if (ruleCode === "VALIDITY_SESSION") return "validity.session";
  if (ruleCode === "TRIGGER_SCHEMA_VERSION") return "trigger.schemaVersion";
  if (ruleCode === "TRIGGER_EVALUATOR_VERSION") return "trigger.evaluatorVersion";
  if (ruleCode.startsWith("TRIGGER_PERSISTENCE")) return "trigger.persistence";
  if (ruleCode === "TRIGGER_NODE_TYPE") return "trigger";
  if (ruleCode === "TRIGGER_COMPOUND_CHILDREN") return "trigger";
  if (ruleCode === "TRIGGER_OPERATOR" || ruleCode === "TRIGGER_VALUE" || ruleCode === "TRIGGER_QUOTE_SIDE" || ruleCode === "TRIGGER_BAR_TIMEFRAME") return "trigger";
  if (ruleCode === "MANUAL_ARM_REQUIRED") return "armPolicy.requestedMode";
  if (ruleCode === "STRUCTURAL_INVALIDATION_RULE") return "structuralInvalidation.rule";
  if (ruleCode === "STRUCTURAL_INVALIDATION_REFERENCE") return "structuralInvalidation.reference";
  if (ruleCode === "MANAGEMENT_CONTRACT") return "managementContract";
  if (ruleCode === "MANAGEMENT_PLAN") return "managementPlan";
  if (ruleCode === "TIMEFRAME_CONFLICT") return "timeframe";
  if (ruleCode === "STRUCTURAL_JSON_SAFETY") return "candidate";
  if (ruleCode === "CANDIDATE_ID_REQUIRED") return "candidateId";
  if (ruleCode === "CONTRACT_VERSION") return "contractVersion";
  if (ruleCode === "SCHEMA_VERSION") return "schemaVersion";
  if (ruleCode === "SOURCE_REQUIRED" || ruleCode === "SOURCE_MISMATCH") return "source";
  if (ruleCode === "SOURCE_DATE") return "sourceDate";
  if (ruleCode === "GENERATED_AT") return "generatedAt";
  if (ruleCode === "DIRECTION") return "direction";
  if (ruleCode === "SETUP_REQUIRED") return "setup";
  if (ruleCode === "DECISION_TIMEFRAME") return "decisionTimeframe";
  if (ruleCode === "ENTRY_TIMEFRAME") return "entryTimeframe";
  if (ruleCode === "VOLATILITY_TIMEFRAME") return "volatilityTimeframe";
  return "candidate";
}

function inferRule(message) {
  const text = String(message || "");
  if (text.includes("validity.validFrom") || text.includes("validity.validUntil must be an exact")) return "VALIDITY_TIMESTAMP_FORMAT";
  if (text.includes("validity.validUntil must be after")) return "VALIDITY_INTERVAL_ORDER";
  if (text === "symbol is required") return "SYMBOL_REQUIRED";
  if (text === "thesis is required") return "THESIS_REQUIRED";
  if (text === "candidateId is required") return "CANDIDATE_ID_REQUIRED";
  if (text.startsWith("contractVersion must")) return "CONTRACT_VERSION";
  if (text.startsWith("schemaVersion must")) return "SCHEMA_VERSION";
  if (text === "candidate source is required" || text === "bundle source is required") return "SOURCE_REQUIRED";
  if (text.includes("candidate source must match")) return "SOURCE_MISMATCH";
  if (text.startsWith("sourceDate must")) return "SOURCE_DATE";
  if (text.startsWith("generatedAt must")) return "GENERATED_AT";
  if (text === "direction must be LONG or SHORT") return "DIRECTION";
  if (text === "setup is required") return "SETUP_REQUIRED";
  if (text === "decisionTimeframe is required") return "DECISION_TIMEFRAME";
  if (text === "entryTimeframe is required") return "ENTRY_TIMEFRAME";
  if (text === "volatilityTimeframe is required") return "VOLATILITY_TIMEFRAME";
  if (text === "structured trigger object is required") return "TRIGGER_REQUIRED";
  if (text.includes("trigger.schemaVersion")) return "TRIGGER_SCHEMA_VERSION";
  if (text.includes("trigger.evaluatorVersion")) return "TRIGGER_EVALUATOR_VERSION";
  if (text.includes("type is required") || text.includes("type ") && text.includes("not supported")) return "TRIGGER_NODE_TYPE";
  if (text.includes("children must contain")) return "TRIGGER_COMPOUND_CHILDREN";
  if (text.includes("operator must be")) return "TRIGGER_OPERATOR";
  if (text.includes("value must be numeric")) return "TRIGGER_VALUE";
  if (text.includes("side must be")) return "TRIGGER_QUOTE_SIDE";
  if (text.includes("timeframe is required for BAR_CLOSE")) return "TRIGGER_BAR_TIMEFRAME";
  if (text.includes("persistence.type must be")) return "TRIGGER_PERSISTENCE_TYPE";
  if (text.includes("persistence requires a timeframe")) return "TRIGGER_PERSISTENCE_TIMEFRAME";
  if (text.includes("persistence requires a single") || text.includes("persistence timeframe must match")) return "TRIGGER_PERSISTENCE_COMPATIBILITY";
  if (text.includes("legacy timeframe")) return "TIMEFRAME_CONFLICT";
  if (text.includes("managementPlan must")) return "MANAGEMENT_PLAN";
  if (text.includes("requestedMode must") || text.includes("must request MANUAL ARM")) return "MANUAL_ARM_REQUIRED";
  if (text.includes("system-owned authority")) return "AUTHORITY_FIELD";
  if (text === "structuralInvalidation.rule is required") return "STRUCTURAL_INVALIDATION_RULE";
  if (text.includes("structuralInvalidation requires")) return "STRUCTURAL_INVALIDATION_REFERENCE";
  if (text === "structured managementContract is required") return "MANAGEMENT_CONTRACT";
  if (text.includes("validity.timezone")) return "VALIDITY_TIMEZONE";
  if (text.includes("validity.session")) return "VALIDITY_SESSION";
  if (text.includes("exceeds ") || text.includes("strict JSON") || text.includes("cycle") || text.includes("deterministically serialized")) return "STRUCTURAL_JSON_SAFETY";
  return "CANONICAL_CONTRACT_ERROR";
}

function expectedFor(ruleCode) {
  const map = {
    VALIDITY_TIMESTAMP_FORMAT: "ABSOLUTE_TIMESTAMP_WITH_OFFSET_OR_Z", VALIDITY_INTERVAL_ORDER: "VALID_FROM_BEFORE_VALID_UNTIL",
    SYMBOL_REQUIRED: "NONEMPTY_STRING", THESIS_REQUIRED: "NONEMPTY_STRING", CANDIDATE_ID_REQUIRED: "NONEMPTY_CANDIDATE_ID",
    CONTRACT_VERSION: "INTEGER_AT_LEAST_ONE", SCHEMA_VERSION: "INTEGER_AT_LEAST_ONE", SOURCE_REQUIRED: "SOD_A_PLUS_TRADES_SOURCE",
    SOURCE_MISMATCH: "SOD_A_PLUS_TRADES_SOURCE", SOURCE_DATE: "EXACT_YYYY_MM_DD", GENERATED_AT: "ABSOLUTE_TIMESTAMP_WITH_OFFSET_OR_Z",
    DIRECTION: "LONG_OR_SHORT", SETUP_REQUIRED: "NONEMPTY_STRING", DECISION_TIMEFRAME: "NONEMPTY_TIMEFRAME",
    ENTRY_TIMEFRAME: "NONEMPTY_TIMEFRAME", VOLATILITY_TIMEFRAME: "NONEMPTY_TIMEFRAME", TRIGGER_REQUIRED: "STRUCTURED_TRIGGER",
    TRIGGER_SCHEMA_VERSION: "SUPPORTED_TRIGGER_VERSION", TRIGGER_EVALUATOR_VERSION: "SUPPORTED_TRIGGER_VERSION",
    TRIGGER_NODE_TYPE: "SUPPORTED_TRIGGER_NODE", TRIGGER_COMPOUND_CHILDREN: "AT_LEAST_TWO_CHILDREN", TRIGGER_OPERATOR: "GT_GTE_LT_OR_LTE",
    TRIGGER_VALUE: "FINITE_NUMBER", TRIGGER_QUOTE_SIDE: "BID_ASK_OR_LAST", TRIGGER_BAR_TIMEFRAME: "NONEMPTY_BAR_TIMEFRAME",
    TRIGGER_PERSISTENCE_TYPE: "SUPPORTED_PERSISTENCE", TRIGGER_PERSISTENCE_TIMEFRAME: "COMPATIBLE_PERSISTENCE",
    TRIGGER_PERSISTENCE_COMPATIBILITY: "COMPATIBLE_PERSISTENCE", TIMEFRAME_CONFLICT: "NO_CONFLICTING_TIMEFRAME",
    MANAGEMENT_PLAN: "OPTIONAL_STRUCTURED_OBJECT", MANUAL_ARM_REQUIRED: "MANUAL", AUTHORITY_FIELD: "SYSTEM_AUTHORITY_FORBIDDEN",
    STRUCTURAL_INVALIDATION_RULE: "NONEMPTY_RULE", STRUCTURAL_INVALIDATION_REFERENCE: "RESOLVED_PRICE_OR_STRUCTURED_REFERENCE",
    MANAGEMENT_CONTRACT: "STRUCTURED_OBJECT", VALIDITY_TIMEZONE: "VALID_IANA_TIMEZONE", VALIDITY_SESSION: "SESSION_PROVENANCE",
    STRUCTURAL_JSON_SAFETY: "BOUNDED_STRICT_JSON", CANONICAL_CONTRACT_ERROR: "CANONICAL_CONTRACT_RULE",
  };
  return map[ruleCode] || "CANONICAL_CONTRACT_RULE";
}

function sanitizeViolation(item, fallbackCandidate) {
  const ruleCode = RULES.has(item?.ruleCode) ? item.ruleCode : "CANONICAL_CONTRACT_ERROR";
  const field = FIELDS.has(item?.field) ? item.field : inferField(ruleCode, item?.message);
  const actual = item && Object.prototype.hasOwnProperty.call(item, "actual")
    ? item.actual
    : fieldValue(fallbackCandidate, field);
  return {
    candidateIndex: count(item?.candidateIndex),
    ...(safeCandidateId(item?.candidateId ?? fallbackCandidate?.candidateId) ? { candidateId: safeCandidateId(item?.candidateId ?? fallbackCandidate?.candidateId) } : {}),
    ruleCode,
    field,
    expected: EXPECTED.has(item?.expected) ? item.expected : expectedFor(ruleCode),
    actual: sanitizeActual(actual),
    ...(ruleCode === "CANONICAL_CONTRACT_ERROR" && typeof item?.message === "string"
      ? { detailSha256: digest(item.message) } : {}),
  };
}

export function sanitizeSodCandidateSemanticDiagnostics(value) {
  if (value?.version !== 1 || !STAGES.has(value.validatorStage)) return null;
  const supplied = Array.isArray(value.violations) ? value.violations : [];
  const violations = supplied.slice(0, L.violations).map(item => sanitizeViolation(item));
  const result = {
    version: 1,
    validatorStage: value.validatorStage,
    candidateCount: count(value.candidateCount),
    violationCount: count(value.violationCount ?? supplied.length),
    violations,
    violationsTruncated: Number(value.violationCount ?? supplied.length) > violations.length,
  };
  while (Buffer.byteLength(JSON.stringify(result), "utf8") > L.bytes && result.violations.length) {
    result.violations.pop();
    result.violationsTruncated = true;
  }
  return result;
}

export function buildSodCandidateSemanticDiagnostics({ validatorStage, candidateIndex, candidateCount, candidate, violations, errors } = {}) {
  const rawViolations = Array.isArray(violations) && violations.length
    ? violations
    : (Array.isArray(errors) ? errors.map(message => ({ message, ruleCode: inferRule(message), field: inferField(inferRule(message), message), actual: fieldValue(candidate, inferField(inferRule(message), message)) })) : []);
  return sanitizeSodCandidateSemanticDiagnostics({ version: 1, validatorStage,
    candidateIndex, candidateCount, violationCount: rawViolations.length,
    violations: rawViolations.map(item => ({ ...item, candidateIndex, candidateId: candidate?.candidateId })) });
}
