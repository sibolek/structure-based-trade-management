import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expandManualPath, defaultManualPackageDirectory } from "./manual-output-paths.mjs";
import { serializeManualTradeCardAnalysis, standaloneTradeCardHtml } from "./manual-trade-card-analysis.mjs";

const withheld = (reason, message, error) => ({
  status: "WITHHELD", reason, message: `ExecutionOS candidate JSON withheld: ${message}`, files: [],
  ...(error ? { diagnostic: error.message ?? String(error) } : {}),
});

async function deliverCandidate(input, output) {
  try {
    // Transport cardinality and JSON fidelity only; never a second candidate schema.
    serializeManualTradeCardAnalysis(input);
  } catch (error) {
    return withheld("CANDIDATE_INPUT_INVALID", "exactly one lossless candidate proposal and valid transport metadata are required.", error);
  }
  if (input.bundleMetadata == null) {
    return withheld("CANDIDATE_INPUT_UNAVAILABLE", "canonical bundle metadata was not supplied.");
  }
  let writeCandidates;
  try {
    // Load the installed, current manual delivery path only after HTML is complete.
    const delivery = await import("./manual-sod-deliverables.mjs");
    writeCandidates = delivery.writeManualSodIndividualCandidateFiles;
    if (typeof writeCandidates !== "function") throw new Error("Current local manual delivery gate is unavailable.");
  } catch (error) {
    return withheld("VALIDATOR_UNAVAILABLE", "current local canonical validator is unavailable.", error);
  }

  let staging;
  let result;
  let phase = "write";
  try {
    staging = fs.mkdtempSync(path.join(path.dirname(output), ".manual-trade-card-candidate-"));
    phase = "validate";
    const files = writeCandidates({ ...input.bundleMetadata, candidates: input.candidateProposals }, path.join(staging, "individual-candidates"));
    if (files.length !== 1) throw new Error("Current manual delivery gate must produce exactly one candidate file.");
    phase = "write";
    const candidatePath = path.join(output, path.basename(files[0]));
    // Only a complete file that passed the existing exact-serialization gate is public.
    fs.renameSync(files[0], candidatePath);
    result = {
      status: "DELIVERED", reason: "CURRENT_LOCAL_VALIDATOR_PASSED",
      message: "ExecutionOS candidate JSON delivered: one file passed the current local canonical validator. Preview and explicit Import remain required.",
      files: [candidatePath],
    };
  } catch (error) {
    const validationFailed = phase === "validate" && !error.syscall && error.errno === undefined;
    result = withheld(validationFailed ? "VALIDATION_FAILED" : "DELIVERY_FAILED",
      validationFailed ? "candidate validation failed; no candidate was delivered." : "candidate file delivery failed; no candidate was delivered.", error);
  } finally {
    if (staging) {
      try { fs.rmSync(staging, { recursive: true, force: true }); }
      catch (error) { result.cleanupDiagnostic = `Private candidate staging cleanup failed: ${error.message}`; }
    }
  }
  return result;
}

// Ad-hoc manual packaging only. Never starts services, imports candidates, or analyzes charts.
export async function writeManualTradeCardPackage(input = {}, outputDirectory) {
  const html = standaloneTradeCardHtml(input?.artifactContent);
  const analysis = structuredClone(input);
  const output = path.resolve(outputDirectory);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output); // Reject even an empty previous package; no stale candidates.
  const htmlPath = path.join(output, "trade-card.html");
  const candidateDeliveryStatusPath = path.join(output, "candidate-delivery-status.json");
  fs.writeFileSync(htmlPath, html, { flag: "wx" });
  fs.writeFileSync(candidateDeliveryStatusPath, `${JSON.stringify({
    status: "PENDING", message: "Candidate delivery is incomplete; no candidate is ready for Import.", files: [],
  }, null, 2)}\n`, { flag: "wx" });
  const candidateDelivery = await deliverCandidate(analysis, output);
  try {
    fs.writeFileSync(candidateDeliveryStatusPath, `${JSON.stringify(candidateDelivery, null, 2)}\n`);
  } catch (error) {
    // A package cannot claim successful delivery without its status artifact.
    for (const file of candidateDelivery.files) fs.rmSync(file, { force: true });
    throw error;
  }
  return { htmlPath, candidateDelivery, candidateDeliveryStatusPath };
}

async function cli() {
  const [inputPath, outputDirectory, ...extra] = process.argv.slice(2);
  if (!inputPath || outputDirectory === "" || extra.length || inputPath.startsWith("--")) {
    console.error("Usage: node schwab-bridge/manual-trade-card-package.mjs <manual-trade-card-analysis.json> [fresh-package-directory]");
    process.exitCode = 2;
    return;
  }
  try {
    const output = outputDirectory === undefined ? defaultManualPackageDirectory("trade-card", inputPath) : expandManualPath(outputDirectory);
    const input = JSON.parse(fs.readFileSync(path.resolve(expandManualPath(inputPath)), "utf8"));
    console.log(JSON.stringify(await writeManualTradeCardPackage(input, output), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await cli();
