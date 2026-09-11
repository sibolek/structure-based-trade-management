import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { publishCandidateBundleAtomically } from "./sod-candidate-publisher.mjs";
import {
  DEFAULT_PRETRADE_URL,
  fetchCandidateSnapshot,
  waitForStableFile,
} from "./candidate-feeder.mjs";
import {
  assertJsonStructuralSafety,
  candidateContractHash,
  CANDIDATE_STRUCTURAL_LIMITS,
  SOD_A_PLUS_TRADES_SOURCE,
} from "./pretrade-candidate-contract.mjs";
import { MANUAL_AUTHORIZED } from "./pretrade-candidate-ingress.mjs";
import {
  resolveSodCandidateLineage,
  SOD_LINEAGE_REVISED,
} from "./sod-candidate-lineage.mjs";

export const MANUAL_INGESTION_SCHEMA_VERSION = 1;
export const MANUAL_SUBMISSION_TYPES = Object.freeze([
  "MANUAL_SOD",
  "MANUAL_STANDALONE_TRADE_CARD",
]);
export const DEFAULT_MANUAL_PROPOSAL_INBOX = "Manual Proposal Inbox";

const ENVELOPE_KEYS = new Set([
  "ingestionSchemaVersion",
  "submission",
  "source",
  "sourceDate",
  "bundleId",
  "validity",
  "candidates",
]);
const SUBMISSION_KEYS = new Set(["submissionId", "submissionType", "preparedAt"]);
const PROHIBITED_MANUAL_CANDIDATE_FIELDS = new Set([
  "contractVersion",
  "schemaVersion",
  "generatedAt",
  "contentHash",
  "contractAuthority",
  "lifecycleState",
  "status",
  "stateRevision",
  "armAuthorized",
  "arm",
  "armState",
  "permissionOutcome",
  "riskEvaluation",
  "authorizedDssEvaluationId",
  "authorizedRiskEvaluationId",
  "selectedQuantity",
  "handoff",
  "handoffAuthority",
  "executionState",
  "authorizationId",
  "reviewId",
  "manualSupersessionReviews",
  "manualSupersessionReview",
  "manualSupersessionAuthorizations",
  "manualSupersessionAuthorization",
  "manualSupersessionApproval",
  "manualApproved",
  "forceImport",
  "supersessionApproved",
]);

