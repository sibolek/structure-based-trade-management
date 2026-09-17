import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { expandManualPath, writeDefaultManualTransport } from "./manual-output-paths.mjs";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Transport only: no renderer, candidate contract, services, or provider imports.
// Keep authored values; never normalize, repair, or confer candidate authority.
export function serializeManualSodAnalysis(input) {
  if (!isObject(input)) throw new Error("Manual SOD analysis must be an object.");
  const { artifactContent, candidateProposals = [], bundleMetadata = null } = input;
  if (!isObject(artifactContent)) throw new Error("Manual SOD artifactContent must be an object.");
  if (!Array.isArray(candidateProposals)) throw new Error("Manual SOD candidateProposals must be an array.");
  if (bundleMetadata !== null && !isObject(bundleMetadata)) {
    throw new Error("Manual SOD bundleMetadata must be an object or null.");
  }
  const transport = { artifactContent, candidateProposals, bundleMetadata };
  const serialized = `${JSON.stringify(transport, null, 2)}\n`;
  // Reject lossy JS values (undefined, NaN, Dates, sparse arrays, etc.) instead
  // of silently changing them. This is JSON fidelity, not candidate validation.
  if (!isDeepStrictEqual(JSON.parse(serialized), transport)) {
    throw new Error("Manual SOD analysis must contain losslessly serializable JSON values.");
  }
  return serialized;
}

export function writeManualSodAnalysis(input, analysisDate, outputDirectory) {
  // An explicit calendar date avoids clock/timezone-dependent filenames. It
  // labels the transport only and never rewrites authored dates or timestamps.
  if (typeof analysisDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(analysisDate)
    || !Number.isFinite(Date.parse(`${analysisDate}T00:00:00Z`))
    || new Date(`${analysisDate}T00:00:00Z`).toISOString().slice(0, 10) !== analysisDate) {
    throw new Error("Manual SOD analysis date must be a valid YYYY-MM-DD calendar date.");
  }
  const serialized = serializeManualSodAnalysis(input);
  const output = path.join(path.resolve(outputDirectory), `manual-sod-analysis-${analysisDate}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, { flag: "wx" });
  return output;
}

function cli() {
  const [inputPath, analysisDate, outputDirectory, ...extra] = process.argv.slice(2);
  if (!inputPath || !analysisDate || outputDirectory === "" || extra.length || inputPath.startsWith("--")) {
    console.error("Usage: node schwab-bridge/manual-sod-analysis.mjs <authored-sod.json> <YYYY-MM-DD> [output-directory]");
    process.exitCode = 2;
    return;
  }
  try {
    const input = JSON.parse(fs.readFileSync(path.resolve(expandManualPath(inputPath)), "utf8"));
    const analysisPath = outputDirectory === undefined
      ? writeDefaultManualTransport(serializeManualSodAnalysis(input), "sod", analysisDate)
      : writeManualSodAnalysis(input, analysisDate, expandManualPath(outputDirectory));
    console.log(JSON.stringify({ analysisPath }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) cli();
