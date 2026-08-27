import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const STUDY_PATH = path.join(HERE, "historical-study-trades.json");
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".vite"]);
const DATA_EXTS = new Set([".csv", ".json", ".jsonl", ".ndjson", ".parquet", ".feather"]);
const NAME_HINT = /(market|price|bar|ohlc|minute|1m|sip|candle|quote|history)/i;
const KNOWN_NON_MARKET = new Set([
  path.join(HERE, "raw-schwab-history.json"),
  path.join(HERE, "normalized-trades.json"),
  path.join(HERE, "historical-study-trades.json"),
  path.join(HERE, "expected-results.json"),
]);

function humanBytes(n) {
  if (!Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function firstLine(file, bytes = 64 * 1024) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const stat = fs.fstatSync(fd);
    const size = Math.min(bytes, stat.size);
    const buf = Buffer.alloc(size);
    fs.readSync(fd, buf, 0, size, 0);
    const text = buf.toString("utf8");
    return text.split(/\r?\n/, 1)[0] || "";
  } catch {
    return "";
  } finally {
    if (fd != null) try { fs.closeSync(fd); } catch {}
  }
}

function headerSignals(line) {
  const lower = String(line || "").toLowerCase();
  const time = /(timestamp|datetime|date|time)/.test(lower);
  const symbol = /(symbol|ticker)/.test(lower);
  const ohlc = /\bopen\b/.test(lower) && /\bhigh\b/.test(lower) && /\blow\b/.test(lower) && /\bclose\b/.test(lower);
  const last = /\blast\b|\bprice\b/.test(lower);
  return { time, symbol, ohlc, last, score: [time, symbol, ohlc || last].filter(Boolean).length };
}

function auditStudyDataset() {
  if (!fs.existsSync(STUDY_PATH)) {
    return { exists: false, trades: 0, withMarketSamples: 0, samplePoints: 0, selectedMfe: 0, selectedCounterfactual: 0 };
  }
  try {
    const data = JSON.parse(fs.readFileSync(STUDY_PATH, "utf8"));
    const trades = Array.isArray(data?.trades) ? data.trades : [];
    return {
      exists: true,
      trades: trades.length,
      withMarketSamples: trades.filter((t) => Array.isArray(t?.marketSamples) && t.marketSamples.length).length,
      samplePoints: trades.reduce((sum, t) => sum + (Array.isArray(t?.marketSamples) ? t.marketSamples.length : 0), 0),
      selectedMfe: trades.filter((t) => t?.includeInMfeStudy === true).length,
      selectedCounterfactual: trades.filter((t) => t?.includeInCounterfactualStudy === true).length,
    };
  } catch (error) {
    return { exists: true, error: error.message };
  }
}

const allFiles = walk(REPO);
const candidates = allFiles
  .filter((file) => DATA_EXTS.has(path.extname(file).toLowerCase()))
  .filter((file) => !KNOWN_NON_MARKET.has(file))
  .map((file) => {
    const stat = fs.statSync(file);
    const line = [".csv", ".jsonl", ".ndjson"].includes(path.extname(file).toLowerCase()) ? firstLine(file) : "";
    const signals = headerSignals(line);
    const hinted = NAME_HINT.test(path.basename(file));
    return {
      file,
      relative: path.relative(REPO, file),
      size: stat.size,
      hinted,
      signals,
      score: (hinted ? 2 : 0) + signals.score,
      firstLine: line.slice(0, 220),
    };
  })
  .filter((row) => row.score > 0)
  .sort((a, b) => b.score - a.score || b.size - a.size);

const study = auditStudyDataset();

console.log("ExecutionOS historical market-data audit");
console.log("================================================================================");
console.log(`Repository: ${REPO}`);
console.log("");
console.log("CURRENT ENRICHED STUDY DATASET");
console.log("================================================================================");
if (!study.exists) {
  console.log("historical-study-trades.json: not found");
} else if (study.error) {
  console.log(`historical-study-trades.json: unreadable (${study.error})`);
} else {
  console.log(`Trades:                          ${study.trades}`);
  console.log(`Trades with marketSamples:       ${study.withMarketSamples}`);
  console.log(`Attached market sample points:   ${study.samplePoints}`);
  console.log(`Explicit MFE-study selections:   ${study.selectedMfe}`);
  console.log(`Explicit counterfactual selects: ${study.selectedCounterfactual}`);
}

console.log("");
console.log("PLAUSIBLE LOCAL MARKET-DATA FILES");
console.log("================================================================================");
if (!candidates.length) {
  console.log("None found inside this repository.");
} else {
  for (const row of candidates.slice(0, 50)) {
    const tags = [
      row.hinted ? "name-hint" : null,
      row.signals.time ? "time" : null,
      row.signals.symbol ? "symbol" : null,
      row.signals.ohlc ? "OHLC" : null,
      row.signals.last ? "price" : null,
    ].filter(Boolean).join(",");
    console.log(`${row.relative}  ${humanBytes(row.size)}  [${tags || "weak"}]`);
    if (row.firstLine) console.log(`  header/sample: ${row.firstLine}`);
  }
}

console.log("");
console.log("NEXT DECISION");
console.log("================================================================================");
if (study.exists && !study.error && study.withMarketSamples > 0) {
  console.log("Market samples are already attached. Next: run the MFE/capture/counterfactual reports and compare with the preserved fingerprint.");
} else if (candidates.length) {
  console.log("Candidate local files exist. Next: inspect the highest-scoring file schema and build a deterministic importer; do not alter the analytics formulas yet.");
} else {
  console.log("No local market-bar source was found in the repository. Next: recover the original consolidated-SIP 1-minute source file/provider, or explicitly approve a permitted replacement source before rebuilding the remaining historical analytics.");
}
