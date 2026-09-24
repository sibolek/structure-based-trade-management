import { MANUAL_IMPORT_MAX_BYTES, prepareManualCandidateImport } from "./manual-candidate-import.js";

const encoder = new TextEncoder();
const OUTCOME_STATUSES = new Set(["ACCEPTED", "DUPLICATE", "CONFLICT", "STALE", "ACTION_REQUIRED", "REJECTED"]);

function fail(message, code = "MANUAL_SOD_DIRECTORY_RESPONSE_INVALID") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function text(value) {
  return String(value ?? "").trim();
}

function expectedPackageDirectory(root, sourceKind, packageId) {
  if (root.includes("\\") || packageId.includes("/") || packageId.includes("\\")) return null;
  if (sourceKind === "SOD" && packageId === "legacy-sod-package") return root;
  if (sourceKind === "SOD" && packageId === "sod-package") return `${root}/sod-package`;
  if (sourceKind === "AD_HOC" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(packageId)) {
    return `${root}/ad-hoc/${packageId}`;
  }
  return null;
}

export function prepareManualSodDirectoryResponse(payload, expectedSourceDate) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("The local SOD package response is invalid.");
  if (payload.sourceDate !== expectedSourceDate) fail("The loaded SOD package does not match the selected date.");
  const packageDirectory = text(payload.packageDirectory);
  const directorySegments = packageDirectory.split("/");
  if (!packageDirectory.startsWith("/") || packageDirectory.endsWith("/")
    || packageDirectory.includes("\\") || packageDirectory.includes("\u0000")
    || directorySegments.includes("") && directorySegments.slice(1).includes("")
    || directorySegments.some((segment) => [".", ".."].includes(segment))
    || directorySegments.at(-1) !== expectedSourceDate) {
    fail("The local SOD package location does not match the selected date.");
  }
  if (!payload.delivery || !["DELIVERED", "NO_CANDIDATES", "WITHHELD"].includes(payload.delivery.status)
    || typeof payload.delivery.reason !== "string" || typeof payload.delivery.message !== "string") {
    fail("The local SOD delivery status is invalid.");
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length > 100) fail("The local SOD candidate list is invalid.");
  if (payload.delivery.status === "DELIVERED" && payload.candidates.length === 0) fail("The delivered SOD package contains no candidates.");
  if (payload.delivery.status !== "DELIVERED" && payload.candidates.length !== 0) fail("A non-delivered SOD package returned candidate data.");

  if (!Array.isArray(payload.packages) || payload.packages.length > 101) fail("The local SOD package provenance is invalid.");
  const packageReferences = new Map();
  for (const entry of payload.packages) {
    const sourceKind = text(entry?.sourceKind).toUpperCase();
    const packageId = text(entry?.packageId);
    const packageEntryDirectory = text(entry?.packageDirectory);
    const expectedDirectory = expectedPackageDirectory(packageDirectory, sourceKind, packageId);
    const deliveryStatus = text(entry?.delivery?.status).toUpperCase();
    const reference = `${sourceKind}\u0000${packageId}`;
    if (!expectedDirectory || packageEntryDirectory !== expectedDirectory
      || !["PENDING", "DELIVERED", "NO_CANDIDATES", "WITHHELD"].includes(deliveryStatus)
      || packageReferences.has(reference)) {
      fail("The local SOD package provenance is invalid.");
    }
    packageReferences.set(reference, { packageDirectory: packageEntryDirectory, deliveryStatus });
  }

  const fileReferences = new Set();
  const identities = new Set();
  const candidates = payload.candidates.map((entry) => {
    const filename = text(entry?.filename);
    if (!filename || filename.includes("/") || filename.includes("\\") || !filename.toLowerCase().endsWith(".json")) {
      fail("The local SOD response contains an invalid candidate filename.");
    }
    const sourceKind = text(entry?.sourceKind || "SOD").toUpperCase();
    const packageId = text(entry?.packageId || "legacy-sod-package");
    const candidatePackageDirectory = text(entry?.packageDirectory || packageDirectory);
    const packageReference = packageReferences.get(`${sourceKind}\u0000${packageId}`);
    if (!["SOD", "AD_HOC"].includes(sourceKind) || !packageReference
      || packageReference.deliveryStatus !== "DELIVERED"
      || candidatePackageDirectory !== packageReference.packageDirectory) {
      fail("The local SOD response contains invalid package provenance.");
    }
    const fileReference = `${sourceKind}\u0000${packageId}\u0000${filename}`;
    if (fileReferences.has(fileReference)) fail("The local SOD response contains a duplicate candidate file reference.");
    fileReferences.add(fileReference);
    if (typeof entry.raw !== "string" || encoder.encode(entry.raw).length > MANUAL_IMPORT_MAX_BYTES) {
      fail(`Candidate file ${filename} is missing or exceeds the import limit.`);
    }
    const actualByteLength = encoder.encode(entry.raw).length;
    if (!Number.isInteger(entry.byteLength) || entry.byteLength !== actualByteLength) {
      fail(`Candidate file ${filename} has inconsistent byte-length evidence.`);
    }
    const prepared = prepareManualCandidateImport(entry.raw);
    if (prepared.kind !== "canonical"
      || prepared.body.ingressPolicy !== "MANUAL_AUTHORIZED"
      || prepared.body.source !== "SOD_A_PLUS_TRADES"
      || prepared.body.sourceDate !== expectedSourceDate
      || prepared.candidate?.sourceDate !== expectedSourceDate) {
      fail(`Candidate file ${filename} is not an authorized manual SOD bundle for ${expectedSourceDate}.`);
    }
    const candidateId = text(prepared.candidate?.candidateId);
    const contractVersion = Number(prepared.candidate?.contractVersion);
    const identity = `${candidateId}\u0000${contractVersion}`;
    if (identities.has(identity)) fail("The local SOD response contains a duplicate candidate identity.");
    identities.add(identity);
    return {
      filename,
      byteLength: entry.byteLength,
      sourceKind,
      packageId,
      packageDirectory: candidatePackageDirectory,
      prepared,
    };
  });

  return {
    sourceDate: payload.sourceDate,
    packageDirectory,
    delivery: { ...payload.delivery },
    packages: payload.packages.map((entry) => ({ ...entry, delivery: { ...entry.delivery } })),
    candidates,
  };
}

export function validateManualSodImportResult(result, prepared) {
  if (!result || !Array.isArray(result.outcomes) || result.outcomes.length !== 1) {
    fail("Canonical import result is unavailable.", "MANUAL_IMPORT_INVALID_RESULT");
  }
  const outcome = result.outcomes[0];
  if (!OUTCOME_STATUSES.has(outcome?.status)
    || text(outcome.candidateId) !== text(prepared?.candidate?.candidateId)
    || Number(outcome.contractVersion) !== Number(prepared?.candidate?.contractVersion)) {
    fail("Canonical import result does not match the selected candidate.", "MANUAL_IMPORT_INVALID_RESULT");
  }
  return result;
}
