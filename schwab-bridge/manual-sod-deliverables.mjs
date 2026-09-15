import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeCanonicalCandidateProposal, SOD_A_PLUS_TRADES_SOURCE } from "./pretrade-candidate-contract.mjs";
import { prepareManualCandidateImport } from "../src/pretrade/manual-candidate-import.js";
import { MANUAL_AUTHORIZED } from "./pretrade-candidate-ingress.mjs";

// Manual package delivery only. Production export/publication never calls this.
// Validate completed canonical contracts, but emit the originals without normalization.
function validateManualSodBundle(bundle) {
  if (!bundle || bundle.source !== SOD_A_PLUS_TRADES_SOURCE
    || typeof bundle.bundleId !== "string" || !bundle.bundleId.trim() || !Array.isArray(bundle.candidates)
    || Object.hasOwn(bundle, "ingestionSchemaVersion")) {
    throw new Error("Manual SOD deliverables require a completed canonical SOD bundle.");
  }
  if (Object.hasOwn(bundle, "ingressPolicy") && bundle.ingressPolicy !== MANUAL_AUTHORIZED) {
    throw new Error("Manual SOD deliverables cannot relabel an automated or unsupported ingress policy.");
  }
  const ids = new Set();
  for (const [index, candidate] of bundle.candidates.entries()) {
    const location = `candidates[${index}]${candidate?.candidateId ? ` (${candidate.candidateId})` : ""}`;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Invalid manual SOD ${location}: candidate must be a JSON object.`);
    }
    const { normalized, errors } = normalizeCanonicalCandidateProposal(candidate, { bundleSource: bundle.source });
    if (errors.length) throw new Error(`Invalid manual SOD ${location}: ${errors.join("; ")}`);
    if (candidate.sourceDate !== bundle.sourceDate) throw new Error(`Invalid manual SOD ${location}: candidate sourceDate must match the manual SOD bundle.`);
    if (ids.has(normalized.candidateId)) throw new Error(`Invalid manual SOD ${location}: candidateId values must be unique.`);
    ids.add(normalized.candidateId);
  }
}

// Read-only delivery gate for the exact file that will be Previewed/Imported.
// Reuse the UI's JSON/envelope checks and the current ingress contract; never repair.
export function validateManualSodIndividualCandidateJson(raw) {
  const { body, kind } = prepareManualCandidateImport(raw);
  // The UI also accepts bare candidates, but manual SOD deliverables must already
  // contain their one-candidate envelope and policy (no implicit wrapping).
  const supplied = JSON.parse(raw);
  if (kind !== "canonical" || Object.hasOwn(supplied, "candidateId")) {
    throw new Error("Manual SOD delivery requires a completed canonical one-candidate bundle.");
  }
  validateManualSodBundle(body);
  return body;
}

export function buildManualSodIndividualCandidateBundles(bundle) {
  validateManualSodBundle(bundle);
  const { candidates, ...metadata } = bundle;
  return candidates.map(candidate => ({
    ...structuredClone(metadata),
    ingressPolicy: MANUAL_AUTHORIZED,
    candidates: [structuredClone(candidate)],
  }));
}

export function writeManualSodIndividualCandidateFiles(bundle, outputDirectory) {
  const individualBundles = buildManualSodIndividualCandidateBundles(bundle);
  // Check every final serialization before creating any output. The wrapper and
  // indentation count toward Preview's limits too.
  const serialized = individualBundles.map((individual, index) => {
    try {
      const raw = `${JSON.stringify(individual, null, 2)}\n`;
      validateManualSodIndividualCandidateJson(raw);
      return raw;
    } catch (error) {
      throw new Error(`Invalid manual SOD candidates[${index}] (${bundle.candidates[index].candidateId}): ${error.message}`, { cause: error });
    }
  });
  fs.mkdirSync(outputDirectory, { recursive: true });
  return individualBundles.map((individual, index) => {
    const label = String(individual.candidates[0].candidateId).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
    const filePath = path.join(outputDirectory, `${String(index + 1).padStart(2, "0")}-${label}.json`);
    fs.writeFileSync(filePath, serialized[index], { flag: "wx" });
    return filePath;
  });
}

function cli() {
  const args = process.argv.slice(2);
  const validateOnly = args[0] === "--validate-only";
  if (validateOnly) args.shift();
  const [inputPath, outputDirectory, ...extra] = args;
  if (!inputPath || (validateOnly ? outputDirectory !== undefined : !outputDirectory) || extra.length || inputPath.startsWith("--")) {
    console.error("Usage: node schwab-bridge/manual-sod-deliverables.mjs <manual-canonical-bundle.json> <individual-output-directory>");
    console.error("       node schwab-bridge/manual-sod-deliverables.mjs --validate-only <individual-candidate.json>");
    process.exitCode = 2;
    return;
  }
  try {
    const raw = fs.readFileSync(path.resolve(inputPath), "utf8");
    if (validateOnly) {
      const bundle = validateManualSodIndividualCandidateJson(raw);
      console.log(`VALID manual SOD file: ${bundle.candidates[0].candidateId}. Current canonical contract and manual Preview format passed; PRETRADE admission/ARM remain separate.`);
      return;
    }
    const bundle = JSON.parse(raw);
    const files = writeManualSodIndividualCandidateFiles(bundle, path.resolve(outputDirectory));
    console.error(`Wrote ${files.length} manual SOD individual candidate file(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli();