function text(value) {
  return String(value ?? "").trim();
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

function absoluteTimestamp(value) {
  const raw = text(value);
  if (!raw || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function manualError(message, code = "MANUAL_INGESTION_ERROR", details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function rawJsonError(message, code = "MANUAL_INGESTION_INVALID_JSON") {
  throw manualError(message, code);
}

class RawJsonValidator {
  constructor(raw, limits) {
    this.raw = raw;
    this.limits = limits;
    this.i = 0;
    this.nodes = 0;
  }

  validate() {
    if (Buffer.byteLength(this.raw, "utf8") > this.limits.maxSerializedBytes) {
      rawJsonError(
        `manual envelope exceeds raw byte limit ${this.limits.maxSerializedBytes}`,
        "MANUAL_INGESTION_RAW_TOO_LARGE",
      );
    }
    this.#skipWhitespace();
    this.#parseValue(0);
    this.#skipWhitespace();
    if (this.i !== this.raw.length) rawJsonError(`unexpected trailing JSON token at byte ${this.i}`);
    return { nodes: this.nodes };
  }

  #countNode(depth) {
    this.nodes += 1;
    if (this.nodes > this.limits.maxNodes) {
      rawJsonError(
        `manual envelope exceeds structural node limit ${this.limits.maxNodes}`,
        "MANUAL_INGESTION_STRUCTURAL_LIMIT",
      );
    }
    if (depth > this.limits.maxDepth) {
      rawJsonError(
        `manual envelope exceeds nesting depth limit ${this.limits.maxDepth}`,
        "MANUAL_INGESTION_STRUCTURAL_LIMIT",
      );
    }
  }

  #skipWhitespace() {
    while (this.i < this.raw.length && /[\t\n\r ]/.test(this.raw[this.i])) this.i += 1;
  }

  #parseValue(depth) {
    this.#countNode(depth);
    const ch = this.raw[this.i];
    if (ch === "{") return this.#parseObject(depth);
    if (ch === "[") return this.#parseArray(depth);
    if (ch === "\"") return this.#parseString();
    if (ch === "t") return this.#consumeLiteral("true");
    if (ch === "f") return this.#consumeLiteral("false");
    if (ch === "n") return this.#consumeLiteral("null");
    if (ch === "-" || /[0-9]/.test(ch || "")) return this.#parseNumber();
    rawJsonError(`unexpected JSON token at byte ${this.i}`);
    return null;
  }

  #parseObject(depth) {
    this.i += 1;
    this.#skipWhitespace();
    const keys = new Set();
    let count = 0;
    if (this.raw[this.i] === "}") {
      this.i += 1;
      return;
    }
    while (this.i < this.raw.length) {
      if (this.raw[this.i] !== "\"") rawJsonError(`object key must be a JSON string at byte ${this.i}`);
      const key = this.#parseString();
      if (keys.has(key)) {
        rawJsonError(
          `duplicate JSON object key: ${key}`,
          "MANUAL_INGESTION_DUPLICATE_KEYS",
        );
      }
      keys.add(key);
      count += 1;
      if (count > this.limits.maxObjectKeys) {
        rawJsonError(
          `manual envelope object exceeds breadth limit ${this.limits.maxObjectKeys}`,
          "MANUAL_INGESTION_STRUCTURAL_LIMIT",
        );
      }
      this.#skipWhitespace();
      if (this.raw[this.i] !== ":") rawJsonError(`expected ':' after object key at byte ${this.i}`);
      this.i += 1;
      this.#skipWhitespace();
      this.#parseValue(depth + 1);
      this.#skipWhitespace();
      if (this.raw[this.i] === "}") {
        this.i += 1;
        return;
      }
      if (this.raw[this.i] !== ",") rawJsonError(`expected ',' or '}' at byte ${this.i}`);
      this.i += 1;
      this.#skipWhitespace();
    }
    rawJsonError("unterminated JSON object");
  }

  #parseArray(depth) {
    this.i += 1;
    this.#skipWhitespace();
    let count = 0;
    if (this.raw[this.i] === "]") {
      this.i += 1;
      return;
    }
    while (this.i < this.raw.length) {
      count += 1;
      if (count > this.limits.maxArrayLength) {
        rawJsonError(
          `manual envelope array exceeds length limit ${this.limits.maxArrayLength}`,
          "MANUAL_INGESTION_STRUCTURAL_LIMIT",
        );
      }
      this.#parseValue(depth + 1);
      this.#skipWhitespace();
      if (this.raw[this.i] === "]") {
        this.i += 1;
        return;
      }
      if (this.raw[this.i] !== ",") rawJsonError(`expected ',' or ']' at byte ${this.i}`);
      this.i += 1;
      this.#skipWhitespace();
    }
    rawJsonError("unterminated JSON array");
  }

  #parseString() {
    const start = this.i;
    this.i += 1;
    while (this.i < this.raw.length) {
      const ch = this.raw[this.i];
      if (ch === "\"") {
        this.i += 1;
        const encoded = this.raw.slice(start, this.i);
        let decoded;
        try {
          decoded = JSON.parse(encoded);
        } catch (error) {
          rawJsonError(`invalid JSON string escape at byte ${start}: ${error.message}`);
        }
        if (Buffer.byteLength(decoded, "utf8") > this.limits.maxStringBytes) {
          rawJsonError(
            `manual envelope string exceeds byte limit ${this.limits.maxStringBytes}`,
            "MANUAL_INGESTION_STRUCTURAL_LIMIT",
          );
        }
        return decoded;
      }
      if (ch === "\\") {
        const escaped = this.raw[this.i + 1];
        if (!escaped || !/["\\/bfnrtu]/.test(escaped)) {
          rawJsonError(`invalid JSON escape at byte ${this.i}`);
        }
        if (escaped === "u" && !/^[0-9a-fA-F]{4}$/.test(this.raw.slice(this.i + 2, this.i + 6))) {
          rawJsonError(`invalid JSON unicode escape at byte ${this.i}`);
        }
        this.i += escaped === "u" ? 6 : 2;
        continue;
      }
      if (ch < " ") rawJsonError(`unescaped control character in JSON string at byte ${this.i}`);
      this.i += 1;
    }
    rawJsonError("unterminated JSON string");
    return "";
  }

  #parseNumber() {
    const rest = this.raw.slice(this.i);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (!match) rawJsonError(`invalid JSON number at byte ${this.i}`);
    if (Buffer.byteLength(match[0], "utf8") > this.limits.maxStringBytes) {
      rawJsonError(
        `manual envelope numeric value exceeds byte limit ${this.limits.maxStringBytes}`,
        "MANUAL_INGESTION_STRUCTURAL_LIMIT",
      );
    }
    this.i += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) rawJsonError(`non-finite JSON number at byte ${this.i}`);
  }

  #consumeLiteral(literal) {
    if (this.raw.slice(this.i, this.i + literal.length) !== literal) {
      rawJsonError(`invalid JSON literal at byte ${this.i}`);
    }
    this.i += literal.length;
  }
}

export function validateRawManualJson(raw, { limits = CANDIDATE_STRUCTURAL_LIMITS } = {}) {
  return new RawJsonValidator(raw, limits).validate();
}

export function parseManualIngestionEnvelopeBytes(bytes) {
  const raw = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes ?? "");
  validateRawManualJson(raw);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw manualError(`Manual ingestion envelope is malformed JSON: ${error.message}`, "MANUAL_INGESTION_INVALID_JSON");
  }
  return parsed;
}

