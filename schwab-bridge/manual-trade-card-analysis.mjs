import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { expandManualPath, writeDefaultManualTransport } from "./manual-output-paths.mjs";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

// Transport only. HTML is authored upstream and kept verbatim, including styling.
// This module deliberately has no candidate contract, renderer, or service imports.
export function standaloneTradeCardHtml(artifactContent) {
  if (!isObject(artifactContent) || typeof artifactContent.html !== "string" || !artifactContent.html.trim()) {
    throw new Error("Manual trade-card artifactContent.html must contain the authored standalone HTML.");
  }
  return artifactContent.html;
}

export function serializeManualTradeCardAnalysis(input) {
  if (!isObject(input)) throw new Error("Manual trade-card analysis must be an object.");
  const { artifactContent, candidateProposals, bundleMetadata = null } = input;
  standaloneTradeCardHtml(artifactContent);
  if (!Array.isArray(candidateProposals) || candidateProposals.length !== 1 || !isObject(candidateProposals[0])) {
    throw new Error("Manual trade-card transport requires exactly one candidate proposal object.");
  }
  if (bundleMetadata !== null && !isObject(bundleMetadata)) {
    throw new Error("Manual trade-card bundleMetadata must be an object or null.");
  }
  const transport = { artifactContent, candidateProposals, bundleMetadata };
  const serialized = `${JSON.stringify(transport, null, 2)}\n`;
  if (!isDeepStrictEqual(JSON.parse(serialized), transport)) {
    throw new Error("Manual trade-card analysis must contain losslessly serializable JSON values.");
  }
  return serialized;
}

export function writeManualTradeCardAnalysis(input, analysisDate, symbol, outputDirectory) {
  if (typeof analysisDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(analysisDate)
    || !Number.isFinite(Date.parse(`${analysisDate}T00:00:00Z`))
    || new Date(`${analysisDate}T00:00:00Z`).toISOString().slice(0, 10) !== analysisDate) {
    throw new Error("Manual trade-card analysis date must be a valid YYYY-MM-DD calendar date.");
  }
  // Filename labels only: never infer or rewrite candidate dates/symbols.
  if (typeof symbol !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)) {
    throw new Error("Manual trade-card filename symbol must be 1–32 uppercase letters, digits, dots, underscores or hyphens, starting with a letter or digit.");
  }
  const serialized = serializeManualTradeCardAnalysis(input);
  const output = path.join(path.resolve(outputDirectory), `manual-trade-card-analysis-${analysisDate}-${symbol}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized, { flag: "wx" });
  return output;
}

function cli() {
  const [inputPath, analysisDate, symbol, outputDirectory, ...extra] = process.argv.slice(2);
  if (!inputPath || !analysisDate || !symbol || outputDirectory === "" || extra.length || inputPath.startsWith("--")) {
    console.error("Usage: node schwab-bridge/manual-trade-card-analysis.mjs <authored-trade-card.json> <YYYY-MM-DD> <SYMBOL> [fresh-transport-directory]");
    process.exitCode = 2;
    return;
  }
  try {
    const input = JSON.parse(fs.readFileSync(path.resolve(expandManualPath(inputPath)), "utf8"));
    const analysisPath = outputDirectory === undefined
      ? writeDefaultManualTransport(serializeManualTradeCardAnalysis(input), "trade-card", analysisDate, symbol)
      : writeManualTradeCardAnalysis(input, analysisDate, symbol, expandManualPath(outputDirectory));
    console.log(JSON.stringify({ analysisPath }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) cli();
