import crypto from "node:crypto";
import { canonicalJson } from "./canonical-json.mjs";

export const PRETRADE_PROVIDER_HANDOFF_SCHEMA = "PRETRADE_PROVIDER_HANDOFF_V1";
export const PRETRADE_PROVIDER_HANDOFF_CANONICALIZATION = "executionos-json-v1";
export const PRETRADE_PROVIDER_HANDOFF_SIGNATURE_ALGORITHM = "Ed25519";
export const PRETRADE_PROVIDER_HANDOFF_SIGNATURE_PREFIX = "EXECUTIONOS/PRETRADE_PROVIDER_HANDOFF/V1\n";

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOP_LEVEL_KEYS = [
  "audienceInstallationId",
  "canonicalizationId",
  "challenge",
  "charts",
  "evidence",
  "issuerId",
  "keyId",
  "messageId",
  "output",
  "provider",
  "run",
  "schemaVersion",
  "signature",
  "signatureAlgorithm",
  "storeEpoch",
  "times",
];
const CHALLENGE_KEYS = ["bootGeneration", "challengeId", "expiresAt", "issuedAt", "nonce"];
const RUN_KEYS = [
  "accountScopeId",
  "accountSelectionRevision",
  "draftId",
  "inputManifestHash",
  "inputRevision",
  "retirementRevision",
  "runId",
];
const PROVIDER_KEYS = [
  "buildSourceDigest",
  "modelId",
  "outputSchemaHash",
  "outputSchemaVersion",
  "policyHash",
  "policyId",
  "policyVersion",
  "profileHash",
  "profileId",
  "profileVersion",
  "promptHash",
  "promptVersion",
  "reasoningEffort",
  "requestId",
  "responseId",
  "serviceId",
];
const OUTPUT_KEYS = [
  "bundle",
  "candidateContractHash",
  "candidateId",
  "contractVersion",
  "fixedProposalReferences",
  "normalizedOutputHash",
  "proposalHash",
  "providerRequestHash",
  "rawOutputByteHash",
];
const CHART_KEYS = [
  "byteCount",
  "captureTime",
  "captureTimeProvenance",
  "chartId",
  "contentRef",
  "height",
  "mediaType",
  "paneRole",
  "provenance",
  "providerInputByteHash",
  "rawByteHash",
  "receivedAt",
  "session",
  "slot",
  "symbol",
  "timeframe",
  "timezone",
  "transformHash",
  "transformVersion",
  "width",
];
const TIME_KEYS = [
  "envelopeExpiresAt",
  "envelopeIssuedAt",
  "providerRequestFinishedAt",
  "providerRequestStartedAt",
  "serviceOutputReceivedAt",
];
const EVIDENCE_KEYS = [
  "accountScopeId",
  "authorityId",
  "authorityRevision",
  "chartManifestHash",
  "evidenceHash",
  "evidenceId",
  "inputHash",
  "kind",
  "observedAt",
  "outputHash",
  "policyHash",
  "receivedAt",
  "schemaVersion",
  "sourceTime",
];

function handoffError(message, code = "PRETRADE_PROVIDER_HANDOFF_INVALID", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return String(value ?? "").trim();
}

function strictKeys(value, keys, field) {
  if (!isRecord(value)) throw handoffError(`${field} must be an object`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw handoffError(`${field} has missing or unknown fields`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID", {
      field,
      actual,
      expected,
    });
  }
}

