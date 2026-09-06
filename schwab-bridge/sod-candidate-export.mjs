import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizeCanonicalCandidateProposal,
  SOD_A_PLUS_TRADES_SOURCE,
} from "./pretrade-candidate-contract.mjs";

export const SOD_EXPORT_SCHEMA_VERSION = 1;

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
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

function candidateIdFor(candidate, sourceDate, index) {
  const explicit = text(candidate.candidateId);
  if (explicit) return explicit;
  const setupSlug = slug(candidate.setup) || `candidate-${index + 1}`;
  const symbol = slug(upper(candidate.symbol)) || "symbol";
  const direction = slug(upper(candidate.direction)) || "direction";
  const qualifier = text(candidate.candidateKey)
    ? `-${slug(candidate.candidateKey)}`
    : Number.isInteger(Number(candidate.morningPriority))
      ? `-p${Number(candidate.morningPriority)}`
      : "";
  return `sod-${sourceDate}-${symbol}-${direction}-${setupSlug}${qualifier}`;
}

function exportError(message, details = null) {
  const error = new Error(message);
  error.code = "SOD_CANDIDATE_EXPORT_INVALID";
  if (details) error.details = details;
  return error;
}

function buildCandidate(candidate, {
  sourceDate,
  generatedAt,
  bundleValidity,
  index,
}) {
  const candidateId = candidateIdFor(candidate, sourceDate, index);
  const validity = candidate.validity?.validFrom ? clone(candidate.validity) : clone(bundleValidity);
  const managementContract = candidate.managementContract
    ?? candidate.managementPlan
    ?? defaultManagementContract();

  const proposal = {
    candidateId,
    contractVersion: Number(candidate.contractVersion ?? 1),
    schemaVersion: Number(candidate.schemaVersion ?? 1),
    source: SOD_A_PLUS_TRADES_SOURCE,
    sourceDate: text(candidate.sourceDate || sourceDate),
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
    managementContract: clone(managementContract),
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
    candidates: normalizedCandidates,
  };
}

function cli() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || null;
  if (!inputPath) {
    console.error("Usage: npm run v24:sod-export -- <input.json> [output.json]");
    process.exitCode = 2;
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
    const bundle = buildCanonicalSodCandidateBundle(raw);
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
