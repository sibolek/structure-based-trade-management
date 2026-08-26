import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateMfeWindows,
  computeLegacyWindowExcursions,
  summarizeCapture,
  summarizeDurations,
  summarizeFixedDuration,
  summarizeHistoricalStopActions,
  summarizeRMultiples,
  summarizeStopMovements,
} from "../../analytics/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(HERE, "normalized-trades.json");
const EXPECTED_PATH = path.join(HERE, "expected-results.json");
const WINDOWS = [300, 600, 900, 1800, 3600];

function parseArgs(argv) {
  const args = { input: DEFAULT_INPUT, section: "all" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" && argv[i + 1]) args.input = path.resolve(argv[++i]);
    else if (argv[i] === "--section" && argv[i + 1]) args.section = String(argv[++i]).toLowerCase();
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function selectedStudyTrades(trades, flag) {
  const explicitlySelected = trades.filter((trade) => trade?.[flag] === true);
  return explicitlySelected.length ? explicitlySelected : trades;
}

function buildMfeReport(trades) {
  const sample = selectedStudyTrades(trades, "includeInMfeStudy").filter((trade) => Array.isArray(trade.marketSamples) && trade.marketSamples.length);
  const rows = sample.map((trade) => ({
    id: trade.id,
    realizedPnl: Number(trade.realizedPnl ?? trade.realizedGrossPnl),
    excursions: computeLegacyWindowExcursions(trade, trade.marketSamples, WINDOWS),
  }));
  const aggregateMfe = aggregateMfeWindows(rows, WINDOWS);
  const captureByWindow = {};
  for (const windowSec of WINDOWS) {
    captureByWindow[windowSec] = summarizeCapture(rows.map((row) => ({
      realizedPnl: row.realizedPnl,
      mfeDollars: row.excursions?.[windowSec]?.mfeDollars,
    })));
  }
  return { trades: rows.length, aggregateMfe, captureByWindow };
}

function buildCounterfactualReport(trades) {
  const sample = selectedStudyTrades(trades, "includeInCounterfactualStudy").filter((trade) => Array.isArray(trade.marketSamples) && trade.marketSamples.length);
  return {
    hold209Sec: summarizeFixedDuration(sample, 209),
    hold842Sec: summarizeFixedDuration(sample, 842),
  };
}

function buildReport(dataset) {
  const trades = Array.isArray(dataset?.trades) ? dataset.trades : [];
  const mfe = buildMfeReport(trades);
  const hasHistoricalStopEvents = trades.some((trade) => Array.isArray(trade?.historicalManagementEvents));
  const historicalStopActionCount = trades.reduce(
    (sum, trade) => sum + (Array.isArray(trade?.historicalManagementEvents) ? trade.historicalManagementEvents.length : 0),
    0,
  );
  const productionStopEventCount = trades.reduce(
    (sum, trade) => sum + (Array.isArray(trade?.managementEvents) ? trade.managementEvents.length : 0),
    0,
  );

  return {
    metadata: {
      source: dataset?.source || "normalized ExecutionOS trade dataset",
      generatedAt: new Date().toISOString(),
      trades: trades.length,
      historicalStopActionCount,
      productionStopEventCount,
    },
    duration: summarizeDurations(trades),
    stops: hasHistoricalStopEvents
      ? summarizeHistoricalStopActions(trades)
      : summarizeStopMovements(trades),
    stopsProduction: hasHistoricalStopEvents
      ? summarizeStopMovements(trades, { mode: "BE_OR_PROFIT", eventField: "managementEvents" })
      : null,
    r: summarizeRMultiples(trades),
    mfe,
    capture: mfe.captureByWindow,
    counterfactuals: buildCounterfactualReport(trades),
  };
}

function printBenchmarkOnly(expected, inputPath) {
  console.log("ExecutionOS analytics preservation mode");
  console.log(`No normalized study dataset found at: ${inputPath}`);
  console.log("The analytical modules and historical numerical fingerprint are installed, but source trades will not be fabricated.");
  console.log("\nHistorical benchmark:\n");
  console.log(JSON.stringify(expected, null, 2));
  console.log("\nTo run against recovered/reconstructed source data:");
  console.log("  npm run analytics:report -- --input /path/to/normalized-trades.json");
}

const args = parseArgs(process.argv.slice(2));
const expected = readJson(EXPECTED_PATH);

if (!fs.existsSync(args.input)) {
  printBenchmarkOnly(expected, args.input);
  process.exit(0);
}

const dataset = readJson(args.input);
const report = buildReport(dataset);
if (args.section === "all" || args.section === "report") console.log(JSON.stringify({ report, historicalBenchmark: expected }, null, 2));
else if (Object.hasOwn(report, args.section)) console.log(JSON.stringify(report[args.section], null, 2));
else {
  console.error(`Unknown section: ${args.section}`);
  console.error("Valid sections: duration, stops, stopsProduction, r, mfe, capture, counterfactuals, all");
  process.exit(1);
}