function requiredText(value, field, maxLength = 512) {
  const normalized = text(value);
  if (typeof value !== "string" || value !== normalized || !normalized || normalized.length > maxLength) {
    throw handoffError(`${field} is invalid`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID", { field });
  }
  return normalized;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function safeInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw handoffError(`${field} must be a safe integer`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID", { field });
  }
  return value;
}

function hash(value, field) {
  const normalized = text(value);
  if (!HASH_PATTERN.test(normalized)) {
    throw handoffError(`${field} must be a lowercase SHA-256 hash`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID", { field });
  }
  return normalized;
}

function uuid(value, field) {
  const normalized = text(value);
  if (!UUID_PATTERN.test(normalized)) {
    throw handoffError(`${field} must be a UUID`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID", { field });
  }
  return normalized;
}

function exactUtcTimestamp(value, field) {
  const normalized = text(value);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw handoffError(`${field} must be an exact UTC timestamp with milliseconds`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID", { field });
  }
  return normalized;
}

function nullableTimestamp(value, field) {
  return value === null ? null : exactUtcTimestamp(value, field);
}

function nullableText(value, field, maxLength = 512) {
  return value === null ? null : requiredText(value, field, maxLength);
}

function assertUnicodeAndNumbers(value, field = "envelope") {
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) {
          throw handoffError(`${field} contains an unpaired Unicode surrogate`, "PRETRADE_PROVIDER_HANDOFF_ENCODING_INVALID");
        }
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        throw handoffError(`${field} contains an unpaired Unicode surrogate`, "PRETRADE_PROVIDER_HANDOFF_ENCODING_INVALID");
      }
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw handoffError(`${field} contains an unsupported number`, "PRETRADE_PROVIDER_HANDOFF_ENCODING_INVALID");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertUnicodeAndNumbers(item, `${field}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertUnicodeAndNumbers(key, `${field} key`);
      assertUnicodeAndNumbers(item, `${field}.${key}`);
    }
  }
}

// JSON.parse discards duplicate object names. This small parser preserves that
// security boundary and otherwise follows JSON's grammar exactly.
function parseJsonWithoutDuplicateKeys(source) {
  let index = 0;
  const maxDepth = 64;
  const numberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
  const fail = (message) => {
    throw handoffError(message, "PRETRADE_PROVIDER_HANDOFF_JSON_INVALID", { offset: index });
  };
  const whitespace = () => {
    while ([" ", "\t", "\n", "\r"].includes(source[index] || "")) index += 1;
  };
  const parseString = () => {
    if (source[index] !== '"') fail("expected JSON string");
    const start = index;
    index += 1;
    let escaped = false;
    while (index < source.length) {
      const char = source[index];
      if (!escaped && char === '"') {
        index += 1;
        try { return JSON.parse(source.slice(start, index)); }
        catch { fail("invalid JSON string"); }
      }
      if (!escaped && char.charCodeAt(0) < 0x20) fail("unescaped control character in JSON string");
      if (!escaped && char === "\\") escaped = true;
      else escaped = false;
      index += 1;
    }
    fail("unterminated JSON string");
  };
  const parseNumber = () => {
    numberPattern.lastIndex = index;
    const match = numberPattern.exec(source);
    if (!match) fail("invalid JSON number");
    index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      fail("unsupported JSON number");
    }
    return value;
  };
  const parseValue = (depth = 0) => {
    if (depth > maxDepth) fail("JSON nesting depth exceeds the provider handoff limit");
    whitespace();
    const char = source[index];
    if (char === '"') return parseString();
    if (char === "{") return parseObject(depth);
    if (char === "[") return parseArray(depth);
    if (source.startsWith("true", index)) { index += 4; return true; }
    if (source.startsWith("false", index)) { index += 5; return false; }
    if (source.startsWith("null", index)) { index += 4; return null; }
    if (char === "-" || /\d/.test(char || "")) return parseNumber();
    fail("invalid JSON value");
  };
  const parseObject = (depth) => {
    index += 1;
    const value = Object.create(null);
    const names = new Set();
    whitespace();
    if (source[index] === "}") { index += 1; return value; }
    while (index < source.length) {
      whitespace();
      const name = parseString();
      if (names.has(name)) {
        throw handoffError(`duplicate JSON object name: ${name}`, "PRETRADE_PROVIDER_HANDOFF_DUPLICATE_KEY", { key: name });
      }
      names.add(name);
      whitespace();
      if (source[index] !== ":") fail("expected colon after JSON object name");
      index += 1;
      Object.defineProperty(value, name, { value: parseValue(depth + 1), enumerable: true, configurable: true, writable: true });
      whitespace();
      if (source[index] === "}") { index += 1; return value; }
      if (source[index] !== ",") fail("expected comma in JSON object");
      index += 1;
    }
    fail("unterminated JSON object");
  };
  const parseArray = (depth) => {
    index += 1;
    const value = [];
    whitespace();
    if (source[index] === "]") { index += 1; return value; }
    while (index < source.length) {
      value.push(parseValue(depth + 1));
      whitespace();
      if (source[index] === "]") { index += 1; return value; }
      if (source[index] !== ",") fail("expected comma in JSON array");
      index += 1;
    }
    fail("unterminated JSON array");
  };
  const value = parseValue();
  whitespace();
  if (index !== source.length) fail("unexpected data after JSON document");
  return value;
}

function assertChart(chart, index) {
  const field = `charts[${index}]`;
  strictKeys(chart, CHART_KEYS, field);
  safeInteger(chart.slot, `${field}.slot`, 0);
  requiredText(chart.paneRole, `${field}.paneRole`);
  requiredText(chart.chartId, `${field}.chartId`);
  requiredText(chart.contentRef, `${field}.contentRef`, 1024);
  hash(chart.rawByteHash, `${field}.rawByteHash`);
  safeInteger(chart.byteCount, `${field}.byteCount`, 1);
  requiredText(chart.mediaType, `${field}.mediaType`);
  if (chart.width !== null) safeInteger(chart.width, `${field}.width`, 1);
  if (chart.height !== null) safeInteger(chart.height, `${field}.height`, 1);
  if ((chart.width === null) !== (chart.height === null)) {
    throw handoffError(`${field} dimensions must be both present or both null`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
  nullableText(chart.symbol, `${field}.symbol`);
  nullableText(chart.timeframe, `${field}.timeframe`);
  nullableText(chart.session, `${field}.session`);
  nullableText(chart.timezone, `${field}.timezone`);
  if (!isRecord(chart.provenance)) throw handoffError(`${field}.provenance must be an object`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  exactUtcTimestamp(chart.receivedAt, `${field}.receivedAt`);
  nullableTimestamp(chart.captureTime, `${field}.captureTime`);
  nullableText(chart.captureTimeProvenance, `${field}.captureTimeProvenance`);
  if ((chart.captureTime === null) !== (chart.captureTimeProvenance === null)) {
    throw handoffError(`${field} capture time and provenance must be paired`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
  hash(chart.providerInputByteHash, `${field}.providerInputByteHash`);
  nullableText(chart.transformVersion, `${field}.transformVersion`);
  if (chart.transformHash !== null) hash(chart.transformHash, `${field}.transformHash`);
  if ((chart.transformVersion === null) !== (chart.transformHash === null)) {
    throw handoffError(`${field} transform version and hash must be paired`, "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
}

function assertEvidence(record, index) {
  const field = `evidence[${index}]`;
  strictKeys(record, EVIDENCE_KEYS, field);
  requiredText(record.evidenceId, `${field}.evidenceId`);
  hash(record.evidenceHash, `${field}.evidenceHash`);
  requiredText(record.authorityId, `${field}.authorityId`);
  safeInteger(record.schemaVersion, `${field}.schemaVersion`, 1);
  hash(record.inputHash, `${field}.inputHash`);
  hash(record.outputHash, `${field}.outputHash`);
  hash(record.chartManifestHash, `${field}.chartManifestHash`);
  requiredText(record.accountScopeId, `${field}.accountScopeId`);
  hash(record.policyHash, `${field}.policyHash`);
  exactUtcTimestamp(record.observedAt, `${field}.observedAt`);
  nullableTimestamp(record.sourceTime, `${field}.sourceTime`);
  exactUtcTimestamp(record.receivedAt, `${field}.receivedAt`);
  requiredText(record.authorityRevision, `${field}.authorityRevision`);
  requiredText(record.kind, `${field}.kind`);
}

export function validatePreTradeProviderHandoffEnvelope(envelope) {
  assertUnicodeAndNumbers(envelope);
  strictKeys(envelope, TOP_LEVEL_KEYS, "envelope");
  if (envelope.schemaVersion !== PRETRADE_PROVIDER_HANDOFF_SCHEMA) {
    throw handoffError("provider handoff schema is unsupported", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_UNSUPPORTED");
  }
  if (envelope.canonicalizationId !== PRETRADE_PROVIDER_HANDOFF_CANONICALIZATION) {
    throw handoffError("provider handoff canonicalization is unsupported", "PRETRADE_PROVIDER_HANDOFF_CANONICALIZATION_UNSUPPORTED");
  }
  if (envelope.signatureAlgorithm !== PRETRADE_PROVIDER_HANDOFF_SIGNATURE_ALGORITHM) {
    throw handoffError("provider handoff signature algorithm is unsupported", "PRETRADE_PROVIDER_HANDOFF_SIGNATURE_ALGORITHM_UNSUPPORTED");
  }
  requiredText(envelope.issuerId, "issuerId");
  requiredText(envelope.keyId, "keyId");
  requiredText(envelope.audienceInstallationId, "audienceInstallationId");
  uuid(envelope.storeEpoch, "storeEpoch");
  uuid(envelope.messageId, "messageId");
  requiredText(envelope.signature, "signature", 256);

  strictKeys(envelope.challenge, CHALLENGE_KEYS, "challenge");
  uuid(envelope.challenge.challengeId, "challenge.challengeId");
  const nonce = text(envelope.challenge.nonce);
  const nonceBytes = Buffer.from(nonce, "base64url");
  if (!/^[A-Za-z0-9_-]{43}$/.test(nonce) || nonceBytes.length !== 32 || nonceBytes.toString("base64url") !== nonce) {
    throw handoffError("challenge.nonce must encode 256 bits as base64url", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
  exactUtcTimestamp(envelope.challenge.issuedAt, "challenge.issuedAt");
  exactUtcTimestamp(envelope.challenge.expiresAt, "challenge.expiresAt");
  uuid(envelope.challenge.bootGeneration, "challenge.bootGeneration");

  strictKeys(envelope.run, RUN_KEYS, "run");
  requiredText(envelope.run.draftId, "run.draftId");
  safeInteger(envelope.run.inputRevision, "run.inputRevision", 0);
  requiredText(envelope.run.runId, "run.runId");
  hash(envelope.run.inputManifestHash, "run.inputManifestHash");
  safeInteger(envelope.run.retirementRevision, "run.retirementRevision", 0);
  requiredText(envelope.run.accountScopeId, "run.accountScopeId");
  requiredText(envelope.run.accountSelectionRevision, "run.accountSelectionRevision");

  strictKeys(envelope.provider, PROVIDER_KEYS, "provider");
  for (const field of ["serviceId", "requestId", "responseId", "modelId", "reasoningEffort", "promptVersion", "profileId", "policyId"]) {
    requiredText(envelope.provider[field], `provider.${field}`);
  }
  for (const field of ["outputSchemaVersion", "profileVersion", "policyVersion"]) {
    safeInteger(envelope.provider[field], `provider.${field}`, 1);
  }
  for (const field of ["promptHash", "outputSchemaHash", "profileHash", "buildSourceDigest", "policyHash"]) {
    hash(envelope.provider[field], `provider.${field}`);
  }

  strictKeys(envelope.output, OUTPUT_KEYS, "output");
  for (const field of ["providerRequestHash", "rawOutputByteHash", "normalizedOutputHash", "proposalHash", "candidateContractHash"]) {
    hash(envelope.output[field], `output.${field}`);
  }
  requiredText(envelope.output.candidateId, "output.candidateId");
  safeInteger(envelope.output.contractVersion, "output.contractVersion", 1);
  if (!isRecord(envelope.output.fixedProposalReferences)) {
    throw handoffError("output.fixedProposalReferences must be an object", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
  if (!isRecord(envelope.output.bundle)) {
    throw handoffError("output.bundle must be an object", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }

  if (!Array.isArray(envelope.charts) || envelope.charts.length === 0 || envelope.charts.length > 16) {
    throw handoffError("charts must contain 1 to 16 entries", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
  envelope.charts.forEach(assertChart);
  const slots = new Set(envelope.charts.map((chart) => chart.slot));
  const contentRefs = new Set(envelope.charts.map((chart) => chart.contentRef));
  const chartIds = new Set(envelope.charts.map((chart) => chart.chartId));
  if (
    slots.size !== envelope.charts.length
    || contentRefs.size !== envelope.charts.length
    || chartIds.size !== envelope.charts.length
    || envelope.charts.some((chart, index) => chart.slot !== index)
  ) {
    throw handoffError("chart order, slots and identities must be unique and consistent", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }

  strictKeys(envelope.times, TIME_KEYS, "times");
  for (const field of TIME_KEYS) exactUtcTimestamp(envelope.times[field], `times.${field}`);
  if (!Array.isArray(envelope.evidence) || envelope.evidence.length > 64) {
    throw handoffError("evidence must be a bounded array", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
  envelope.evidence.forEach(assertEvidence);
  const evidenceIds = new Set(envelope.evidence.map((record) => record.evidenceId));
  if (evidenceIds.size !== envelope.evidence.length) {
    throw handoffError("evidence IDs must be unique", "PRETRADE_PROVIDER_HANDOFF_SCHEMA_INVALID");
  }
  return envelope;
}

export function parsePreTradeProviderHandoff(input, { maxBytes = 2 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 16 * 1024 * 1024) {
    throw handoffError("provider handoff size limit is invalid", "PRETRADE_PROVIDER_HANDOFF_CONFIGURATION_INVALID");
  }
  const bytes = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(String(input ?? ""), "utf8");
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw handoffError("provider handoff document size is invalid", "PRETRADE_PROVIDER_HANDOFF_SIZE_INVALID", { byteLength: bytes.length });
  }
  const source = bytes.toString("utf8");
  if (!Buffer.from(source, "utf8").equals(bytes)) {
    throw handoffError("provider handoff must be valid UTF-8", "PRETRADE_PROVIDER_HANDOFF_ENCODING_INVALID");
  }
  const envelope = parseJsonWithoutDuplicateKeys(source);
  validatePreTradeProviderHandoffEnvelope(envelope);
  return { envelope: deepFreeze(envelope), bytes };
}

export function canonicalPreTradeProviderHandoffBytes(envelope) {
  validatePreTradeProviderHandoffEnvelope(envelope);
  const material = structuredClone(envelope);
  delete material.signature;
  return Buffer.concat([
    Buffer.from(PRETRADE_PROVIDER_HANDOFF_SIGNATURE_PREFIX, "utf8"),
    Buffer.from(JSON.stringify(canonicalJson(material)), "utf8"),
  ]);
}

export function preTradeProviderHandoffEnvelopeHash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function verifyPreTradeProviderHandoffSignature(envelope, publicKey) {
  const encoded = requiredText(envelope.signature, "signature", 256);
  let signature;
  try {
    signature = Buffer.from(encoded, "base64url");
  } catch {
    throw handoffError("provider handoff signature encoding is invalid", "PRETRADE_PROVIDER_HANDOFF_SIGNATURE_INVALID");
  }
  let valid = false;
  try {
    valid = /^[A-Za-z0-9_-]{86}$/.test(encoded)
      && signature.length === 64
      && signature.toString("base64url") === encoded
      && crypto.verify(null, canonicalPreTradeProviderHandoffBytes(envelope), publicKey, signature);
  } catch {
    valid = false;
  }
  if (!valid) {
    throw handoffError("provider handoff signature is invalid", "PRETRADE_PROVIDER_HANDOFF_SIGNATURE_INVALID");
  }
  return true;
}

export function signPreTradeProviderHandoff(unsignedEnvelope, privateKey) {
  const envelope = structuredClone(unsignedEnvelope);
  envelope.signature = "pending";
  validatePreTradeProviderHandoffEnvelope(envelope);
  envelope.signature = crypto.sign(null, canonicalPreTradeProviderHandoffBytes(envelope), privateKey).toString("base64url");
  return Object.freeze(envelope);
}
