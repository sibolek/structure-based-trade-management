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

function parseStatus(raw, label = "candidate delivery status") {
  let status;
  try {
    status = parseCandidateJson(raw);
  } catch (error) {
    throw directoryError(`The ${label} is not valid JSON.`, "MANUAL_SOD_STATUS_INVALID", error);
  }
  if (!plainObject(status)
    || !["PENDING", "DELIVERED", "NO_CANDIDATES", "WITHHELD"].includes(status.status)
    || (status.status !== "PENDING" && typeof status.reason !== "string")
    || typeof status.message !== "string"
    || !Array.isArray(status.files)
    || status.files.some((value) => typeof value !== "string" || !value.trim())) {
    throw directoryError(`The ${label} is invalid.`, "MANUAL_SOD_STATUS_INVALID");
  }
  return status;
}

function sorted(values) {
  return [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

async function directoryKind(directoryPath) {
  try {
    const stat = await fs.lstat(directoryPath);
    if (stat.isSymbolicLink()) return "link";
    return stat.isDirectory() ? "directory" : "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

async function fileKind(filePath) {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isSymbolicLink()) return "link";
    return stat.isFile() ? "file" : "other";
  } catch (error) {
    if (error?.code === "ENOENT") return "missing";
    throw error;
  }
}

async function readCandidatePackage({ packageDirectory, sourceDate, sourceKind, packageId, allowIncomplete = false }) {
  const candidateDirectory = path.join(packageDirectory, "individual-candidates");
  const statusPath = path.join(packageDirectory, "candidate-delivery-status.json");
  await requireDirectory(packageDirectory, {
    missingCode: "MANUAL_SOD_PACKAGE_NOT_FOUND",
    invalidCode: "MANUAL_SOD_PACKAGE_INVALID",
    label: `The ${sourceKind.toLowerCase()} candidate package ${packageId}`,
  });

  if (await fileKind(statusPath) === "missing") {
    if (allowIncomplete) {
      return {
        sourceKind, packageId, packageDirectory,
        delivery: { status: "PENDING", reason: "DELIVERY_PENDING", message: "Candidate delivery is incomplete; no candidate is ready for Import." },
        candidates: [], totalBytes: 0,
      };
    }
    throw directoryError("The candidate delivery status was not found.", "MANUAL_SOD_STATUS_INVALID");
  }

  const status = parseStatus(await readRegularFile(statusPath, {
    maxBytes: MAX_MANUAL_SOD_STATUS_BYTES,
    invalidCode: "MANUAL_SOD_STATUS_INVALID",
    label: `The ${sourceKind.toLowerCase()} candidate delivery status`,
  }), `${sourceKind.toLowerCase()} candidate delivery status`);

  if (status.status === "PENDING") {
    if (!allowIncomplete || status.files.length) {
      throw directoryError("An incomplete candidate package is inconsistent.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
    }
    return {
      sourceKind, packageId, packageDirectory,
      delivery: { status: "PENDING", reason: "DELIVERY_PENDING", message: status.message },
      candidates: [], totalBytes: 0,
    };
  }

  if (status.status !== "DELIVERED") {
    if (status.files.length) {
      throw directoryError("A non-delivered candidate package may not name candidate files.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
    }
    const kind = await directoryKind(candidateDirectory);
    if (["link", "other"].includes(kind)) {
      throw directoryError("The individual-candidates path must be a real directory.", "MANUAL_SOD_CANDIDATE_DIRECTORY_INVALID");
    }
    if (kind === "directory") {
      const staleEntries = await fs.readdir(candidateDirectory);
      if (staleEntries.some((name) => name.toLowerCase().endsWith(".json"))) {
        throw directoryError("A non-delivered candidate package contains unexpected candidate JSON.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
      }
    }
    return {
      sourceKind, packageId, packageDirectory,
      delivery: { status: status.status, reason: status.reason, message: status.message },
      candidates: [], totalBytes: 0,
    };
  }

  await requireDirectory(candidateDirectory, {
    missingCode: "MANUAL_SOD_CANDIDATE_DIRECTORY_NOT_FOUND",
    invalidCode: "MANUAL_SOD_CANDIDATE_DIRECTORY_INVALID",
    label: `The ${sourceKind.toLowerCase()} individual-candidates directory`,
  });
  const entries = await fs.readdir(candidateDirectory, { withFileTypes: true });
  const jsonEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith(".json"));
  if (!jsonEntries.length || jsonEntries.length > MAX_MANUAL_SOD_CANDIDATES) {
    throw directoryError("The delivered candidate package has an invalid candidate-file count.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
  }
  if (sourceKind === "AD_HOC" && jsonEntries.length !== 1) {
    throw directoryError("An ad-hoc trade-card package must contain exactly one candidate.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
  }
  if (jsonEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw directoryError("Candidate entries must be regular JSON files.", "MANUAL_SOD_CANDIDATE_FILE_INVALID");
  }

  const actualNames = sorted(jsonEntries.map((entry) => entry.name));
  const expectedNames = sorted(status.files.map((file) => path.basename(file)));
  if (new Set(expectedNames).size !== expectedNames.length
    || actualNames.length !== expectedNames.length
    || actualNames.some((name, index) => name !== expectedNames[index])) {
    throw directoryError("The candidate files do not match candidate-delivery-status.json.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
  }

  let totalBytes = 0;
  const candidates = [];
  for (const filename of actualNames) {
    const raw = await readRegularFile(path.join(candidateDirectory, filename), {
      maxBytes: MAX_MANUAL_SOD_CANDIDATE_BYTES,
      invalidCode: "MANUAL_SOD_CANDIDATE_FILE_INVALID",
      label: `${sourceKind} candidate file ${filename}`,
    });
    const byteLength = Buffer.byteLength(raw);
    totalBytes += byteLength;
    let bundle;
    try {
      bundle = validateManualSodIndividualCandidateJson(raw);
    } catch (error) {
      throw directoryError(`${sourceKind} candidate file ${filename} failed current validation.`, "MANUAL_SOD_CANDIDATE_INVALID", error);
    }
    const candidate = bundle.candidates[0];
    if (bundle.sourceDate !== sourceDate || candidate.sourceDate !== sourceDate) {
      throw directoryError(`${sourceKind} candidate file ${filename} does not match the selected source date.`, "MANUAL_SOD_SOURCE_DATE_MISMATCH");
    }
    candidates.push({ filename, byteLength, raw, sourceKind, packageId, packageDirectory });
  }

  return {
    sourceKind, packageId, packageDirectory,
    delivery: { status: status.status, reason: status.reason, message: status.message },
    candidates, totalBytes,
  };
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

  const packages = [];
  const legacyStatusPath = path.join(packageDirectory, "candidate-delivery-status.json");
  const sodPackageDirectory = path.join(packageDirectory, "sod-package");
  const hasLegacyPackage = await fileKind(legacyStatusPath) !== "missing";
  const sodKind = await directoryKind(sodPackageDirectory);
  if (["link", "other"].includes(sodKind)) {
    throw directoryError("The SOD package path must be a real directory.", "MANUAL_SOD_PACKAGE_INVALID");
  }
  if (hasLegacyPackage && sodKind === "directory") {
    throw directoryError("Both legacy and current SOD packages exist for the selected date.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
  }
  if (sodKind === "directory") {
    packages.push(await readCandidatePackage({
      packageDirectory: sodPackageDirectory,
      sourceDate,
      sourceKind: "SOD",
      packageId: "sod-package",
      // The SOD packager creates the directory before publishing its final
      // status. Keep already-complete ad-hoc cards visible during that window.
      allowIncomplete: true,
    }));
  } else if (hasLegacyPackage) {
    packages.push(await readCandidatePackage({
      packageDirectory,
      sourceDate,
      sourceKind: "SOD",
      packageId: "legacy-sod-package",
    }));
  }

  const adHocDirectory = path.join(packageDirectory, "ad-hoc");
  const adHocKind = await directoryKind(adHocDirectory);
  if (["link", "other"].includes(adHocKind)) {
    throw directoryError("The ad-hoc package path must be a real directory.", "MANUAL_SOD_PACKAGE_INVALID");
  }
  if (adHocKind === "directory") {
    const entries = await fs.readdir(adHocDirectory, { withFileTypes: true });
    const stagingEntries = entries.filter((entry) => entry.name.startsWith(".manual-trade-card-candidate-"));
    if (stagingEntries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
      throw directoryError("Private ad-hoc staging entries must be real directories.", "MANUAL_SOD_PACKAGE_INVALID");
    }
    const publishedEntries = entries.filter((entry) => !entry.name.startsWith(".manual-trade-card-candidate-"));
    if (publishedEntries.length > MAX_MANUAL_SOD_CANDIDATES) {
      throw directoryError("The selected date contains too many ad-hoc packages.", "MANUAL_SOD_PACKAGE_TOO_LARGE");
    }
    for (const entry of sorted(publishedEntries.map((value) => value.name)).map((name) => publishedEntries.find((value) => value.name === name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)) {
        throw directoryError("Ad-hoc package entries must be real, safely named directories.", "MANUAL_SOD_PACKAGE_INVALID");
      }
      packages.push(await readCandidatePackage({
        packageDirectory: path.join(adHocDirectory, entry.name),
        sourceDate,
        sourceKind: "AD_HOC",
        packageId: entry.name,
        allowIncomplete: true,
      }));
    }
  }

  if (!packages.length) {
    throw directoryError(`No completed SOD or ad-hoc candidate package was found for ${sourceDate}.`, "MANUAL_SOD_PACKAGE_NOT_FOUND");
  }

  const candidates = packages.flatMap((item) => item.candidates);
  const totalBytes = packages.reduce((sum, item) => sum + item.totalBytes, 0);
  if (candidates.length > MAX_MANUAL_SOD_CANDIDATES || totalBytes > MAX_MANUAL_SOD_TOTAL_BYTES) {
    throw directoryError("The selected date exceeds the aggregate candidate read limit.", "MANUAL_SOD_PACKAGE_TOO_LARGE");
  }
  const identities = new Set();
  for (const item of candidates) {
    const bundle = validateManualSodIndividualCandidateJson(item.raw);
    const candidate = bundle.candidates[0];
    const identity = `${candidate.candidateId}\u0000${candidate.contractVersion}`;
    if (identities.has(identity)) {
      throw directoryError("The selected date contains a duplicate candidate identity.", "MANUAL_SOD_PACKAGE_INCONSISTENT");
    }
    identities.add(identity);
  }

  const incomplete = packages.filter((item) => item.delivery.status === "PENDING").length;
  const withheld = packages.filter((item) => item.delivery.status === "WITHHELD").length;
  const deliveredPackages = packages.filter((item) => item.delivery.status === "DELIVERED").length;
  const delivery = candidates.length
    ? {
        status: "DELIVERED",
        reason: "VALIDATED_LOCAL_PACKAGES",
        message: `${candidates.length} validated candidate${candidates.length === 1 ? "" : "s"} loaded from ${deliveredPackages} local package${deliveredPackages === 1 ? "" : "s"}.${incomplete || withheld ? ` ${incomplete + withheld} incomplete or withheld package${incomplete + withheld === 1 ? " was" : "s were"} excluded.` : ""}`,
      }
    : packages.some((item) => ["PENDING", "WITHHELD"].includes(item.delivery.status))
      ? { status: "WITHHELD", reason: "NO_DELIVERED_LOCAL_CANDIDATES", message: "No candidate is ready for Import; local packages are incomplete or withheld." }
      : { status: "NO_CANDIDATES", reason: "NO_LOCAL_CANDIDATES", message: "No SOD or ad-hoc candidates were delivered for the selected date." };

  return {
    sourceDate,
    packageDirectory,
    delivery,
    packages: packages.map(({ totalBytes: _totalBytes, candidates: _candidates, ...item }) => item),
    candidates,
  };
}
