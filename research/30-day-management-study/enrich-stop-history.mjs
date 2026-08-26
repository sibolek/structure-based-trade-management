import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { historicalStopEventsForTrade, productionStopEventsForTrade } from "../../analytics/stop-history.mjs";
import { recoverHistoricalInitialRisk } from "../../analytics/r-history.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW_PATH = path.join(HERE, "raw-schwab-history.json");
const NORMALIZED_PATH = path.join(HERE, "normalized-trades.json");
const OUTPUT_PATH = path.join(HERE, "historical-study-trades.json");
const START = Date.parse("2026-07-22T13:30:00.000Z"); // inferred 09:30 ET boundary
const END = Date.parse("2026-08-22T04:00:00.000Z");

function readJson(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Missing local research file: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writePrivateJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch { /* best effort */ }
}

const raw = readJson(RAW_PATH);
const normalized = readJson(NORMALIZED_PATH);
const snapshots = Array.isArray(raw.orderSnapshots) ? raw.orderSnapshots : [];

const trades = (normalized.trades || [])
  .filter((trade) => {
    const entry = Date.parse(trade?.entryAt || "");
    return Number.isFinite(entry) && entry >= START && entry < END;
  })
  .map((trade) => {
    const recoveredRisk = recoverHistoricalInitialRisk(trade, snapshots);
    return {
      ...trade,
      ...(recoveredRisk || {}),
      historicalManagementEvents: historicalStopEventsForTrade(trade, snapshots),
      managementEvents: productionStopEventsForTrade(trade, snapshots),
    };
  });

const output = {
  schemaVersion: 3,
  source: "Recovered ExecutionOS historical study population with strict Schwab stop-order linkage",
  generatedAt: new Date().toISOString(),
  historicalWindow: {
    start: "2026-07-22T13:30:00.000Z",
    endExclusive: "2026-08-22T04:00:00.000Z",
    boundaryNote: "09:30 ET start is inferred from the recovered benchmark, not directly preserved in the original specification.",
  },
  stopSemantics: {
    historicalManagementEvents: "Strict episode-linked submitted stop-order actions, including REJECTED submissions, for historical benchmark reproduction.",
    managementEvents: "Strict episode-linked accepted stop changes only; intended for production/broker-state semantics.",
  },
  rSemantics: {
    population: "First accepted closing stop observed in the episode must be loss-side relative to episode blended opening-fill VWAP.",
    denominator: "Absolute distance from episode entryVWAP to that stop multiplied by peak episode quantity.",
    note: "Historical-reproduction convention only; no one-trade special case is applied to force the preserved 54.2% loser threshold.",
  },
  trades,
};

writePrivateJson(OUTPUT_PATH, output);

const historicalBe = trades.filter((trade) => (trade.historicalManagementEvents || []).some((event) => event.classification === "BE_OR_PROFIT"));
const productionBe = trades.filter((trade) => (trade.managementEvents || []).some((event) => event.classification === "BE_OR_PROFIT"));
const recoveredRisk = trades.filter((trade) => Number.isFinite(Number(trade.initialRisk)) && Number(trade.initialRisk) > 0);

console.log("ExecutionOS historical stop + R enrichment");
console.log("================================================================================");
console.log(`Historical study trades:      ${trades.length}`);
console.log(`Historical BE/profit actions: ${historicalBe.length}`);
console.log(`Production accepted BE moves: ${productionBe.length}`);
console.log(`Recovered initial-risk trades:${String(recoveredRisk.length).padStart(4)}`);
console.log(`Output:                       ${OUTPUT_PATH}`);
