import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expandManualPath, defaultManualPackageDirectory } from "./manual-output-paths.mjs";
import { SOD_REPORT_SECTIONS } from "./sod-artifact-content.mjs";
import { renderSodArtifacts } from "./sod-artifact-renderer.mjs";

// Manual-package compatibility only. Repair superficial report-shape aliases
// without ever rewriting candidate proposals or conferring trade authority.
const SECTION_ID_ALIASES = Object.freeze({
  "macro-context": "macro-overnight-context",
  "market-regime": "market-regime-breadth",
  semiconductors: "semiconductors-primary-sector",
  "software-ai": "mega-cap-tech",
  "momentum-special": "momentum-special-situations",
  "crude-oil": "crude-oil-mcl",
});

function text(value) {
  return String(value ?? "").trim();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalizeReportBlock(block) {
  if (!isObject(block)) return structuredClone(block);
  const result = structuredClone(block);
  const type = text(result.type).toLowerCase();

  if (type === "bullets") {
    result.type = "list";
    result.style = text(result.style).toLowerCase() || "bullet";
    if (!Array.isArray(result.items) && Array.isArray(result.listItems)) result.items = result.listItems;
  } else if (type === "list") {
    if (!Array.isArray(result.items) && Array.isArray(result.listItems)) result.items = result.listItems;
  } else if (type === "metrics") {
    if (!Array.isArray(result.items) && Array.isArray(result.metricItems)) result.items = result.metricItems;
  }

  return result;
}

export function canonicalizeManualSodArtifactContent(input) {
  if (!isObject(input)) return structuredClone(input);
  const content = structuredClone(input);
  if (!Array.isArray(content.sections)) return content;

  content.sections = content.sections.map((section, index) => {
    if (!isObject(section)) return section;
    const expected = SOD_REPORT_SECTIONS[index];
    const actualId = text(section.id);
    const aliasedId = SECTION_ID_ALIASES[actualId] ?? actualId;

    // Only a known alias that resolves to the section expected at this exact
    // position is repaired. Wrong order and unknown IDs remain strict errors.
    if (expected && aliasedId === expected.id) section.id = expected.id;
    if (Array.isArray(section.blocks)) section.blocks = section.blocks.map(canonicalizeReportBlock);
    return section;
  });

  return content;
}

// Reporting has no static dependency on the ExecutionOS candidate contract.
// Only this optional downstream step may load the current local delivery gate.
async function deliverCandidates(candidateProposals, bundleMetadata, outputDirectory) {
  const withheld = (reason, message, error) => ({
    status: "WITHHELD", reason, message, files: [],
    ...(error ? { diagnostic: error.message ?? String(error) } : {}),
  });
  if (candidateProposals.length === 0) {
    return { status: "NO_CANDIDATES", reason: "NO_A_PLUS_TRADES", message: "No A+ trades supplied; no ExecutionOS candidate JSON to deliver.", files: [] };
  }
  if (bundleMetadata == null) {
    return withheld("CANDIDATE_INPUT_UNAVAILABLE", "ExecutionOS candidate JSON withheld: canonical bundle metadata was not supplied.");
  }
  let writeCandidates;
  try {
    const delivery = await import("./manual-sod-deliverables.mjs");
    writeCandidates = delivery.writeManualSodIndividualCandidateFiles;
    if (typeof writeCandidates !== "function") throw new Error("Current local manual SOD delivery gate is unavailable.");
  } catch (error) {
    return withheld("VALIDATOR_UNAVAILABLE", "ExecutionOS candidate JSON withheld: current local canonical validator is unavailable.", error);
  }

  let staging;
  let result;
  let phase = "write";
  try {
    staging = fs.mkdtempSync(path.join(path.dirname(outputDirectory), ".manual-sod-candidates-"));
    const stagedDirectory = path.join(staging, "individual-candidates");
    // One source of trade substance for both reports and candidate delivery.
    // The existing writer validates all exact serialized files, preserves the
    // authored candidates, and rejects any authority/policy conversion.
    phase = "validate";
    const files = writeCandidates({ ...bundleMetadata, candidates: candidateProposals }, stagedDirectory);
    phase = "write";
    const finalDirectory = path.join(outputDirectory, "individual-candidates");
    fs.renameSync(stagedDirectory, finalDirectory);
    result = {
      status: "DELIVERED", reason: "CURRENT_LOCAL_VALIDATOR_PASSED",
      message: `ExecutionOS candidate JSON delivered: all ${files.length} file(s) passed the current local canonical validator. Preview and explicit Import remain required.`,
      files: files.map(file => path.join(finalDirectory, path.basename(file))),
    };
  } catch (error) {
    // Filesystem errors have syscall/errno; validator diagnostics do not.
    const validationFailed = phase === "validate" && !error.syscall && error.errno === undefined;
    result = withheld(validationFailed ? "VALIDATION_FAILED" : "DELIVERY_FAILED",
      validationFailed
        ? "ExecutionOS candidate JSON withheld: candidate validation failed; the entire candidate package was withheld. See candidate-delivery-status.json for details."
        : "ExecutionOS candidate JSON withheld: candidate file delivery failed. See candidate-delivery-status.json for details.", error);
  } finally {
    if (staging) {
      try { fs.rmSync(staging, { recursive: true, force: true }); }
      catch (error) {
        result.cleanupDiagnostic = `Private candidate staging cleanup failed: ${error.message}`;
      }
    }
  }
  return result;
}

// Manual reporting entry point only; never used by automated Production SOD.
// Requires a fresh output directory so stale candidates cannot masquerade as
// this run's deliverables. Invalid report content and report I/O still fail.
export async function writeManualSodPackage({ artifactContent, candidateProposals = [], bundleMetadata } = {}, outputDirectory) {
  if (!Array.isArray(candidateProposals)) throw new Error("Manual SOD candidateProposals must be an array of trade ideas.");
  const input = structuredClone({ artifactContent, candidateProposals, bundleMetadata });
  // Repair only known presentation/report-shape aliases from manual/chat-authored
  // transport. Candidate proposals remain byte-for-byte authored input and still
  // pass through the current canonical ExecutionOS delivery validator unchanged.
  input.artifactContent = canonicalizeManualSodArtifactContent(input.artifactContent);
  const output = path.resolve(outputDirectory);
  const pending = { status: "PENDING", message: "ExecutionOS candidate delivery pending; no candidate JSON has been delivered.", files: [] };
  const render = delivery => renderSodArtifacts({
    content: {
      ...input.artifactContent,
      hero: {
        ...input.artifactContent?.hero,
        badges: [
          ...(Array.isArray(input.artifactContent?.hero?.badges) ? input.artifactContent.hero.badges : []),
          { tone: delivery.status === "DELIVERED" ? "green" : "amber", text: delivery.message },
        ],
      },
    },
    candidateProposals: input.candidateProposals,
  });
  const rendered = render(pending);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.mkdirSync(output); // EEXIST is intentional, including an empty prior run.
  const report = { markdownPath: path.join(output, "report.md"), htmlPath: path.join(output, "report.html") };
  const dashboard = { htmlPath: path.join(output, "dashboard.html") };
  const writeReports = artifacts => {
    fs.writeFileSync(report.markdownPath, artifacts.report.markdown);
    fs.writeFileSync(report.htmlPath, artifacts.report.html);
    fs.writeFileSync(dashboard.htmlPath, artifacts.dashboard.html);
  };
  // Finish the reports before attempting to load any ExecutionOS contract code.
  writeReports(rendered);
  const candidateDelivery = await deliverCandidates(input.candidateProposals, input.bundleMetadata, output);
  const candidateDeliveryStatusPath = path.join(output, "candidate-delivery-status.json");
  fs.writeFileSync(candidateDeliveryStatusPath, `${JSON.stringify(candidateDelivery, null, 2)}\n`, { flag: "wx" });
  writeReports(render(candidateDelivery));
  return { report, dashboard, candidateDelivery, candidateDeliveryStatusPath };
}

async function cli() {
  const [inputPath, outputDirectory, ...extra] = process.argv.slice(2);
  if (!inputPath || outputDirectory === "" || extra.length || inputPath.startsWith("--")) {
    console.error("Usage: node schwab-bridge/manual-sod-package.mjs <manual-sod-analysis.json> [fresh-package-directory]");
    process.exitCode = 2;
    return;
  }
  try {
    const output = outputDirectory === undefined ? defaultManualPackageDirectory("sod", inputPath) : expandManualPath(outputDirectory);
    const input = JSON.parse(fs.readFileSync(path.resolve(expandManualPath(inputPath)), "utf8"));
    const result = await writeManualSodPackage(input, output);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await cli();
