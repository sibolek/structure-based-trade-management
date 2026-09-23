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

export function prepareManualSodDirectoryResponse(payload, expectedSourceDate) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("The local SOD package response is invalid.");
  if (payload.sourceDate !== expectedSourceDate) fail("The loaded SOD package does not match the selected date.");
  if (typeof payload.packageDirectory !== "string" || !payload.packageDirectory.trim()) fail("The local SOD package location is unavailable.");
  if (!payload.delivery || !["DELIVERED", "NO_CANDIDATES", "WITHHELD"].includes(payload.delivery.status)
    || typeof payload.delivery.reason !== "string" || typeof payload.delivery.message !== "string") {
    fail("The local SOD delivery status is invalid.");
  }
  if (!Array.isArray(payload.candidates) || payload.candidates.length > 100) fail("The local SOD candidate list is invalid.");
  if (payload.delivery.status === "DELIVERED" && payload.candidates.length === 0) fail("The delivered SOD package contains no candidates.");
  if (payload.delivery.status !== "DELIVERED" && payload.candidates.length !== 0) fail("A non-delivered SOD package returned candidate data.");

  const filenames = new Set();
  const identities = new Set();
  const candidates = payload.candidates.map((entry) => {
    const filename = text(entry?.filename);
    if (!filename || filename.includes("/") || filename.includes("\\") || !filename.toLowerCase().endsWith(".json")) {
      fail("The local SOD response contains an invalid candidate filename.");
    }
    if (filenames.has(filename)) fail("The local SOD response contains a duplicate candidate filename.");
    filenames.add(filename);
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
      prepared,
    };
  });

  return {
    sourceDate: payload.sourceDate,
    packageDirectory: payload.packageDirectory,
    delivery: { ...payload.delivery },
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
