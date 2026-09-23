import fsConstants from "node:constants";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateManualSodIndividualCandidateJson } from "./manual-sod-deliverables.mjs";
import { parseCandidateJson } from "../src/pretrade/manual-candidate-import.js";

export const DEFAULT_MANUAL_SOD_ROOT = path.join(os.homedir(), "Downloads", "ExecutionOS", "SOD");
export const MAX_MANUAL_SOD_CANDIDATES = 100;
export const MAX_MANUAL_SOD_CANDIDATE_BYTES = 768 * 1024;
const MAX_MANUAL_SOD_STATUS_BYTES = 256 * 1024;
const MAX_MANUAL_SOD_TOTAL_BYTES = 8 * 1024 * 1024;

function directoryError(message, code, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function validSourceDate(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readRegularFile(filePath, { maxBytes, invalidCode, label }) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile()) throw directoryError(`${label} must be a regular file.`, invalidCode);
    if (before.size <= 0 || before.size > maxBytes) {
      throw directoryError(`${label} exceeds its allowed size or is empty.`, invalidCode);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw directoryError(`${label} changed while it was being read.`, "MANUAL_SOD_PACKAGE_CHANGED");
    }
    return bytes.toString("utf8");
  } catch (error) {
    if (error?.code === "ELOOP") throw directoryError(`${label} may not be a symbolic link.`, invalidCode, error);
    if (error?.code?.startsWith?.("MANUAL_SOD_")) throw error;
    throw directoryError(`${label} could not be read.`, invalidCode, error);
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function requireDirectory(directoryPath, { missingCode, invalidCode, label }) {
  let stat;
  try {
    stat = await fs.lstat(directoryPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw directoryError(`${label} was not found.`, missingCode, error);
    throw directoryError(`${label} is unavailable.`, invalidCode, error);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw directoryError(`${label} must be a real directory, not a link.`, invalidCode);
  }
}

function parseStatus(raw) {
  let status;
  try {
    status = parseCandidateJson(raw);
  } catch (error) {
    throw directoryError("The SOD candidate delivery status is not valid JSON.", "MANUAL_SOD_STATUS_INVALID", error);
  }
  if (!plainObject(status)
    || !["DELIVERED", "NO_CANDIDATES", "WITHHELD"].includes(status.status)
    || typeof status.reason !== "string"
    || typeof status.message !== "string"
    || !Array.isArray(status.files)
    || status.files.some((value) => typeof value !== "string" || !value.trim())) {
    throw directoryError("The SOD candidate delivery status is invalid.", "MANUAL_SOD_STATUS_INVALID");
  }
  return status;
}

function sorted(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export async function readManualSodCandidatePackage({
  rootPath = DEFAULT_MANUAL_SOD_ROOT,
  sourceDate,
} = {}) {
  if (!validSourceDate(sourceDate)) {
    throw directoryError("A valid SOD source date in YYYY-MM-DD format is required.", "MANUAL_SOD_SOURCE_DATE_INVALID");
  }
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    throw directoryError("The manual SOD root is not configured.", "MANUAL_SOD_ROOT_INVALID");
  }

  const root = path.resolve(rootPath);
  const packageDirectory = path.join(root, sourceDate);
  const candidateDirectory = path.join(packageDirectory, "individual-candidates");
  const statusPath = path.join(packageDirectory, "candidate-delivery-status.json");

  await requireDirectory(root, {
    missingCode: "MANUAL_SOD_ROOT_NOT_FOUND",
    invalidCode: "MANUAL_SOD_ROOT_INVALID",
    label: "The configured manual SOD root",
  });
  await requireDirectory(packageDirectory, {
    missingCode: "MANUAL_SOD_PACKAGE_NOT_FOUND",
    invalidCode: "MANUAL_SOD_PACKAGE_INVALID",
    label: `The ${sourceDate} SOD package`,
  });

  const status = parseStatus(await readRegularFile(statusPath, {
    maxBytes: MAX_MANUAL_SOD_STATUS_BYTES,
    invalidCode: "MANUAL_SOD_STATUS_INVALID",
    label: "The SOD candidate delivery status",
  }));

  if (status.status !== "DELIVERED") {
    if (status.files.length) {
      throw directoryError("A non-delivered SOD package may not name candidate files.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
    }
    try {
      await requireDirectory(candidateDirectory, {
        missingCode: "MANUAL_SOD_CANDIDATE_DIRECTORY_NOT_FOUND",
        invalidCode: "MANUAL_SOD_CANDIDATE_DIRECTORY_INVALID",
        label: "The SOD individual-candidates directory",
      });
      const staleEntries = await fs.readdir(candidateDirectory);
      if (staleEntries.some((name) => name.toLowerCase().endsWith(".json"))) {
        throw directoryError("A non-delivered SOD package contains unexpected candidate JSON.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
      }
    } catch (error) {
      if (error?.code !== "MANUAL_SOD_CANDIDATE_DIRECTORY_NOT_FOUND") throw error;
    }
    return {
      sourceDate,
      packageDirectory,
      delivery: { status: status.status, reason: status.reason, message: status.message },
      candidates: [],
    };
  }

  await requireDirectory(candidateDirectory, {
    missingCode: "MANUAL_SOD_CANDIDATE_DIRECTORY_NOT_FOUND",
    invalidCode: "MANUAL_SOD_CANDIDATE_DIRECTORY_INVALID",
    label: "The SOD individual-candidates directory",
  });
  const entries = await fs.readdir(candidateDirectory, { withFileTypes: true });
  const jsonEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".json"));
  if (!jsonEntries.length || jsonEntries.length > MAX_MANUAL_SOD_CANDIDATES) {
    throw directoryError("The delivered SOD package has an invalid candidate-file count.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
  }
  if (jsonEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw directoryError("SOD candidate entries must be regular JSON files.", "MANUAL_SOD_CANDIDATE_FILE_INVALID");
  }

  const actualNames = sorted(jsonEntries.map((entry) => entry.name));
  const expectedNames = sorted(status.files.map((file) => path.basename(file)));
  if (new Set(expectedNames).size !== expectedNames.length
    || actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw directoryError("The candidate files do not match candidate-delivery-status.json.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
  }

  let totalBytes = 0;
  const identities = new Set();
  const candidates = [];
  for (const filename of actualNames) {
    const raw = await readRegularFile(path.join(candidateDirectory, filename), {
      maxBytes: MAX_MANUAL_SOD_CANDIDATE_BYTES,
      invalidCode: "MANUAL_SOD_CANDIDATE_FILE_INVALID",
      label: `SOD candidate file ${filename}`,
    });
    totalBytes += Buffer.byteLength(raw);
    if (totalBytes > MAX_MANUAL_SOD_TOTAL_BYTES) {
      throw directoryError("The SOD candidate package exceeds the total read limit.", "MANUAL_SOD_PACKAGE_TOO_LARGE");
    }

    let bundle;
    try {
      bundle = validateManualSodIndividualCandidateJson(raw);
    } catch (error) {
      throw directoryError(`SOD candidate file ${filename} failed current validation.`, "MANUAL_SOD_CANDIDATE_INVALID", error);
    }
    const candidate = bundle.candidates[0];
    if (bundle.sourceDate !== sourceDate || candidate.sourceDate !== sourceDate) {
      throw directoryError(`SOD candidate file ${filename} does not match the selected source date.`, "MANUAL_SOD_SOURCE_DATE_MISMATCH");
    }
    const identity = `${candidate.candidateId}\u0000${candidate.contractVersion}`;
    if (identities.has(identity)) {
      throw directoryError("The SOD package contains a duplicate candidate identity.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
    }
    identities.add(identity);
    candidates.push({ filename, byteLength: Buffer.byteLength(raw), raw });
  }

  return {
    sourceDate,
    packageDirectory,
    delivery: { status: status.status, reason: status.reason, message: status.message },
    candidates,
  };
}
