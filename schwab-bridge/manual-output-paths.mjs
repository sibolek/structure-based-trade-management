import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Manual CLI convenience only; no candidate, renderer, runtime or service imports.
export function expandManualPath(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  if (value.startsWith("~")) throw new Error("Use ~ or ~/ for the current user's home, not ~user paths.");
  return value;
}

export function manualOutputPaths(kind, date, symbol) {
  if (!["sod", "trade-card"].includes(kind)) throw new Error("Unknown manual package kind.");
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Default output requires a valid YYYY-MM-DD calendar date.");
  }
  if (kind === "trade-card" && typeof symbol === "string" && /-TRANSPORT$/i.test(symbol)) {
    throw new Error("The -TRANSPORT suffix (case-insensitive) is reserved for transport-directory naming in default trade-card paths. Supply an explicit output directory.");
  }
  if (kind === "trade-card" && (typeof symbol !== "string" || !/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol))) {
    throw new Error("Default trade-card output requires a safe uppercase filename symbol (1–32 characters).");
  }
  const downloads = path.join(os.homedir(), "Downloads");
  try {
    if (!fs.statSync(downloads).isDirectory()) throw new Error("not a directory");
    fs.accessSync(downloads, fs.constants.W_OK | fs.constants.X_OK);
  } catch (error) {
    throw new Error(`Default Downloads destination unavailable at ${downloads}: ${error.message}. Supply an explicit output directory.`, { cause: error });
  }
  const root = path.join(downloads, "ExecutionOS");
  const packageDirectory = kind === "sod"
    ? path.join(root, "SOD", date)
    : path.join(root, "TradeCards", date, symbol);
  // Siblings keep transport creation outside both existing and future packages.
  const transportDirectory = `${packageDirectory}-transport`;
  const filename = kind === "sod" ? `manual-sod-analysis-${date}.json` : `manual-trade-card-analysis-${date}-${symbol}.json`;
  return { packageDirectory, transportDirectory, analysisPath: path.join(transportDirectory, filename) };
}

export function defaultManualPackageDirectory(kind, inputPath) {
  const filename = path.basename(inputPath);
  const match = kind === "sod"
    ? /^manual-sod-analysis-(\d{4}-\d{2}-\d{2})\.json$/.exec(filename)
    : /^manual-trade-card-analysis-(\d{4}-\d{2}-\d{2})-([A-Za-z0-9][A-Za-z0-9._-]{0,31})\.json$/.exec(filename);
  if (!match) throw new Error(`Cannot infer default ${kind} destination from ${filename}. Use the standard dated transport filename or supply an explicit output directory.`);
  // Keep symbol case for the reserved-suffix error; manualOutputPaths still requires uppercase labels.
  // Filename labels only: never inspect, normalize or validate candidate substance.
  return manualOutputPaths(kind, match[1], match[2]).packageDirectory;
}

export function writeDefaultManualTransport(serialized, kind, date, symbol) {
  const { transportDirectory, analysisPath } = manualOutputPaths(kind, date, symbol);
  fs.mkdirSync(path.dirname(transportDirectory), { recursive: true });
  fs.mkdirSync(transportDirectory); // Refuse even empty directories and symlinks.
  fs.writeFileSync(analysisPath, serialized, { flag: "wx" });
  return analysisPath;
}