export function validateManualIngestionEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return ["envelope must be a JSON object"];
  try {
    assertJsonStructuralSafety(envelope, { rootName: "manual envelope" });
  } catch (error) {
    errors.push(error.message);
  }
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.has(key)) errors.push(`unknown envelope field: ${key}`);
  }
  if (envelope.ingestionSchemaVersion !== MANUAL_INGESTION_SCHEMA_VERSION) {
    errors.push("ingestionSchemaVersion must equal 1");
  }
  if (!envelope.submission || typeof envelope.submission !== "object" || Array.isArray(envelope.submission)) {
    errors.push("submission is required and must be a JSON object");
  } else {
    for (const key of Object.keys(envelope.submission)) {
      if (!SUBMISSION_KEYS.has(key)) errors.push(`unknown submission field: ${key}`);
    }
    if (!text(envelope.submission.submissionId)) errors.push("submission.submissionId is required");
    if (!MANUAL_SUBMISSION_TYPES.includes(envelope.submission.submissionType)) {
      errors.push(`submission.submissionType must be one of ${MANUAL_SUBMISSION_TYPES.join(", ")}`);
    }
    if (!absoluteTimestamp(envelope.submission.preparedAt)) {
      errors.push("submission.preparedAt must be an absolute timestamp with Z or UTC offset");
    }
  }
  if (envelope.source !== SOD_A_PLUS_TRADES_SOURCE) errors.push(`source must equal ${SOD_A_PLUS_TRADES_SOURCE}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(envelope.sourceDate))) errors.push("sourceDate must be exact YYYY-MM-DD");
  if (!text(envelope.bundleId)) errors.push("bundleId is required");
  if (envelope.validity !== undefined && (!envelope.validity || typeof envelope.validity !== "object" || Array.isArray(envelope.validity))) {
    errors.push("validity must be a JSON object when supplied");
  }
  if (!Array.isArray(envelope.candidates) || !envelope.candidates.length) {
    errors.push("candidates must be a non-empty array");
  } else if (
    envelope.submission?.submissionType === "MANUAL_STANDALONE_TRADE_CARD"
    && envelope.candidates.length !== 1
  ) {
    errors.push("standalone trade-card submissions must contain exactly one candidate");
  }
  for (const [index, candidate] of (Array.isArray(envelope.candidates) ? envelope.candidates : []).entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(`candidates[${index}] must be a JSON object`);
      continue;
    }
    for (const field of PROHIBITED_MANUAL_CANDIDATE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(candidate, field)) {
        errors.push(`candidates[${index}].${field} is system-owned authority and may not be supplied`);
      }
    }
    if (candidate.armPolicy && typeof candidate.armPolicy === "object") {
      for (const field of ["armAuthorized", "manualApproved", "forceImport", "supersessionApproved"]) {
        if (Object.prototype.hasOwnProperty.call(candidate.armPolicy, field)) {
          errors.push(`candidates[${index}].armPolicy.${field} is system-owned authority and may not be supplied`);
        }
      }
    }
  }
  return [...new Set(errors)];
}

function materializedCandidate(candidate, envelope) {
  return {
    ...structuredClone(candidate),
    contractVersion: 1,
    schemaVersion: 1,
    source: SOD_A_PLUS_TRADES_SOURCE,
    sourceDate: envelope.sourceDate,
    generatedAt: absoluteTimestamp(envelope.submission.preparedAt),
    validity: candidate.validity === undefined ? structuredClone(envelope.validity ?? {}) : structuredClone(candidate.validity),
  };
}

export function preflightManualSubmission(envelope, priorCandidates = []) {
  const errors = validateManualIngestionEnvelope(envelope);
  if (errors.length) {
    return { status: "REJECTED", errors, plan: [], canonicalBundle: null, lineage: [] };
  }
  const lineage = [];
  const candidates = [];
  const seenIds = new Set();
  const plan = envelope.candidates.map((candidate, index) => {
    const candidateId = text(candidate?.candidateId) || null;
    if (candidateId && seenIds.has(candidateId)) {
      return {
        candidateId,
        contractVersion: null,
        priorContractVersion: null,
        classification: "CONFLICT",
        preflightStatus: "CONFLICT",
        reasons: [`duplicate candidateId in submission: ${candidateId}`],
      };
    }
    if (candidateId) seenIds.add(candidateId);
    try {
      const resolution = resolveSodCandidateLineage(materializedCandidate(candidate, envelope), priorCandidates);
      lineage.push({
        classification: resolution.classification,
        candidateId: resolution.candidateId,
        contractVersion: resolution.contractVersion,
        priorContractVersion: resolution.priorContractVersion,
        substantiveHash: resolution.substantiveHash,
        priorSubstantiveHash: resolution.priorSubstantiveHash,
        reusedPriorContract: resolution.reusedPriorContract,
      });
      candidates.push(resolution.candidate);
      return {
        classification: resolution.classification,
        candidateId: resolution.candidateId,
        contractVersion: resolution.contractVersion,
        priorContractVersion: resolution.priorContractVersion,
        substantiveHash: resolution.substantiveHash,
        priorSubstantiveHash: resolution.priorSubstantiveHash,
        reusedPriorContract: resolution.reusedPriorContract,
        preflightStatus: resolution.classification === SOD_LINEAGE_REVISED ? "ACTION_REQUIRED" : resolution.classification,
        reasons: [],
      };
    } catch (error) {
      return {
        candidateId,
        contractVersion: null,
        priorContractVersion: null,
        classification: "INVALID",
        preflightStatus: "REJECTED",
        reasons: [error.message],
        code: error.code || "MANUAL_CANDIDATE_PREFLIGHT_INVALID",
        index,
      };
    }
  });
  const hasAction = plan.some((item) => item.preflightStatus === "ACTION_REQUIRED");
  const hasRejected = plan.some((item) => ["REJECTED", "CONFLICT", "STALE"].includes(item.preflightStatus));
  return {
    status: hasAction ? "ACTION_REQUIRED" : hasRejected ? "PARTIAL_SUCCESS" : "PREFLIGHTED",
    errors: [],
    plan,
    canonicalBundle: {
      schemaVersion: 1,
      source: SOD_A_PLUS_TRADES_SOURCE,
      sourceDate: envelope.sourceDate,
      generatedAt: absoluteTimestamp(envelope.submission.preparedAt),
      bundleId: envelope.bundleId,
      ingressPolicy: MANUAL_AUTHORIZED,
      candidates,
    },
    lineage,
  };
}

export function manualIngestionDirectories(manualInboxPath) {
  const inbox = path.resolve(text(manualInboxPath || DEFAULT_MANUAL_PROPOSAL_INBOX));
  const root = path.dirname(inbox);
  return {
    root,
    inbox,
    journal: path.join(root, "manual-ingestion-journal"),
    receipts: path.join(root, "manual-ingestion-receipts"),
    archive: path.join(root, "manual-ingestion-archive"),
    quarantine: path.join(root, "manual-ingestion-quarantine"),
  };
}

async function atomicCreateJson(finalPath, value) {
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  const tempPath = `${finalPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  const handle = await fs.open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync();
    await handle.close();
    await fs.link(tempPath, finalPath);
    await fs.unlink(tempPath);
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function readJsonFile(filePath, code) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw manualError(`Unable to read journal record ${filePath}: ${error.message}`, code, { filePath });
  }
}

