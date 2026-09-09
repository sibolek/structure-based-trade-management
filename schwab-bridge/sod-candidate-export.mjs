import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeCanonicalCandidateProposal,
  SOD_A_PLUS_TRADES_SOURCE,
} from "./pretrade-candidate-contract.mjs";
import { AUTOMATED_UNTOUCHED_ONLY } from "./pretrade-candidate-ingress.mjs";

export const SOD_EXPORT_SCHEMA_VERSION = 1;

const FORBIDDEN_RUNTIME_AUTHORITY_FIELDS = [
  "arm",
  "handoff",
  "permissionOutcome",
  "riskEvaluation",
  "authorizedDssEvaluationId",
  "authorizedRiskEvaluationId",
  "selectedQuantity",
  "executionState",
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

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function slug(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function exactNumericString(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function normalizedTargets(targets) {
  if (!Array.isArray(targets)) return [];
  return targets.map((target, index) => {
    if (target && typeof target === "object") {
      const result = clone(target);
      const exact = exactNumericString(target.price ?? target.level ?? target.value ?? target.priceOrZone);
      const label = text(target.label || target.name || target.targetId) || `T${index + 1}`;
      result.targetId = text(target.targetId || target.id) || label;
      result.label = label;
      if (exact !== null) {
        result.price = exact;
        delete result.priceOrZone;
      } else if (target.priceOrZone !== undefined && result.reference === undefined) {
        result.reference = text(target.priceOrZone) || null;
      }
      return result;
    }
    const exact = exactNumericString(target);
    return exact !== null
      ? { targetId: `T${index + 1}`, label: `T${index + 1}`, price: exact }
      : { targetId: `T${index + 1}`, label: `T${index + 1}`, reference: text(target) || null };
  });
}

function normalizedTrigger(trigger, candidateId) {
  if (!trigger || typeof trigger !== "object") return trigger ?? null;
  if (trigger.satisfaction && typeof trigger.satisfaction === "object") return clone(trigger);

  if (upper(trigger.type) === "MANUAL_CONFIRMATION") {
    const prompt = text(trigger.prompt || trigger.description);
    return {
      schemaVersion: 1,
      evaluatorVersion: 1,
      satisfaction: {
        nodeId: text(trigger.nodeId || trigger.id) || `operator-confirm-${candidateId}`,
        type: "MANUAL_CONFIRMATION",
        prompt: prompt || null,
      },
      persistence: clone(trigger.persistence) || { type: "ONE_SHOT" },
    };
  }

  return clone(trigger);
}

function defaultManagementContract() {
  return {
    mode: "SINGLE_ENTRY",
    allowReAdd: false,
    allowFlatReEntry: false,
    source: "SOD_EXPORT_DEFAULT_FAIL_CLOSED",
  };
}

function sourceProvenance(candidate) {
  if (candidate.sourceProvenance !== undefined) return clone(candidate.sourceProvenance);
  const legacyValidity = candidate.validity && typeof candidate.validity === "object" ? candidate.validity : {};
  const provenance = {
    tradeDate: text(legacyValidity.tradeDate) || null,
    session: legacyValidity.session ?? null,
    sourceSnapshot: text(legacyValidity.sourceSnapshot) || null,
  };
  return Object.values(provenance).some((value) => value !== null) ? provenance : null;
}

function exportError(message, details = null) {
  const error = new Error(message);
  error.code = "SOD_CANDIDATE_EXPORT_INVALID";
  if (details) error.details = details;
  return error;
}

function candidateIdFor(candidate, sourceDate, index, { requireExplicitCandidateId = false } = {}) {
  const explicit = text(candidate.candidateId);
  if (explicit) return explicit;
  if (requireExplicitCandidateId) {
    throw exportError(
      `Automated SOD publication requires explicit stable candidateId at index ${index}`,
      { index },
    );
  }
  const setupSlug = slug(candidate.setup) || `candidate-${index + 1}`;
  const symbol = slug(upper(candidate.symbol)) || "symbol";
  const direction = slug(upper(candidate.direction)) || "direction";
  const priority = Number(candidate.morningPriority);
  const qualifier = text(candidate.candidateKey)
    ? `-${slug(candidate.candidateKey)}`
    : candidate.morningPriority !== null
      && candidate.morningPriority !== undefined
      && Number.isInteger(priority)
      && priority >= 1
      ? `-p${priority}`
      : "";
  return `sod-${sourceDate}-${symbol}-${direction}-${setupSlug}${qualifier}`;
}

function meaningfulAuthorityValue(value) {
  return value !== undefined && value !== null && value !== false && value !== "";
}

function assertNoRuntimeAuthority(candidate, index) {
  const violations = [];
  const lifecycle = upper(candidate.lifecycleState || candidate.status);
  if (lifecycle && lifecycle !== "WAITING") {
    violations.push(`lifecycle/status ${lifecycle} is runtime authority; only WAITING proposal intent is permitted`);
  }
  if (candidate.armAuthorized === true || candidate.armPolicy?.armAuthorized === true) {
    violations.push("ARM authorization may not be supplied by SOD export input");
  }
  for (const field of FORBIDDEN_RUNTIME_AUTHORITY_FIELDS) {
    if (hasOwn(candidate, field) && meaningfulAuthorityValue(candidate[field])) {
      violations.push(`${field} is runtime authority/review state and may not be supplied by SOD export input`);
    }
  }
  if (violations.length) {
    throw exportError(
      `SOD candidate at index ${index} contains forbidden runtime authority: ${violations.join("; ")}`,
      { index, violations },
    );
  }
}

function resolvedManagementContract(candidate, candidateId) {
  if (candidate.managementPlan !== undefined && (
    !candidate.managementPlan
    || typeof candidate.managementPlan !== "object"
    || Array.isArray(candidate.managementPlan)
  )) {
    throw exportError(
      `SOD candidate ${candidateId} has legacy managementPlan that is not a structured object; provide managementContract or omit it for the fail-closed default`,
      { candidateId },
    );
  }

  const managementContract = candidate.managementContract
    ?? candidate.managementPlan
    ?? defaultManagementContract();

  if (!managementContract || typeof managementContract !== "object" || Array.isArray(managementContract)) {
    throw exportError(`SOD candidate ${candidateId} managementContract must be a structured object`, { candidateId });
  }
  if (!text(managementContract.mode)) {
    throw exportError(`SOD candidate ${candidateId} managementContract.mode is required`, { candidateId });
  }
  return clone(managementContract);
}

function buildCandidate(candidate, {
  sourceDate,
  generatedAt,
  bundleValidity,
  index,
  requireExplicitCandidateId,
}) {
  assertNoRuntimeAuthority(candidate, index);

  if (candidate.source && upper(candidate.source) !== SOD_A_PLUS_TRADES_SOURCE) {
    throw exportError(
      `SOD candidate at index ${index} source must be ${SOD_A_PLUS_TRADES_SOURCE}`,
      { index, candidateSource: candidate.source },
    );
  }
  if (candidate.sourceDate && text(candidate.sourceDate) !== sourceDate) {
    throw exportError(
      `SOD candidate at index ${index} sourceDate ${text(candidate.sourceDate)} conflicts with bundle sourceDate ${sourceDate}`,
      { index, candidateSourceDate: text(candidate.sourceDate), bundleSourceDate: sourceDate },
    );
  }

  const candidateId = candidateIdFor(candidate, sourceDate, index, { requireExplicitCandidateId });
  const validity = hasOwn(candidate, "validity") ? clone(candidate.validity) : clone(bundleValidity);
  const managementContract = resolvedManagementContract(candidate, candidateId);

  const proposal = {
    candidateId,
    contractVersion: Number(candidate.contractVersion ?? 1),
    schemaVersion: Number(candidate.schemaVersion ?? 1),
    source: SOD_A_PLUS_TRADES_SOURCE,
    sourceDate,
    generatedAt: text(candidate.generatedAt || generatedAt),
    symbol: upper(candidate.symbol),
    direction: upper(candidate.direction),
    setup: text(candidate.setup),
    decisionTimeframe: text(candidate.decisionTimeframe || "5m"),
    entryTimeframe: text(candidate.entryTimeframe || candidate.timeframe || "2m"),
    volatilityTimeframe: text(candidate.volatilityTimeframe || "2m"),
    timeframe: text(candidate.entryTimeframe || candidate.timeframe || "2m"),
    thesis: text(candidate.thesis),
    plan: clone(candidate.plan) ?? null,
    trigger: normalizedTrigger(candidate.trigger, candidateId),
    structuralInvalidation: clone(candidate.structuralInvalidation) ?? null,
    entryIntent: clone(candidate.entryIntent) ?? null,
    plannedEntryReference: clone(candidate.plannedEntryReference) ?? null,
    entryConstraints: clone(candidate.entryConstraints) ?? null,
    disqualifiers: clone(candidate.disqualifiers) ?? null,
    noTradeConditions: clone(candidate.noTradeConditions)
      ?? (text(candidate.plan?.noTradeZone) ? [text(candidate.plan.noTradeZone)] : null),
    targets: normalizedTargets(candidate.targets),
    managementContract,
    ...(candidate.managementPlan !== undefined ? { managementPlan: clone(candidate.managementPlan) } : {}),
    bestLocation: clone(candidate.bestLocation ?? candidate.plan?.bestLocation) ?? null,
    context: clone(candidate.context)
      ?? (candidate.riskPolicy ? { riskPolicy: clone(candidate.riskPolicy) } : null),
    catalyst: clone(candidate.catalyst) ?? null,
    rating: clone(candidate.rating) ?? null,
    morningPriority: clone(candidate.morningPriority) ?? null,
    sourceProvenance: sourceProvenance(candidate),
    validity,
    armPolicy: {
      requestedMode: upper(candidate.armPolicy?.requestedMode || "MANUAL"),
    },
  };

  const result = normalizeCanonicalCandidateProposal(proposal, {
    bundleSource: SOD_A_PLUS_TRADES_SOURCE,
  });
  if (result.errors.length) {
    throw exportError(
      `SOD candidate ${candidateId} failed canonical V2.4 validation: ${result.errors.join("; ")}`,
      { candidateId, index, errors: result.errors },
    );
  }
  return result.normalized;
}

export function buildCanonicalSodCandidateBundle(input, {
  clock = () => new Date().toISOString(),
  automatedPublication = false,
} = {}) {
  if (!input || typeof input !== "object") throw exportError("SOD export input must be an object");
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (!candidates.length) throw exportError("SOD export requires at least one candidate");

  const sourceDate = text(input.sourceDate || candidates[0]?.sourceDate || candidates[0]?.validity?.tradeDate);
  if (!sourceDate) throw exportError("SOD export sourceDate is required");
  const generatedAt = text(input.generatedAt || clock());
  const bundleId = text(input.bundleId) || `sod-${sourceDate}-a-plus-trades-v${Number(input.bundleVersion ?? 1)}`;
  const bundleValidity = input.validity && typeof input.validity === "object" ? input.validity : null;

  if (input.source && upper(input.source) !== SOD_A_PLUS_TRADES_SOURCE) {
    throw exportError(`SOD export source must be ${SOD_A_PLUS_TRADES_SOURCE}`);
  }

  const normalizedCandidates = candidates.map((candidate, index) => buildCandidate(candidate || {}, {
    sourceDate,
    generatedAt,
    bundleValidity,
    index,
    requireExplicitCandidateId: automatedPublication,
  }));

  const ids = normalizedCandidates.map((candidate) => candidate.candidateId);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicateIds.length) {
    throw exportError(`SOD export produced duplicate candidateId values: ${duplicateIds.join(", ")}`, { duplicateIds });
  }

  return {
    schemaVersion: SOD_EXPORT_SCHEMA_VERSION,
    source: SOD_A_PLUS_TRADES_SOURCE,
    sourceDate,
    generatedAt,
    bundleId,
    ...(automatedPublication ? { ingressPolicy: AUTOMATED_UNTOUCHED_ONLY } : {}),
    candidates: normalizedCandidates,
  };
}

function cli() {
  const args = process.argv.slice(2);
  const automatedPublication = args.includes("--automated");
  const positional = args.filter((arg) => arg !== "--automated");
  const inputPath = positional[0];
  const outputPath = positional[1] || null;
  if (!inputPath) {
    console.error("Usage: npm run v24:sod-export -- [--automated] <input.json> [output.json]");
    process.exitCode = 2;
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
    const bundle = buildCanonicalSodCandidateBundle(raw, { automatedPublication });
    const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
    if (outputPath) {
      fs.writeFileSync(path.resolve(outputPath), serialized);
      console.error(`✓ Canonical V2.4 SOD bundle written to ${path.resolve(outputPath)}`);
    } else {
      process.stdout.write(serialized);
    }
  } catch (error) {
    console.error(`✗ ${error.code || "SOD_EXPORT_ERROR"}: ${error.message}`);
    if (error.details) console.error(JSON.stringify(error.details, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli();