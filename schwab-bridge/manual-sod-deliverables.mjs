import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeCanonicalCandidateProposal, SOD_A_PLUS_TRADES_SOURCE } from "./pretrade-candidate-contract.mjs";
import { MANUAL_AUTHORIZED } from "./pretrade-candidate-ingress.mjs";

// Manual package delivery only. Production export/publication never calls this.
// Validate completed canonical contracts, but emit the originals without normalization.
export function buildManualSodIndividualCandidateBundles(bundle) {
  if (!bundle || bundle.source !== SOD_A_PLUS_TRADES_SOURCE
    || !bundle.bundleId || !Array.isArray(bundle.candidates)
    || Object.hasOwn(bundle, "ingestionSchemaVersion")) {
    throw new Error("Manual SOD deliverables require a completed canonical SOD bundle.");
  }
  if (Object.hasOwn(bundle, "ingressPolicy") && bundle.ingressPolicy !== MANUAL_AUTHORIZED) {
    throw new Error("Manual SOD deliverables cannot relabel an automated or unsupported ingress policy.");
  }
  const ids = new Set();
  for (const candidate of bundle.candidates) {
    const { errors } = normalizeCanonicalCandidateProposal(candidate, { bundleSource: bundle.source });
    if (errors.length) throw new Error(`Invalid manual SOD candidate: ${errors.join("; ")}`);
    if (candidate.sourceDate !== bundle.sourceDate) throw new Error("Candidate sourceDate must match the manual SOD bundle.");
    if (ids.has(candidate.candidateId)) throw new Error("Manual SOD candidateId values must be unique.");
    ids.add(candidate.candidateId);
  }
  const { candidates, ...metadata } = bundle;
  return candidates.map(candidate => ({
    ...structuredClone(metadata),
    ingressPolicy: MANUAL_AUTHORIZED,
    candidates: [structuredClone(candidate)],
  }));
}

export function writeManualSodIndividualCandidateFiles(bundle, outputDirectory) {
  const individualBundles = buildManualSodIndividualCandidateBundles(bundle);
  fs.mkdirSync(outputDirectory, { recursive: true });
  return individualBundles.map((individual, index) => {
    const label = individual.candidates[0].candidateId.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
    const filePath = path.join(outputDirectory, `${String(index + 1).padStart(2, "0")}-${label}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(individual, null, 2)}\n`, { flag: "wx" });
    return filePath;
  });
}

function cli() {
  const [inputPath, outputDirectory, ...extra] = process.argv.slice(2);
  if (!inputPath || !outputDirectory || extra.length || inputPath.startsWith("--")) {
    console.error("Usage: node schwab-bridge/manual-sod-deliverables.mjs <manual-canonical-bundle.json> <individual-output-directory>");
    process.exitCode = 2;
    return;
  }
  try {
    const bundle = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
    const files = writeManualSodIndividualCandidateFiles(bundle, path.resolve(outputDirectory));
    console.error(`Wrote ${files.length} manual SOD individual candidate file(s).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) cli();
