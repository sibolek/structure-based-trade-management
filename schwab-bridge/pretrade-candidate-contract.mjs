import { PRETRADE_SCHEMA_VERSION, contentHash } from "./pretrade-state.mjs";
import { normalizeTriggerContract } from "./pretrade-trigger-contract.mjs";

export const CANONICAL_CANDIDATE_CONTRACT_AUTHORITY = "CANONICAL_CANDIDATE_INGRESS";
export const CANONICAL_CANDIDATE_CONTRACT_SCHEMA_VERSION = 1;
export const SOD_A_PLUS_TRADES_SOURCE = "SOD_A_PLUS_TRADES";

const ABSOLUTE_TIMESTAMP_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;
const CONTRACT_FIELDS = [
  "candidateId",
  "contractVersion",
  "schemaVersion",
  "source",
  "sourceDate",
  "generatedAt",
  "symbol",
  "direction",
  "setup",
  "decisionTimeframe",
  "entryTimeframe",
  "volatilityTimeframe",
  "timeframe",
  "thesis",
  "plan",
  "trigger",
  "structuralInvalidation",
  "entryIntent",
  "plannedEntryReference",
  "entryConstraints",
  "disqualifiers",
  "noTradeConditions",
  "targets",
  "managementContract",
  "managementPlan",
  "bestLocation",
  "context",
  "catalyst",
  "rating",
  "morningPriority",
  "sourceProvenance",
  "validity",
  "armPolicy",
];

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function absoluteTimestamp(value) {
  const raw = text(value);
  if (!raw || !ABSOLUTE_TIMESTAMP_PATTERN.test(raw)) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function validSourceDate(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === raw;
}

function normalizeTimezone(value) {
  const raw = text(value);
  if (!raw) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function normalizeSession(value) {
  if (typeof value === "string") return upper(value) || null;
  if (value && typeof value === "object" && Object.keys(value).length > 0) return clone(value);
  return null;
}

function equivalent(left, right) {
  return contentHash(left) === contentHash(right);
}

function normalizeValidity(input, errors) {
  const validity = input && typeof input === "object" ? input : {};
  const validFrom = absoluteTimestamp(validity.validFrom);
  const validUntil = absoluteTimestamp(validity.validUntil);
  const timezone = normalizeTimezone(validity.timezone);
  const session = normalizeSession(validity.session);

  if (!validFrom) errors.push("validity.validFrom must be an exact absolute timestamp with Z or UTC offset");
  if (!validUntil) errors.push("validity.validUntil must be an exact absolute timestamp with Z or UTC offset");
  if (validFrom && validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) {
    errors.push("validity.validUntil must be after validity.validFrom");
  }
  if (!timezone) errors.push("validity.timezone must be a valid IANA timezone");
  if (!session) errors.push("validity.session provenance is required");

  return {
    validFrom: validFrom || text(validity.validFrom) || null,
    validUntil: validUntil || text(validity.validUntil) || null,
    timezone: timezone || text(validity.timezone) || null,
    session,
    sourceLabel: text(validity.sourceLabel) || null,
    provenance: validity.provenance ?? null,
  };
}

function forbiddenAuthorityErrors(candidate) {
  const errors = [];
  const lifecycle = upper(candidate.lifecycleState || candidate.status);
  if (lifecycle && lifecycle !== "WAITING") {
    errors.push("upstream candidate proposals may not establish lifecycle state other than WAITING");
  }

  if (candidate.armAuthorized === true || candidate.armPolicy?.armAuthorized === true) {
    errors.push("upstream candidate proposals may not establish ARM authorization");
  }

  const forbidden = [
    ["arm", candidate.arm],
    ["handoff", candidate.handoff],
    ["permissionOutcome", candidate.permissionOutcome],
    ["riskEvaluation", candidate.riskEvaluation],
    ["authorizedDssEvaluationId", candidate.authorizedDssEvaluationId],
    ["authorizedRiskEvaluationId", candidate.authorizedRiskEvaluationId],
    ["selectedQuantity", candidate.selectedQuantity],
    ["executionState", candidate.executionState],
  ];
  for (const [field, value] of forbidden) {
    if (value !== undefined && value !== null && value !== false && value !== "") {
      errors.push(`${field} is runtime authority/review state and may not be imported as candidate authority`);
    }
  }
  return errors;
}

export function normalizeCanonicalCandidateProposal(input, { bundleSource = null } = {}) {
  const candidate = input && typeof input === "object" ? input : {};
  const errors = forbiddenAuthorityErrors(candidate);
  const normalizedBundleSource = upper(bundleSource);
  const candidateSource = upper(candidate.source || normalizedBundleSource);

  if (!normalizedBundleSource) errors.push("bundle source is required");
  if (!candidateSource) errors.push("candidate source is required");
  if (candidateSource && normalizedBundleSource && candidateSource !== normalizedBundleSource) {
    errors.push("candidate source must match authoritative bundle source");
  }

  const structuralInput = candidate.structuralInvalidation && typeof candidate.structuralInvalidation === "object"
    ? clone(candidate.structuralInvalidation)
    : {};
  const structuralInvalidation = {
    ...structuralInput,
    price: finiteNumber(structuralInput.price),
    rule: text(structuralInput.rule),
    referenceType: text(structuralInput.referenceType),
    reason: text(structuralInput.reason),
    sourceTimeframe: text(structuralInput.sourceTimeframe) || null,
  };

  const triggerInput = candidate.trigger && typeof candidate.trigger === "object" ? clone(candidate.trigger) : null;
  let trigger = null;
  if (triggerInput) {
    const triggerResult = normalizeTriggerContract(triggerInput);
    trigger = triggerResult.normalized;
    errors.push(...triggerResult.errors.map((message) => `trigger: ${message}`));
  }

  const decisionTimeframe = text(candidate.decisionTimeframe || "5m");
  const entryTimeframe = text(candidate.entryTimeframe || candidate.timeframe || "2m");
  const volatilityTimeframe = text(candidate.volatilityTimeframe || "2m");
  if (candidate.timeframe && candidate.entryTimeframe && text(candidate.timeframe) !== text(candidate.entryTimeframe)) {
    errors.push("legacy timeframe and entryTimeframe may not conflict");
  }

  const managementContractInput = candidate.managementContract ?? candidate.managementPlan ?? null;
  if (
    candidate.managementContract !== undefined
    && candidate.managementPlan !== undefined
    && !equivalent(candidate.managementContract, candidate.managementPlan)
  ) {
    errors.push("managementContract and legacy managementPlan may not conflict");
  }
  const managementContract = managementContractInput && typeof managementContractInput === "object"
    ? clone(managementContractInput)
    : null;

  const generatedAt = absoluteTimestamp(candidate.generatedAt);
  const sourceDate = text(candidate.sourceDate);
  const armPolicyInput = candidate.armPolicy && typeof candidate.armPolicy === "object" ? candidate.armPolicy : {};
  const requestedMode = upper(armPolicyInput.requestedMode || "MANUAL");
  if (!["MANUAL", "AUTO"].includes(requestedMode)) {
    errors.push("armPolicy.requestedMode must be MANUAL or AUTO");
  }
  if (candidateSource === SOD_A_PLUS_TRADES_SOURCE && requestedMode !== "MANUAL") {
    errors.push("SOD_A_PLUS_TRADES candidates must request MANUAL ARM review");
  }

  const validity = normalizeValidity(candidate.validity, errors);

  const normalized = {
    candidateId: text(candidate.candidateId),
    contractVersion: Number(candidate.contractVersion),
    schemaVersion: Number(candidate.schemaVersion ?? PRETRADE_SCHEMA_VERSION),
    source: candidateSource,
    sourceDate,
    generatedAt: generatedAt || text(candidate.generatedAt),
    symbol: upper(candidate.symbol),
    direction: upper(candidate.direction),
    setup: text(candidate.setup),
    decisionTimeframe,
    entryTimeframe,
    volatilityTimeframe,
    timeframe: entryTimeframe,
    thesis: text(candidate.thesis),
    plan: candidate.plan ?? null,
    trigger,
    structuralInvalidation,
    entryIntent: candidate.entryIntent ?? null,
    plannedEntryReference: candidate.plannedEntryReference ?? null,
    entryConstraints: candidate.entryConstraints ?? null,
    disqualifiers: candidate.disqualifiers ?? null,
    noTradeConditions: candidate.noTradeConditions ?? null,
    targets: Array.isArray(candidate.targets) ? clone(candidate.targets) : [],
    managementContract,
    managementPlan: managementContract,
    bestLocation: candidate.bestLocation ?? null,
    context: candidate.context ?? null,
    catalyst: candidate.catalyst ?? null,
    rating: candidate.rating ?? null,
    morningPriority: candidate.morningPriority ?? null,
    sourceProvenance: candidate.sourceProvenance ?? null,
    validity,
    armPolicy: {
      requestedMode,
      finalAuthorizationMode: "MANUAL",
    },
  };

  if (!normalized.candidateId) errors.push("candidateId is required");
  if (!Number.isInteger(normalized.contractVersion) || normalized.contractVersion < 1) {
    errors.push("contractVersion must be an integer >= 1");
  }
  if (!Number.isInteger(normalized.schemaVersion) || normalized.schemaVersion < 1) {
    errors.push("schemaVersion must be an integer >= 1");
  }
  if (!validSourceDate(sourceDate)) errors.push("sourceDate must be an exact YYYY-MM-DD date");
  if (!generatedAt) errors.push("generatedAt must be an exact absolute timestamp with Z or UTC offset");
  if (!normalized.symbol) errors.push("symbol is required");
  if (!["LONG", "SHORT"].includes(normalized.direction)) errors.push("direction must be LONG or SHORT");
  if (!normalized.setup) errors.push("setup is required");
  if (!normalized.decisionTimeframe) errors.push("decisionTimeframe is required");
  if (!normalized.entryTimeframe) errors.push("entryTimeframe is required");
  if (!normalized.volatilityTimeframe) errors.push("volatilityTimeframe is required");
  if (!normalized.thesis) errors.push("thesis is required");
  if (!normalized.trigger) errors.push("structured trigger object is required");
  if (!structuralInvalidation.rule) errors.push("structuralInvalidation.rule is required");
  if (
    structuralInvalidation.price === null
    && !structuralInvalidation.referenceType
    && !(structuralInput.reference && typeof structuralInput.reference === "object")
  ) {
    errors.push("structuralInvalidation requires a resolved price or structured reference definition");
  }
  if (!managementContract) errors.push("structured managementContract is required");

  return { normalized, errors: [...new Set(errors)] };
}

export function canonicalCandidateContent(candidate) {
  const content = {};
  for (const field of CONTRACT_FIELDS) content[field] = clone(candidate?.[field]);
  return content;
}

export function candidateContractHash(candidate) {
  return contentHash(canonicalCandidateContent(candidate));
}

export function buildCanonicalContractAuthority({ contentHash: hash, bundleSource, bundleId, acceptedAt } = {}) {
  return {
    authority: CANONICAL_CANDIDATE_CONTRACT_AUTHORITY,
    schemaVersion: CANONICAL_CANDIDATE_CONTRACT_SCHEMA_VERSION,
    contentHash: text(hash),
    bundleSource: upper(bundleSource),
    bundleId: text(bundleId),
    acceptedAt: text(acceptedAt),
  };
}

export function isCanonicalCandidate(candidate) {
  return candidate?.contractAuthority?.authority === CANONICAL_CANDIDATE_CONTRACT_AUTHORITY;
}

export function assertCanonicalCandidateIntegrity(candidate) {
  if (!isCanonicalCandidate(candidate)) return { canonical: false, contentHash: candidate?.contentHash ?? null };
  const expected = text(candidate.contentHash);
  const actual = candidateContractHash(candidate);
  if (!expected || expected !== actual || text(candidate.contractAuthority?.contentHash) !== expected) {
    const error = new Error("canonical candidate contract content no longer matches its accepted immutable hash");
    error.code = "CANDIDATE_CONTRACT_INTEGRITY_ERROR";
    error.details = { expectedContentHash: expected || null, actualContentHash: actual };
    throw error;
  }
  return { canonical: true, contentHash: actual };
}

export function candidateValidityStatusAt(candidate, at) {
  if (!isCanonicalCandidate(candidate)) return { status: "UNMANAGED_LEGACY", validFrom: null, validUntil: null };
  const now = Date.parse(String(at ?? ""));
  const validFrom = Date.parse(String(candidate?.validity?.validFrom ?? ""));
  const validUntil = Date.parse(String(candidate?.validity?.validUntil ?? ""));
  if (!Number.isFinite(now) || !Number.isFinite(validFrom) || !Number.isFinite(validUntil) || validUntil <= validFrom) {
    return { status: "UNVERIFIABLE", validFrom: candidate?.validity?.validFrom ?? null, validUntil: candidate?.validity?.validUntil ?? null };
  }
  if (now < validFrom) return { status: "NOT_YET_VALID", validFrom: candidate.validity.validFrom, validUntil: candidate.validity.validUntil };
  if (now >= validUntil) return { status: "EXPIRED", validFrom: candidate.validity.validFrom, validUntil: candidate.validity.validUntil };
  return { status: "VALID", validFrom: candidate.validity.validFrom, validUntil: candidate.validity.validUntil };
}
