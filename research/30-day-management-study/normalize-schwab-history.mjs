import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reconstructSameDayEpisodes } from "../../analytics/trade-episodes.mjs";
import { summarizeDurations } from "../../analytics/execution-metrics.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = path.join(HERE, "raw-schwab-history.json");
const DEFAULT_OUTPUT = path.join(HERE, "normalized-trades.json");

function parseArgs(argv) {
  const args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    timeZone: "America/New_York",
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" && argv[i + 1]) args.input = path.resolve(argv[++i]);
    else if (argv[i] === "--output" && argv[i + 1]) args.output = path.resolve(argv[++i]);
    else if (argv[i] === "--time-zone" && argv[i + 1]) args.timeZone = String(argv[++i]);
  }
  return args;
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Input file not found: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
}

const args = parseArgs(process.argv.slice(2));
const raw = readJson(args.input);
const result = reconstructSameDayEpisodes(raw.executionLegs || [], { timeZone: args.timeZone });
const duration = summarizeDurations(result.trades);

const output = {
  schemaVersion: 1,
  source: "Schwab 30-day history reconstructed into flat-to-flat same-day equity episodes",
  generatedAt: new Date().toISOString(),
  timeZone: args.timeZone,
  sourceMetadata: {
    sourceGeneratedAt: raw.generatedAt || null,
    lookbackDays: raw.lookbackDays || null,
    sourceExecutionLegs: Array.isArray(raw.executionLegs) ? raw.executionLegs.length : 0,
    sourceOrderSnapshots: Array.isArray(raw.orderSnapshots) ? raw.orderSnapshots.length : 0,
    sourceTradeTransactions: Array.isArray(raw.tradeTransactions) ? raw.tradeTransactions.length : 0,
  },
  reconstructionDiagnostics: result.diagnostics,
  trades: result.trades,
};

writePrivateJson(args.output, output);

console.log("ExecutionOS 30-day Schwab normalization");
console.log("================================================================================");
console.log(`Input execution legs:        ${result.diagnostics.inputExecutionLegs}`);
console.log(`Eligible equity legs:        ${result.diagnostics.eligibleExecutionLegs}`);
console.log(`Carry-in closures ignored:   ${result.diagnostics.carryInClosuresIgnored}`);
console.log(`Incomplete episodes ignored: ${result.diagnostics.incompleteEpisodesIgnored}`);
console.log(`Completed same-day episodes: ${duration.completedTrades}`);
console.log(`Winners / losers / flat:     ${duration.winners} / ${duration.losers} / ${duration.flat}`);
console.log(`Win rate:                     ${duration.winRate == null ? "—" : `${(duration.winRate * 100).toFixed(2)}%`}`);
console.log(`Median winner hold:           ${duration.winner.medianMinutes == null ? "—" : `${duration.winner.medianMinutes.toFixed(3)} min`}`);
console.log(`Median loser hold:            ${duration.loser.medianMinutes == null ? "—" : `${duration.loser.medianMinutes.toFixed(3)} min`}`);
console.log(`Mean winner hold:             ${duration.winner.meanMinutes == null ? "—" : `${duration.winner.meanMinutes.toFixed(3)} min`}`);
console.log(`Mean loser hold:              ${duration.loser.meanMinutes == null ? "—" : `${duration.loser.meanMinutes.toFixed(3)} min`}`);
console.log(`Normalized output:            ${args.output}`);
console.log("\nHistorical duration benchmark: 384 trades; 265 / 118 / 1; median winner 1.35m; median loser 3.49m; mean winner 5.04m; mean loser 14.03m.");