async function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
}

async function reclaimableStaleLock(lockDir) {
  let owner;
  try {
    owner = JSON.parse(await fs.readFile(path.join(lockDir, "owner.json"), "utf8"));
  } catch {
    throw manualError(
      `Manual submission lock exists but its owner cannot be verified: ${lockDir}`,
      "MANUAL_SUBMISSION_LOCK_UNVERIFIABLE",
      { retryable: false },
    );
  }
  if (!owner || typeof owner !== "object" || !Number.isInteger(Number(owner.pid)) || !text(owner.lockId)) {
    throw manualError(
      `Manual submission lock owner is ambiguous: ${lockDir}`,
      "MANUAL_SUBMISSION_LOCK_UNVERIFIABLE",
      { retryable: false },
    );
  }
  return !(await pidIsAlive(Number(owner.pid)));
}

export async function acquireSubmissionJournalLock({ journalDir, submissionId, clock = nowIso } = {}) {
  const safeSubmissionId = text(submissionId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!safeSubmissionId) throw manualError("submissionId is required for journal lock", "MANUAL_JOURNAL_SUBMISSION_ID_REQUIRED");
  const lockDir = path.join(journalDir, safeSubmissionId, ".lock");
  await fs.mkdir(path.dirname(lockDir), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const owner = {
      submissionId,
      pid: process.pid,
      lockId: crypto.randomUUID(),
      acquiredAt: clock(),
    };
    try {
      await fs.mkdir(lockDir, { mode: 0o700 });
      await atomicCreateJson(path.join(lockDir, "owner.json"), owner);
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(await fs.readFile(path.join(lockDir, "owner.json"), "utf8"));
          if (current.lockId !== owner.lockId) return;
          await fs.rm(lockDir, { recursive: true, force: true });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stale = await reclaimableStaleLock(lockDir);
      if (!stale) {
        throw manualError(
          `Manual submission ${submissionId} is already being processed`,
          "MANUAL_SUBMISSION_LOCK_HELD",
          { retryable: true, submissionId },
        );
      }
      await fs.rm(lockDir, { recursive: true, force: true });
    }
  }

  throw manualError("Unable to acquire manual submission lock", "MANUAL_SUBMISSION_LOCK_FAILED", { retryable: true });
}

export async function appendSubmissionJournalEvent({ journalDir, submissionId, event }) {
  const safeSubmissionId = text(submissionId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!safeSubmissionId) throw manualError("submissionId is required for journal append", "MANUAL_JOURNAL_SUBMISSION_ID_REQUIRED");
  const submissionDir = path.join(journalDir, safeSubmissionId);
  const sequenceDir = path.join(submissionDir, "events");
  await fs.mkdir(submissionDir, { recursive: true });
  await fs.mkdir(sequenceDir, { recursive: true });
  const existing = (await fs.readdir(sequenceDir).catch(() => []))
    .filter((name) => /^\d{6}-/.test(name))
    .sort();
  const sequence = existing.length + 1;
  const eventId = text(event.eventId) || crypto.randomUUID();
  const finalPath = path.join(sequenceDir, `${String(sequence).padStart(6, "0")}-${text(event.eventType || "EVENT")}-${eventId}.json`);
  await atomicCreateJson(finalPath, { sequence, eventId, ...event });
  return finalPath;
}

async function claimSubmission({ directories, submissionId, contentHash, observedAt }) {
  const safeSubmissionId = text(submissionId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!safeSubmissionId) throw manualError("submissionId is required for journal claim", "MANUAL_JOURNAL_SUBMISSION_ID_REQUIRED");
  const claimPath = path.join(directories.journal, safeSubmissionId, "claim.json");
  await fs.mkdir(path.dirname(claimPath), { recursive: true });
  const claim = { submissionId, contentHash, claimedAt: observedAt };
  try {
    await atomicCreateJson(claimPath, claim);
    return { status: "CLAIMED", claimPath, claim };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readJsonFile(claimPath, "MANUAL_JOURNAL_CORRUPT");
    if (existing.contentHash !== contentHash) {
      throw manualError("submissionId is already claimed for different content", "MANUAL_SUBMISSION_ID_CONFLICT", { submissionId });
    }
    return { status: "REPLAY", claimPath, claim: existing };
  }
}

async function writeReceipt(directories, receipt) {
  const safeSubmissionId = text(receipt.submissionId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const receiptId = text(receipt.receiptId) || crypto.randomUUID();
  const file = `${safeSubmissionId}-${text(receipt.overallOutcome)}-${receiptId}.receipt.json`;
  const finalPath = path.join(directories.receipts, file);
  await atomicCreateJson(finalPath, { receiptId, ...receipt });
  return finalPath;
}

async function readStableManualProposalBytes(filePath, options = {}) {
  const stableStat = await waitForStableFile(filePath, options);
  if (stableStat.size > CANDIDATE_STRUCTURAL_LIMITS.maxSerializedBytes) {
    throw manualError(
      `manual proposal exceeds raw byte limit ${CANDIDATE_STRUCTURAL_LIMITS.maxSerializedBytes}`,
      "MANUAL_INGESTION_RAW_TOO_LARGE",
    );
  }
  const bytes = await fs.readFile(filePath);
  const afterRead = await fs.stat(filePath);
  if (`${stableStat.size}:${stableStat.mtimeMs}` !== `${afterRead.size}:${afterRead.mtimeMs}`) {
    throw manualError("manual proposal changed while being read", "MANUAL_PROPOSAL_FILE_NOT_STABLE", { retryable: true });
  }
  return { bytes, stat: afterRead };
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

async function moveImmutableFile(source, destinationDirectory, expectedHash) {
  await fs.mkdir(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, path.basename(source));
  try {
    await fs.copyFile(source, destination, fsSync.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existingHash = await hashFile(destination);
    if (existingHash !== expectedHash) {
      throw manualError(
        `manual source disposition collision at ${destination}`,
        "MANUAL_SOURCE_DISPOSITION_COLLISION",
      );
    }
  }
  await fs.unlink(source).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  return destination;
}

function receiptOutcomeForPreflight(preflight, publicationResult) {
  if (preflight.errors.length) return "FAILED";
  if (preflight.status === "ACTION_REQUIRED") return "ACTION_REQUIRED";
  if (preflight.status === "PARTIAL_SUCCESS" && publicationResult) return "PARTIAL_SUCCESS";
  return publicationResult ? "SUCCESS" : "FAILED";
}

function eligibleCanonicalBundle(preflight) {
  if (!preflight.canonicalBundle) return null;
  const blockedIds = new Set(preflight.plan
    .filter((item) => item.preflightStatus === "ACTION_REQUIRED")
    .map((item) => item.candidateId));
  const candidates = preflight.canonicalBundle.candidates
    .filter((candidate) => !blockedIds.has(candidate.candidateId));
  if (!candidates.length) return null;
  return { ...preflight.canonicalBundle, candidates };
}

function publicationBytesFor(bundle) {
  return Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, "utf8");
}

async function listJsonFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

async function loadSubmissionJournal({ directories, submissionId, contentHash = null }) {
  const safeSubmissionId = text(submissionId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  const submissionDir = path.join(directories.journal, safeSubmissionId);
  const claimPath = path.join(submissionDir, "claim.json");
  let claim;
  try {
    claim = await readJsonFile(claimPath, "MANUAL_JOURNAL_CORRUPT");
  } catch (error) {
    if (error.details?.filePath === claimPath && error.message.includes("ENOENT")) {
      throw manualError("manual submission journal claim not found", "MANUAL_RECOVERY_NOT_FOUND", { submissionId });
    }
    throw error;
  }
  if (claim.submissionId !== submissionId || !text(claim.contentHash)) {
    throw manualError("manual submission claim is ambiguous or corrupt", "MANUAL_JOURNAL_CORRUPT", { submissionId });
  }
  if (contentHash && claim.contentHash !== contentHash) {
    throw manualError("submissionId is already claimed for different content", "MANUAL_SUBMISSION_ID_CONFLICT", { submissionId });
  }

  const eventFiles = await listJsonFiles(path.join(submissionDir, "events"));
  const events = [];
  const seenSequences = new Set();
  for (const eventFile of eventFiles) {
    const event = await readJsonFile(eventFile, "MANUAL_JOURNAL_CORRUPT");
    if (!Number.isInteger(event.sequence) || event.sequence < 1 || seenSequences.has(event.sequence)) {
      throw manualError("manual submission journal has ambiguous event sequence", "MANUAL_JOURNAL_CORRUPT", { submissionId });
    }
    seenSequences.add(event.sequence);
    events.push(event);
  }
  events.sort((left, right) => left.sequence - right.sequence);
  return { submissionDir, claim, events };
}

async function findTerminalReceipt(directories, submissionId, contentHash) {
  const files = await listJsonFiles(directories.receipts);
  for (const file of files) {
    const receipt = await readJsonFile(file, "MANUAL_RECEIPT_CORRUPT");
    if (receipt.submissionId === submissionId && receipt.submissionContentHash === contentHash) {
      return { receiptPath: file, receipt };
    }
  }
  return null;
}

async function findExactPublication(candidateInboxPath, bundle) {
  if (!bundle) return null;
  const expectedHash = sha256(publicationBytesFor(bundle));
  const files = await listJsonFiles(candidateInboxPath);
  for (const file of files) {
    if (await hashFile(file).catch(() => null) === expectedHash) {
      return { finalPath: file, sha256: expectedHash, byteLength: publicationBytesFor(bundle).length };
    }
  }
  return null;
}

function pretradeContainsPublishedCandidates(pretradeCandidates, bundle) {
  if (!bundle) return false;
  const candidates = Array.isArray(pretradeCandidates) ? pretradeCandidates : [];
  return bundle.candidates.every((candidate) => candidates.some((existing) => (
    existing?.candidateId === candidate.candidateId
    && Number(existing?.contractVersion) === Number(candidate.contractVersion)
    && text(existing?.contentHash) === candidateContractHash(candidate)
  )));
}

async function resolvePretradeCandidates({ candidates, pretradeUrl = DEFAULT_PRETRADE_URL, requestOptions = {} } = {}) {
  if (Array.isArray(candidates)) return candidates;
  const snapshot = await fetchCandidateSnapshot(pretradeUrl, requestOptions);
  return snapshot.candidates;
}

export async function reconcileManualSubmission({
  directories,
  submissionId,
  contentHash,
  candidateInboxPath,
  pretradeCandidates,
  pretradeUrl = DEFAULT_PRETRADE_URL,
  requestOptions = {},
  clock = nowIso,
} = {}) {
  const authoritativePretradeCandidates = await resolvePretradeCandidates({
    candidates: pretradeCandidates,
    pretradeUrl,
    requestOptions,
  });
  const journal = await loadSubmissionJournal({ directories, submissionId, contentHash });
  const terminal = await findTerminalReceipt(directories, submissionId, journal.claim.contentHash);
  if (terminal) {
    return {
      terminal: true,
      result: {
        status: terminal.receipt.overallOutcome,
        receiptPath: terminal.receiptPath,
        receipt: terminal.receipt,
        publication: terminal.receipt.publication ?? null,
        replay: true,
      },
    };
  }

  const preflightEvent = [...journal.events].reverse().find((event) => event.eventType === "PREFLIGHTED");
  if (!preflightEvent) {
    return {
      terminal: false,
      status: "RECOVERY_REQUIRED",
      reason: "CLAIMED_WITHOUT_PREFLIGHT",
      claim: journal.claim,
    };
  }

  if (preflightEvent.status === "ACTION_REQUIRED") {
    const receipt = {
      receiptSchemaVersion: 1,
      submissionId,
      submissionContentHash: journal.claim.contentHash,
      observedAt: journal.claim.claimedAt,
      completedAt: clock(),
      processingStatus: "ACTION_REQUIRED",
      overallOutcome: "ACTION_REQUIRED",
      preflightPlan: preflightEvent.plan ?? [],
      publication: null,
      structuralLimits: CANDIDATE_STRUCTURAL_LIMITS,
      errors: preflightEvent.errors ?? [],
      recovery: { reconciledAt: clock(), reason: "STALE_SUPERSESSION_AUTHORIZATION_NOT_REUSED" },
    };
    const receiptPath = await writeReceipt(directories, receipt);
    return { terminal: true, result: { status: "ACTION_REQUIRED", receiptPath, receipt, publication: null, replay: true } };
  }

  const publishable = eligibleCanonicalBundle({
    canonicalBundle: preflightEvent.canonicalBundle,
    plan: preflightEvent.plan ?? [],
  });
  const publishedEvent = [...journal.events].reverse().find((event) => event.eventType === "PUBLISHED");
  const publication = publishedEvent?.publication
    ?? await findExactPublication(candidateInboxPath, publishable);
  const admitted = pretradeContainsPublishedCandidates(authoritativePretradeCandidates, publishable);
  if (!publication && !admitted) {
    return {
      terminal: false,
      status: "RECOVERY_REQUIRED",
      reason: "NO_PUBLICATION_OR_PRETRADE_RECEIPT",
      claim: journal.claim,
      preflight: preflightEvent,
    };
  }

  const receipt = {
    receiptSchemaVersion: 1,
    submissionId,
    submissionContentHash: journal.claim.contentHash,
    observedAt: journal.claim.claimedAt,
    completedAt: clock(),
    processingStatus: preflightEvent.status,
    overallOutcome: preflightEvent.status === "ACTION_REQUIRED"
      ? "ACTION_REQUIRED"
      : preflightEvent.status === "PARTIAL_SUCCESS"
        ? "PARTIAL_SUCCESS"
        : "SUCCESS",
    preflightPlan: preflightEvent.plan ?? [],
    publication: publication ?? null,
    structuralLimits: CANDIDATE_STRUCTURAL_LIMITS,
    errors: preflightEvent.errors ?? [],
    recovery: {
      reconciledAt: clock(),
      publicationObserved: Boolean(publication),
      pretradeAdmissionObserved: admitted,
    },
  };
  const receiptPath = await writeReceipt(directories, receipt);
  return {
    terminal: true,
    result: {
      status: receipt.overallOutcome,
      receiptPath,
      receipt,
      publication: publication ?? null,
      replay: true,
    },
  };
}

export async function processManualProposalFile(filePath, {
  manualInboxPath = path.dirname(filePath),
  candidateInboxPath,
  priorCandidates,
  pretradeUrl = DEFAULT_PRETRADE_URL,
  requestOptions = {},
  clock = nowIso,
  idFactory = () => crypto.randomUUID(),
  stableFileOptions = {},
} = {}) {
  if (!text(candidateInboxPath)) {
    throw manualError("candidateInboxPath is required for canonical publication", "MANUAL_CANDIDATE_INBOX_REQUIRED");
  }
  const directories = manualIngestionDirectories(manualInboxPath);
  const observedAt = clock();
  const publication = await readStableManualProposalBytes(filePath, stableFileOptions);
  const contentHash = sha256(publication.bytes);
  let envelope;
  try {
    envelope = parseManualIngestionEnvelopeBytes(publication.bytes);
  } catch (error) {
    const receipt = {
      receiptSchemaVersion: 1,
      submissionId: `unidentified-${contentHash.slice(0, 12)}`,
      submissionContentHash: contentHash,
      observedAt,
      completedAt: clock(),
      processingStatus: "REJECTED",
      overallOutcome: "FAILED",
      preflightPlan: [],
      publication: null,
      structuralLimits: CANDIDATE_STRUCTURAL_LIMITS,
      errors: [{ code: error.code || "MANUAL_INGESTION_INVALID_JSON", message: error.message }],
    };
    const receiptPath = await writeReceipt(directories, receipt);
    const movedTo = await moveImmutableFile(filePath, directories.quarantine, contentHash);
    return { status: "FAILED", receiptPath, receipt, publication: null, movedTo };
  }
  const submissionId = text(envelope?.submission?.submissionId);
  if (!submissionId) {
    const receipt = {
      receiptSchemaVersion: 1,
      submissionId: `unidentified-${contentHash.slice(0, 12)}`,
      submissionContentHash: contentHash,
      observedAt,
      completedAt: clock(),
      processingStatus: "REJECTED",
      overallOutcome: "FAILED",
      preflightPlan: [],
      publication: null,
      structuralLimits: CANDIDATE_STRUCTURAL_LIMITS,
      errors: [{ code: "MANUAL_SUBMISSION_ID_REQUIRED", message: "manual envelope submission.submissionId is required before durable claim" }],
    };
    const receiptPath = await writeReceipt(directories, receipt);
    const movedTo = await moveImmutableFile(filePath, directories.quarantine, contentHash);
    return { status: "FAILED", receiptPath, receipt, publication: null, movedTo };
  }
  const releaseLock = await acquireSubmissionJournalLock({
    journalDir: directories.journal,
    submissionId,
    clock,
  });
  try {
    const authoritativePriorCandidates = await resolvePretradeCandidates({
      candidates: priorCandidates,
      pretradeUrl,
      requestOptions,
    });
    const existingTerminal = await reconcileManualSubmission({
      directories,
      submissionId,
      contentHash,
      candidateInboxPath,
      pretradeCandidates: authoritativePriorCandidates,
      clock,
    }).catch((error) => {
      if (error.code === "MANUAL_RECOVERY_NOT_FOUND") return null;
      throw error;
    });
    if (existingTerminal?.terminal) {
      const movedTo = await moveImmutableFile(filePath, directories.archive, contentHash);
      return { ...existingTerminal.result, movedTo };
    }

    const claim = await claimSubmission({ directories, submissionId, contentHash, observedAt });
    await appendSubmissionJournalEvent({
      journalDir: directories.journal,
      submissionId,
      event: { eventType: "RECEIVED", occurredAt: observedAt, contentHash, claimStatus: claim.status },
    });

    const preflight = preflightManualSubmission(envelope, authoritativePriorCandidates);
    await appendSubmissionJournalEvent({
      journalDir: directories.journal,
      submissionId,
      event: {
        eventType: "PREFLIGHTED",
        occurredAt: clock(),
        status: preflight.status,
        plan: preflight.plan,
        canonicalBundle: preflight.canonicalBundle,
        errors: preflight.errors,
      },
    });

    let publicationResult = null;
    const publishable = eligibleCanonicalBundle(preflight);
    if (publishable) {
      publicationResult = await publishCandidateBundleAtomically({
        inboxPath: candidateInboxPath,
        bundle: publishable,
        idFactory,
      });
      await appendSubmissionJournalEvent({
        journalDir: directories.journal,
        submissionId,
        event: { eventType: "PUBLISHED", occurredAt: clock(), publication: publicationResult },
      });
    }
    const overallOutcome = receiptOutcomeForPreflight(preflight, publicationResult);
    const receipt = {
      receiptSchemaVersion: 1,
      submissionId,
      submissionContentHash: contentHash,
      observedAt,
      completedAt: clock(),
      processingStatus: preflight.status,
      overallOutcome,
      preflightPlan: preflight.plan,
      publication: publicationResult,
      structuralLimits: CANDIDATE_STRUCTURAL_LIMITS,
      errors: preflight.errors,
    };
    const receiptPath = await writeReceipt(directories, receipt);
    await appendSubmissionJournalEvent({
      journalDir: directories.journal,
      submissionId,
      event: { eventType: "RECEIPT_WRITTEN", occurredAt: clock(), receiptPath, overallOutcome },
    });
    const movedTo = await moveImmutableFile(
      filePath,
      overallOutcome === "FAILED" ? directories.quarantine : directories.archive,
      contentHash,
    );
    return { status: overallOutcome, receiptPath, receipt, publication: publicationResult, movedTo };
  } finally {
    await releaseLock();
  }
}

export async function listPendingManualProposalFiles(manualInboxPath) {
  const directories = manualIngestionDirectories(manualInboxPath);
  const entries = await fs.readdir(directories.inbox, { withFileTypes: true }).catch((error) => {
    throw manualError(
      `Manual Proposal Inbox is unavailable: ${error.message}`,
      "MANUAL_PROPOSAL_INBOX_UNAVAILABLE",
      { retryable: true },
    );
  });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(directories.inbox, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

export async function recoverClaimedManualSubmissions({
  manualInboxPath,
  candidateInboxPath,
  pretradeCandidates,
  pretradeUrl = DEFAULT_PRETRADE_URL,
  requestOptions = {},
  clock = nowIso,
} = {}) {
  const directories = manualIngestionDirectories(manualInboxPath);
  const authoritativePretradeCandidates = await resolvePretradeCandidates({
    candidates: pretradeCandidates,
    pretradeUrl,
    requestOptions,
  });
  const entries = await fs.readdir(directories.journal, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const results = [];
  for (const entry of entries.filter((item) => item.isDirectory() && item.name !== ".lock").sort((a, b) => a.name.localeCompare(b.name))) {
    const claimPath = path.join(directories.journal, entry.name, "claim.json");
    let claim;
    try {
      claim = await readJsonFile(claimPath, "MANUAL_JOURNAL_CORRUPT");
    } catch (error) {
      results.push({ submissionId: entry.name, status: "RECOVERY_BLOCKED", error: { code: error.code, message: error.message } });
      continue;
    }
    const releaseLock = await acquireSubmissionJournalLock({
      journalDir: directories.journal,
      submissionId: claim.submissionId,
      clock,
    }).catch((error) => {
      results.push({ submissionId: claim.submissionId || entry.name, status: "RECOVERY_BLOCKED", error: { code: error.code, message: error.message } });
      return null;
    });
    if (!releaseLock) continue;
    try {
      const reconciled = await reconcileManualSubmission({
        directories,
        submissionId: claim.submissionId,
        contentHash: claim.contentHash,
        candidateInboxPath,
        pretradeCandidates: authoritativePretradeCandidates,
        clock,
      });
      results.push({
        submissionId: claim.submissionId,
        status: reconciled.terminal ? "RECOVERED" : "RECOVERY_REQUIRED",
        result: reconciled.result ?? null,
        reason: reconciled.reason ?? null,
      });
    } catch (error) {
      results.push({ submissionId: claim.submissionId || entry.name, status: "RECOVERY_BLOCKED", error: { code: error.code, message: error.message } });
    } finally {
      await releaseLock();
    }
  }
  return { submissionsInspected: results.length, results };
}

export async function drainManualProposalInbox({
  manualInboxPath,
  candidateInboxPath,
  priorCandidates,
  pretradeCandidates = priorCandidates,
  pretradeUrl = DEFAULT_PRETRADE_URL,
  requestOptions = {},
  clock = nowIso,
  idFactory = () => crypto.randomUUID(),
  stableFileOptions = {},
  recover = true,
} = {}) {
  const authoritativePretradeCandidates = await resolvePretradeCandidates({
    candidates: priorCandidates,
    pretradeUrl,
    requestOptions,
  });
  const recoveryPretradeCandidates = await resolvePretradeCandidates({
    candidates: pretradeCandidates,
    pretradeUrl,
    requestOptions,
  });
  const files = await listPendingManualProposalFiles(manualInboxPath);
  const results = [];
  for (const filePath of files) {
    try {
      results.push({
        filePath,
        ...(await processManualProposalFile(filePath, {
          manualInboxPath,
          candidateInboxPath,
          priorCandidates: authoritativePretradeCandidates,
          pretradeUrl,
          requestOptions,
          clock,
          idFactory,
          stableFileOptions,
        })),
      });
    } catch (error) {
      if (error.code === "CANDIDATE_FILE_NOT_STABLE" || error.code === "MANUAL_PROPOSAL_FILE_NOT_STABLE") {
        results.push({ filePath, status: "PENDING_RETRY", error: { code: error.code, message: error.message } });
      } else {
        results.push({ filePath, status: "FAILED", error: { code: error.code || "MANUAL_INGESTION_ERROR", message: error.message } });
      }
    }
  }
  const recovery = recover
    ? await recoverClaimedManualSubmissions({
        manualInboxPath,
        candidateInboxPath,
        pretradeCandidates: recoveryPretradeCandidates,
        pretradeUrl,
        requestOptions,
        clock,
      })
    : null;
  return { filesDiscovered: files.length, results, recovery };
}

async function main() {
  const filePath = process.argv[2];
  const manualInboxPath = process.env.EXECUTIONOS_MANUAL_PROPOSAL_INBOX;
  const candidateInboxPath = process.env.EXECUTIONOS_CANDIDATE_INBOX;
  const result = filePath
    ? await processManualProposalFile(filePath, { candidateInboxPath, manualInboxPath: manualInboxPath || path.dirname(filePath) })
    : await drainManualProposalInbox({ manualInboxPath, candidateInboxPath });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "FAILED") process.exitCode = 1;
  if (result.status === "ACTION_REQUIRED") process.exitCode = 2;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`[ExecutionOS Manual SOD Ingestion] ${error.code || "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
}
