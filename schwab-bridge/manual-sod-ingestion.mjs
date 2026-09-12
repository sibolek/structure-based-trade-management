import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { publishCandidateBundleAtomically } from "./sod-candidate-publisher.mjs";
import {
  candidateDirectoriesFromInbox,
  DEFAULT_PRETRADE_URL,
  fetchCandidateSnapshot,
  fetchManualSupersessionDecision,
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
export const MANUAL_RECEIPT_SCHEMA_VERSION = 2;

const FINAL_OVERALL_OUTCOMES = new Set(["SUCCESS", "PARTIAL_SUCCESS", "FAILED"]);
const CANDIDATE_FEEDER_SUCCESS_STATUSES = new Set(["ACCEPTED", "DUPLICATE"]);
const CANDIDATE_FEEDER_FAILURE_STATUSES = new Set(["REJECTED", "CONFLICT", "STALE"]);
const CANDIDATE_FEEDER_RESOLUTION_STATUSES = new Set([
  ...CANDIDATE_FEEDER_SUCCESS_STATUSES,
  ...CANDIDATE_FEEDER_FAILURE_STATUSES,
  "ACTION_REQUIRED",
]);
const SUPERSESSION_OBSERVATION_STATUSES = new Set([
  "REVIEW_REQUIRED",
  "UNRESOLVED",
  "AUTHORIZED",
  "DECLINED",
  "INVALIDATED",
  "ADMITTED",
]);

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
  "declineId",
  "reviewId",
  "manualSupersessionReviews",
  "manualSupersessionReview",
  "manualSupersessionAuthorizations",
  "manualSupersessionAuthorization",
  "manualSupersessionDeclines",
  "manualSupersessionDecline",
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

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableJson(value[key]);
      return result;
    }, {});
  }
  return value;
}

function deterministicHash(value) {
  return sha256(Buffer.from(JSON.stringify(stableJson(value)), "utf8"));
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

async function appendSubmissionJournalEventRecord({ journalDir, submissionId, event, eventFactory = null }) {
  const safeSubmissionId = text(submissionId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!safeSubmissionId) throw manualError("submissionId is required for journal append", "MANUAL_JOURNAL_SUBMISSION_ID_REQUIRED");
  const submissionDir = path.join(journalDir, safeSubmissionId);
  const sequenceDir = path.join(submissionDir, "events");
  await fs.mkdir(submissionDir, { recursive: true });
  await fs.mkdir(sequenceDir, { recursive: true });
  const existingNames = (await fs.readdir(sequenceDir).catch(() => []))
    .filter((name) => name.endsWith(".json"));
  const existingSequences = new Set();
  let maximumSequence = 0;
  for (const name of existingNames) {
    const match = /^(\d{6})-[a-zA-Z0-9._-]+-[a-zA-Z0-9._-]+\.json$/.exec(name);
    if (!match) {
      throw manualError("manual submission journal contains an invalid event filename", "MANUAL_JOURNAL_CORRUPT", { submissionId, name });
    }
    const parsedSequence = Number(match[1]);
    if (!Number.isInteger(parsedSequence) || parsedSequence < 1 || existingSequences.has(parsedSequence)) {
      throw manualError("manual submission journal has ambiguous event filename sequencing", "MANUAL_JOURNAL_CORRUPT", { submissionId, name });
    }
    existingSequences.add(parsedSequence);
    maximumSequence = Math.max(maximumSequence, parsedSequence);
  }
  const sequence = maximumSequence + 1;
  if (sequence > 999999) {
    throw manualError("manual submission journal exhausted its sequence space", "MANUAL_JOURNAL_SEQUENCE_EXHAUSTED", { submissionId });
  }
  const eventId = text(event?.eventId) || crypto.randomUUID();
  if (!/^[a-zA-Z0-9._-]+$/.test(eventId)) {
    throw manualError("manual submission journal eventId is invalid", "MANUAL_JOURNAL_EVENT_INVALID");
  }
  const supplied = eventFactory ? eventFactory({ sequence, eventId }) : event;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) {
    throw manualError("manual submission journal event must be an object", "MANUAL_JOURNAL_EVENT_INVALID");
  }
  const eventType = text(supplied.eventType || "EVENT").replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!eventType) throw manualError("manual submission journal eventType is required", "MANUAL_JOURNAL_EVENT_INVALID");
  const record = { ...supplied, sequence, eventId, eventType };
  const finalPath = path.join(sequenceDir, `${String(sequence).padStart(6, "0")}-${eventType}-${eventId}.json`);
  try {
    await atomicCreateJson(finalPath, record);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw manualError("manual submission journal sequence allocation collided", "MANUAL_JOURNAL_SEQUENCE_CONFLICT", { submissionId, sequence });
    }
    throw error;
  }
  return { eventPath: finalPath, event: record };
}

export async function appendSubmissionJournalEvent(options) {
  return (await appendSubmissionJournalEventRecord(options)).eventPath;
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

function receiptIntegrityHash(receipt) {
  const material = structuredClone(receipt);
  delete material.receiptIntegrityHash;
  return deterministicHash(material);
}

function linkedReceiptPath(directories, receipt) {
  const safeSubmissionId = text(receipt.submissionId).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return path.join(
    directories.receipts,
    `${safeSubmissionId}-${text(receipt.overallOutcome)}-${text(receipt.receiptId)}.receipt.json`,
  );
}

async function writeReconciliationReceipt({ directories, submissionId, receipt }) {
  let linkedReceipt = null;
  let receiptPath = null;
  await appendSubmissionJournalEventRecord({
    journalDir: directories.journal,
    submissionId,
    eventFactory: ({ sequence, eventId }) => {
      const receiptId = crypto.randomUUID();
      linkedReceipt = {
        ...structuredClone(receipt),
        receiptSchemaVersion: MANUAL_RECEIPT_SCHEMA_VERSION,
        receiptId,
        journalSequence: sequence,
        journalEventId: eventId,
        receiptIntegrityHash: null,
      };
      linkedReceipt.receiptIntegrityHash = receiptIntegrityHash(linkedReceipt);
      receiptPath = linkedReceiptPath(directories, linkedReceipt);
      return {
        eventType: "RECONCILIATION_RECORDED",
        occurredAt: linkedReceipt.completedAt,
        submissionContentHash: linkedReceipt.submissionContentHash,
        receiptPath,
        receiptId,
        overallOutcome: linkedReceipt.overallOutcome,
        receiptIntegrityHash: linkedReceipt.receiptIntegrityHash,
        receipt: linkedReceipt,
      };
    },
  });
  await atomicCreateJson(receiptPath, linkedReceipt);
  return { receiptPath, receipt: linkedReceipt };
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
  const seenEventIds = new Set();
  for (const eventFile of eventFiles) {
    const event = await readJsonFile(eventFile, "MANUAL_JOURNAL_CORRUPT");
    const eventId = text(event.eventId);
    const eventType = text(event.eventType).replace(/[^a-zA-Z0-9._-]+/g, "-");
    const expectedName = `${String(event.sequence).padStart(6, "0")}-${eventType}-${eventId}.json`;
    if (
      !Number.isInteger(event.sequence)
      || event.sequence < 1
      || seenSequences.has(event.sequence)
      || !eventId
      || seenEventIds.has(eventId)
      || !eventType
      || path.basename(eventFile) !== expectedName
    ) {
      throw manualError("manual submission journal has ambiguous event sequence", "MANUAL_JOURNAL_CORRUPT", { submissionId });
    }
    seenSequences.add(event.sequence);
    seenEventIds.add(eventId);
    events.push(event);
  }
  events.sort((left, right) => left.sequence - right.sequence);
  return { submissionDir, claim, events };
}

function valuesEqual(left, right) {
  return JSON.stringify(stableJson(left)) === JSON.stringify(stableJson(right));
}

function assertReceiptPath(directories, receiptPath) {
  const resolved = path.resolve(text(receiptPath));
  if (!text(receiptPath) || path.dirname(resolved) !== path.resolve(directories.receipts)) {
    throw manualError("manual receipt journal linkage escapes the receipt directory", "MANUAL_RECEIPT_ORDERING_CORRUPT");
  }
  return resolved;
}

function assertLinkedReceipt(receipt, event, directories, submissionId, contentHash) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw manualError("linked manual receipt is not an object", "MANUAL_RECEIPT_ORDERING_CORRUPT");
  }
  if (
    receipt.receiptSchemaVersion !== MANUAL_RECEIPT_SCHEMA_VERSION
    || receipt.submissionId !== submissionId
    || receipt.submissionContentHash !== contentHash
    || receipt.journalSequence !== event.sequence
    || receipt.journalEventId !== event.eventId
    || !text(receipt.receiptId)
    || ![...FINAL_OVERALL_OUTCOMES, "ACTION_REQUIRED"].includes(receipt.overallOutcome)
    || receipt.receiptIntegrityHash !== receiptIntegrityHash(receipt)
    || event.receiptId !== receipt.receiptId
    || event.overallOutcome !== receipt.overallOutcome
    || event.submissionContentHash !== contentHash
    || event.receiptIntegrityHash !== receipt.receiptIntegrityHash
    || !valuesEqual(event.receipt, receipt)
  ) {
    throw manualError("manual receipt has corrupt or ambiguous journal ordering evidence", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
  }
  const receiptPath = assertReceiptPath(directories, event.receiptPath);
  if (receiptPath !== linkedReceiptPath(directories, receipt)) {
    throw manualError("manual receipt path conflicts with its journal linkage", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
  }
  return receiptPath;
}

function isAuthoritativeFinalReceipt(receipt) {
  if (!FINAL_OVERALL_OUTCOMES.has(receipt?.overallOutcome)) return false;
  // V2 receipts written immediately after publication by the prior checkpoint
  // lacked candidate outcomes. Keep them as immutable history, but do not let
  // them prevent authoritative admission reconciliation.
  if (receipt.publication && (!Array.isArray(receipt.candidateOutcomes) || !receipt.candidateOutcomes.length)) return false;
  return true;
}

async function findCurrentReceipt(directories, journal) {
  const { submissionId, contentHash } = journal.claim;
  const files = await listJsonFiles(directories.receipts);
  const receiptsByPath = new Map();
  for (const file of files) {
    receiptsByPath.set(path.resolve(file), await readJsonFile(file, "MANUAL_RECEIPT_CORRUPT"));
  }

  const linked = [];
  const linkedPaths = new Set();
  const linkedReceiptIds = new Set();
  const missingLinkedReceipts = [];
  for (const event of journal.events) {
    if (event.eventType === "RECONCILIATION_RECORDED") {
      const embedded = event.receipt;
      const receiptPath = assertLinkedReceipt(embedded, event, directories, submissionId, contentHash);
      if (linkedPaths.has(receiptPath) || linkedReceiptIds.has(embedded.receiptId)) {
        throw manualError("manual receipt is linked by multiple journal events", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
      }
      const persisted = receiptsByPath.get(receiptPath);
      if (persisted && !valuesEqual(persisted, embedded)) {
        throw manualError("persisted manual receipt conflicts with journal evidence", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
      }
      if (!persisted) missingLinkedReceipts.push({ receiptPath, receipt: embedded });
      linkedPaths.add(receiptPath);
      linkedReceiptIds.add(embedded.receiptId);
      linked.push({ sequence: event.sequence, receiptPath, receipt: embedded });
      continue;
    }
    if (event.eventType !== "RECEIPT_WRITTEN") continue;
    const receiptPath = assertReceiptPath(directories, event.receiptPath);
    if (linkedPaths.has(receiptPath)) {
      throw manualError("manual receipt path has conflicting journal links", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
    }
    const receipt = receiptsByPath.get(receiptPath);
    if (!receipt) {
      throw manualError("legacy manual receipt journal link has no receipt", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
    }
    if (
      receipt.receiptSchemaVersion !== 1
      || receipt.submissionId !== submissionId
      || receipt.submissionContentHash !== contentHash
      || receipt.overallOutcome !== event.overallOutcome
    ) {
      throw manualError("legacy manual receipt conflicts with its journal event", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
    }
    linkedPaths.add(receiptPath);
    linked.push({ sequence: event.sequence, receiptPath, receipt });
  }

  for (const [receiptPath, receipt] of receiptsByPath) {
    if (receipt.submissionId === submissionId && receipt.submissionContentHash !== contentHash) {
      throw manualError("manual receipt conflicts with the durable submission claim", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
    }
    if (
      receipt.submissionId === submissionId
      && receipt.submissionContentHash === contentHash
      && !linkedPaths.has(receiptPath)
    ) {
      throw manualError("manual receipt has no valid journal ordering link", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
    }
  }

  linked.sort((left, right) => left.sequence - right.sequence);
  const finalReconciliation = linked.find((item) => isAuthoritativeFinalReceipt(item.receipt));
  if (finalReconciliation && journal.events.some((event) => event.sequence > finalReconciliation.sequence)) {
    throw manualError("manual journal contains evidence after final reconciliation", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
  }

  for (const missing of missingLinkedReceipts) {
    try {
      await atomicCreateJson(missing.receiptPath, missing.receipt);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const raced = await readJsonFile(missing.receiptPath, "MANUAL_RECEIPT_CORRUPT");
      if (!valuesEqual(raced, missing.receipt)) {
        throw manualError("recovered manual receipt conflicts with journal evidence", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
      }
    }
  }

  return linked.at(-1) ?? null;
}

function bundleEnvelope(bundle) {
  const envelope = structuredClone(bundle);
  delete envelope.candidates;
  return envelope;
}

async function findExactCandidatePublications(
  candidateInboxPath,
  canonicalBundle,
  candidates,
  publishedKeys = new Set(),
) {
  if (!candidates.length) return [];
  const targets = new Map(candidates.map((candidate) => [candidateIdentityKey(candidateIdentity(candidate)), candidate]));
  const canonicalByKey = new Map(canonicalBundle.candidates.map((candidate) => (
    [candidateIdentityKey(candidateIdentity(candidate)), candidate]
  )));
  const located = new Map();
  const groups = new Map();
  const files = await listJsonFiles(candidateInboxPath);
  for (const file of files) {
    const bytes = await fs.readFile(file);
    let bundle;
    try {
      bundle = JSON.parse(bytes.toString("utf8"));
      assertJsonStructuralSafety(bundle, { rootName: "candidate publication" });
    } catch {
      continue;
    }
    if (
      !bundle
      || typeof bundle !== "object"
      || !Array.isArray(bundle.candidates)
      || !valuesEqual(bundleEnvelope(bundle), bundleEnvelope(canonicalBundle))
    ) continue;

    const recoveredCandidates = [];
    const recoveredKeys = new Set();
    let exactPublication = bundle.candidates.length > 0;
    try {
      for (const observedCandidate of bundle.candidates) {
        const key = candidateIdentityKey(candidateIdentity(observedCandidate));
        const canonicalCandidate = canonicalByKey.get(key);
        if (!canonicalCandidate || recoveredKeys.has(key) || !valuesEqual(observedCandidate, canonicalCandidate)) {
          exactPublication = false;
          break;
        }
        recoveredKeys.add(key);
        recoveredCandidates.push(canonicalCandidate);
      }
    } catch {
      exactPublication = false;
    }
    if (!exactPublication) continue;
    const recoveredBundle = bundleWithCandidates(canonicalBundle, recoveredCandidates);
    if (!bytes.equals(publicationBytesFor(recoveredBundle))) continue;

    const matchingTargetKeys = [...recoveredKeys].filter((key) => targets.has(key));
    if (!matchingTargetKeys.length) continue;
    if ([...recoveredKeys].some((key) => publishedKeys.has(key))) {
      throw manualError("candidate inbox duplicates existing journal publication evidence", "MANUAL_PUBLICATION_AMBIGUOUS");
    }
    for (const key of matchingTargetKeys) {
      if (located.has(key)) {
        throw manualError("candidate inbox contains more than one exact candidate publication", "MANUAL_PUBLICATION_AMBIGUOUS");
      }
      located.set(key, file);
    }
    groups.set(file, {
      publication: {
        publicationId: null,
        finalPath: file,
        finalName: path.basename(file),
        sha256: sha256(bytes),
        byteLength: bytes.length,
        recoveredFromCandidateInbox: true,
      },
      candidates: recoveredCandidates,
    });
  }
  return [...groups.values()];
}

function candidateIdentity(candidate) {
  return {
    candidateId: candidate.candidateId,
    contractVersion: Number(candidate.contractVersion),
    contentHash: candidateContractHash(candidate),
  };
}

function candidateIdentityKey(identity) {
  return `${text(identity?.candidateId)}:v${Number(identity?.contractVersion)}:${text(identity?.contentHash)}`;
}

function exactAdmittedCandidate(pretradeCandidates, candidate) {
  const identity = candidateIdentity(candidate);
  return (Array.isArray(pretradeCandidates) ? pretradeCandidates : []).find((existing) => (
    existing?.candidateId === identity.candidateId
    && Number(existing?.contractVersion) === identity.contractVersion
    && text(existing?.contentHash) === identity.contentHash
  )) ?? null;
}

function bundleWithCandidates(canonicalBundle, candidates) {
  return { ...structuredClone(canonicalBundle), candidates: candidates.map((candidate) => structuredClone(candidate)) };
}

function publishedCandidateEvidence(journal, preflightEvent) {
  const canonicalCandidates = preflightEvent.canonicalBundle?.candidates ?? [];
  const canonicalByKey = new Map(canonicalCandidates.map((candidate) => [candidateIdentityKey(candidateIdentity(candidate)), candidate]));
  const legacyPublishable = eligibleCanonicalBundle({
    canonicalBundle: preflightEvent.canonicalBundle,
    plan: preflightEvent.plan ?? [],
  });
  const published = new Map();
  for (const event of journal.events.filter((item) => item.eventType === "PUBLISHED")) {
    if (!event.publication || typeof event.publication !== "object") {
      throw manualError("manual journal PUBLISHED event lacks publication evidence", "MANUAL_JOURNAL_CORRUPT", { submissionId: journal.claim.submissionId });
    }
    const identities = Array.isArray(event.candidateIdentities)
      ? event.candidateIdentities
      : (legacyPublishable?.candidates ?? []).map(candidateIdentity);
    if (!identities.length) {
      throw manualError("manual journal PUBLISHED event has no candidate identity", "MANUAL_JOURNAL_CORRUPT", { submissionId: journal.claim.submissionId });
    }
    const eventCandidates = [];
    for (const identity of identities) {
      const key = candidateIdentityKey(identity);
      const canonicalCandidate = canonicalByKey.get(key);
      if (!canonicalCandidate || published.has(key) || !valuesEqual(identity, candidateIdentity(canonicalCandidate))) {
        throw manualError("manual journal has ambiguous candidate publication evidence", "MANUAL_JOURNAL_CORRUPT", { submissionId: journal.claim.submissionId });
      }
      eventCandidates.push(canonicalCandidate);
    }
    const finalName = text(event.publication.finalName);
    const finalPath = text(event.publication.finalPath);
    const expectedBytes = publicationBytesFor(bundleWithCandidates(preflightEvent.canonicalBundle, eventCandidates));
    if (
      !finalName
      || path.basename(finalName) !== finalName
      || !finalPath
      || path.basename(finalPath) !== finalName
      || !/^[0-9a-f]{64}$/.test(text(event.publication.sha256))
      || event.publication.sha256 !== sha256(expectedBytes)
      || !Number.isInteger(event.publication.byteLength)
      || event.publication.byteLength !== expectedBytes.length
    ) {
      throw manualError("manual journal PUBLISHED event conflicts with canonical publication", "MANUAL_JOURNAL_CORRUPT", { submissionId: journal.claim.submissionId });
    }
    for (const candidate of eventCandidates) {
      const key = candidateIdentityKey(candidateIdentity(candidate));
      published.set(key, {
        candidate,
        publication: structuredClone(event.publication),
        journalSequence: event.sequence,
      });
    }
  }
  return published;
}

function candidateFeederPublicationKey(publication) {
  return `${text(publication?.finalName)}:${text(publication?.sha256)}`;
}

function addCandidateFeederEvidence(evidenceByCandidate, candidateKey, evidence) {
  if (!evidenceByCandidate.has(candidateKey)) evidenceByCandidate.set(candidateKey, []);
  evidenceByCandidate.get(candidateKey).push(evidence);
}

async function loadCandidateFeederEvidence({ candidateInboxPath, publishedByCandidate, canonicalBundle }) {
  const publications = new Map();
  for (const [candidateKey, evidence] of publishedByCandidate) {
    const publicationKey = candidateFeederPublicationKey(evidence.publication);
    if (!publications.has(publicationKey)) {
      publications.set(publicationKey, {
        publication: evidence.publication,
        candidatesByVersion: new Map(),
      });
    }
    const versionKey = `${evidence.candidate.candidateId}:v${evidence.candidate.contractVersion}`;
    const group = publications.get(publicationKey);
    if (group.candidatesByVersion.has(versionKey)) {
      throw manualError("manual journal publication has duplicate candidate version evidence", "MANUAL_JOURNAL_CORRUPT");
    }
    group.candidatesByVersion.set(versionKey, { candidateKey, candidate: evidence.candidate });
  }

  const evidenceByCandidate = new Map();
  const receiptDirectory = candidateDirectoriesFromInbox(candidateInboxPath).receipts;
  for (const receiptPath of await listJsonFiles(receiptDirectory)) {
    const receipt = await readJsonFile(receiptPath, "MANUAL_CANDIDATE_FEEDER_RECEIPT_CORRUPT");
    try {
      assertJsonStructuralSafety(receipt, { rootName: "candidate feeder receipt" });
    } catch (error) {
      throw manualError(error.message, "MANUAL_CANDIDATE_FEEDER_RECEIPT_CORRUPT", { receiptPath });
    }
    const publicationKey = `${text(receipt.bundleFile)}:${text(receipt.bundleSha256)}`;
    const publication = publications.get(publicationKey);
    if (!publication) continue;
    if (
      receipt.transportSchemaVersion !== 1
      || receipt.bundleId !== canonicalBundle.bundleId
      || receipt.bundleFile !== publication.publication.finalName
      || receipt.bundleSha256 !== publication.publication.sha256
      || receipt.brokerWriteAuthority !== false
    ) {
      throw manualError("candidate feeder receipt conflicts with journal publication evidence", "MANUAL_CANDIDATE_FEEDER_RECEIPT_CORRUPT", { receiptPath });
    }

    const receiptEvidence = {
      receiptPath,
      receiptSha256: await hashFile(receiptPath),
    };
    if (receipt.error) {
      if (
        receipt.disposition !== "QUARANTINE"
        || !text(receipt.error.code)
        || (Array.isArray(receipt.candidates) && receipt.candidates.length)
      ) {
        throw manualError("candidate feeder failure receipt is ambiguous", "MANUAL_CANDIDATE_FEEDER_RECEIPT_CORRUPT", { receiptPath });
      }
      for (const { candidateKey } of publication.candidatesByVersion.values()) {
        addCandidateFeederEvidence(evidenceByCandidate, candidateKey, {
          ...receiptEvidence,
          status: "REJECTED",
          reasons: [text(receipt.error.code)],
          transportError: true,
        });
      }
      continue;
    }

    if (receipt.pretradeServiceVerified !== true || !Array.isArray(receipt.candidates)) {
      throw manualError("candidate feeder receipt lacks PRETRADE outcome evidence", "MANUAL_CANDIDATE_FEEDER_RECEIPT_CORRUPT", { receiptPath });
    }
    const seenCandidates = new Set();
    const observedStatuses = [];
    for (const candidate of receipt.candidates) {
      const versionKey = `${text(candidate?.candidateId)}:v${Number(candidate?.contractVersion)}`;
      const expected = publication.candidatesByVersion.get(versionKey);
      const status = text(candidate?.ingressStatus);
      if (
        !expected
        || seenCandidates.has(versionKey)
        || !CANDIDATE_FEEDER_RESOLUTION_STATUSES.has(status)
        || candidate.verified !== true
      ) {
        throw manualError("candidate feeder receipt has invalid candidate outcome evidence", "MANUAL_CANDIDATE_FEEDER_RECEIPT_CORRUPT", { receiptPath });
      }
      seenCandidates.add(versionKey);
      observedStatuses.push(status);
      addCandidateFeederEvidence(evidenceByCandidate, expected.candidateKey, {
        ...receiptEvidence,
        status,
        reasons: Array.isArray(candidate.reasons) ? candidate.reasons.map(text).filter(Boolean) : [],
        transportError: false,
      });
    }
    const expectedDisposition = observedStatuses.every((status) => CANDIDATE_FEEDER_SUCCESS_STATUSES.has(status))
      ? "ARCHIVE"
      : "QUARANTINE";
    if (seenCandidates.size !== publication.candidatesByVersion.size || receipt.disposition !== expectedDisposition) {
      throw manualError("candidate feeder receipt does not cover its exact publication", "MANUAL_CANDIDATE_FEEDER_RECEIPT_CORRUPT", { receiptPath });
    }
  }
  return evidenceByCandidate;
}

function resolveCandidateFeederEvidence(records, admitted) {
  if (!Array.isArray(records) || !records.length) return null;
  const statuses = new Set(records.map((record) => record.status));
  const successStatuses = [...statuses].filter((status) => CANDIDATE_FEEDER_SUCCESS_STATUSES.has(status));
  const nonSuccessStatuses = [...statuses].filter((status) => !CANDIDATE_FEEDER_SUCCESS_STATUSES.has(status));
  if (successStatuses.length && nonSuccessStatuses.length) {
    throw manualError("candidate feeder receipts contain conflicting success and failure evidence", "MANUAL_CANDIDATE_FEEDER_EVIDENCE_AMBIGUOUS");
  }
  if (nonSuccessStatuses.length > 1) {
    throw manualError("candidate feeder receipts contain conflicting terminal outcomes", "MANUAL_CANDIDATE_FEEDER_EVIDENCE_AMBIGUOUS");
  }
  if (successStatuses.length && !admitted) {
    throw manualError("candidate feeder success is not present in authoritative PRETRADE state", "MANUAL_CANDIDATE_FEEDER_EVIDENCE_AMBIGUOUS");
  }
  if (nonSuccessStatuses.length && admitted) {
    throw manualError("candidate feeder failure conflicts with authoritative PRETRADE state", "MANUAL_CANDIDATE_FEEDER_EVIDENCE_AMBIGUOUS");
  }
  const status = successStatuses.includes("ACCEPTED")
    ? "ACCEPTED"
    : successStatuses.includes("DUPLICATE")
      ? "DUPLICATE"
      : nonSuccessStatuses[0];
  const receipts = records
    .map(({ receiptPath, receiptSha256 }) => ({ receiptPath, receiptSha256 }))
    .sort((left, right) => left.receiptPath.localeCompare(right.receiptPath));
  return {
    status,
    reasons: [...new Set(records.flatMap((record) => record.reasons))].sort(),
    receipts,
  };
}

async function appendPublishedEvent({ directories, submissionId, publication, bundle, clock }) {
  await appendSubmissionJournalEvent({
    journalDir: directories.journal,
    submissionId,
    event: {
      eventType: "PUBLISHED",
      occurredAt: clock(),
      publication,
      candidateIdentities: bundle.candidates.map(candidateIdentity),
    },
  });
}

async function observeSupersessionDecision({ candidate, observer, pretradeUrl, requestOptions } = {}) {
  const observation = observer
    ? await observer(structuredClone(candidate))
    : await fetchManualSupersessionDecision(candidate, pretradeUrl, requestOptions);
  const identity = candidateIdentity(candidate);
  if (!observation || typeof observation !== "object" || !SUPERSESSION_OBSERVATION_STATUSES.has(observation.status)) {
    throw manualError("PRETRADE returned an invalid supersession observation", "MANUAL_SUPERSESSION_OBSERVATION_INVALID");
  }
  if (["UNRESOLVED", "AUTHORIZED", "DECLINED", "INVALIDATED"].includes(observation.status)) {
    const binding = observation.binding;
    if (
      !binding
      || typeof binding !== "object"
      || !text(binding.candidateId)
      || !Number.isInteger(binding.priorContractVersion)
      || binding.priorContractVersion < 1
      || !text(binding.priorLifecycleState)
      || !Number.isInteger(binding.priorStateRevision)
      || binding.priorStateRevision < 0
      || !/^[0-9a-f]{64}$/.test(text(binding.priorContentHash))
      || !Number.isInteger(binding.proposedContractVersion)
      || binding.proposedContractVersion !== binding.priorContractVersion + 1
      || !/^[0-9a-f]{64}$/.test(text(binding.proposedContentHash))
    ) {
      throw manualError("PRETRADE supersession observation lacks an exact state-bound decision", "MANUAL_SUPERSESSION_OBSERVATION_INVALID");
    }
  }
  const observedCandidateId = observation.binding?.candidateId ?? observation.candidateId;
  const observedVersion = observation.binding?.proposedContractVersion ?? observation.proposedContractVersion;
  const observedHash = observation.binding?.proposedContentHash ?? observation.proposedContentHash;
  if (
    observedCandidateId !== identity.candidateId
    || Number(observedVersion) !== identity.contractVersion
    || observedHash !== identity.contentHash
  ) {
    throw manualError("PRETRADE supersession observation does not match the journaled candidate", "MANUAL_SUPERSESSION_OBSERVATION_INVALID");
  }
  if (observation.status === "AUTHORIZED" && (!text(observation.reviewId) || !text(observation.authorizationId))) {
    throw manualError("PRETRADE authorization observation lacks durable provenance", "MANUAL_SUPERSESSION_OBSERVATION_INVALID");
  }
  if (observation.status === "DECLINED" && (!text(observation.reviewId) || !text(observation.declineId))) {
    throw manualError("PRETRADE decline observation lacks durable provenance", "MANUAL_SUPERSESSION_OBSERVATION_INVALID");
  }
  return observation;
}

function reconciliationFingerprint(receipt) {
  return deterministicHash({
    overallOutcome: receipt.overallOutcome,
    processingStatus: receipt.processingStatus,
    preflightPlan: receipt.preflightPlan,
    candidateOutcomes: receipt.candidateOutcomes ?? [],
    publication: receipt.publication ?? null,
    errors: receipt.errors ?? [],
  });
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
  supersessionDecisionObserver = null,
  clock = nowIso,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  const journal = await loadSubmissionJournal({ directories, submissionId, contentHash });
  const currentReceipt = await findCurrentReceipt(directories, journal);
  if (currentReceipt && isAuthoritativeFinalReceipt(currentReceipt.receipt)) {
    if (journal.events.some((event) => event.sequence > currentReceipt.sequence)) {
      throw manualError("manual journal contains progress after final reconciliation", "MANUAL_RECEIPT_ORDERING_CORRUPT", { submissionId });
    }
    return {
      terminal: true,
      result: {
        status: currentReceipt.receipt.overallOutcome,
        receiptPath: currentReceipt.receiptPath,
        receipt: currentReceipt.receipt,
        publication: currentReceipt.receipt.publication ?? null,
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
  if (!preflightEvent.canonicalBundle || !Array.isArray(preflightEvent.canonicalBundle.candidates)) {
    throw manualError("manual submission PREFLIGHTED event lacks a canonical bundle", "MANUAL_JOURNAL_CORRUPT", { submissionId });
  }

  const authoritativePretradeCandidates = await resolvePretradeCandidates({
    candidates: pretradeCandidates,
    pretradeUrl,
    requestOptions,
  });
  const publishedByCandidate = publishedCandidateEvidence(journal, preflightEvent);
  const publishedKeys = new Set(publishedByCandidate.keys());
  const candidateFeederEvidence = await loadCandidateFeederEvidence({
    candidateInboxPath,
    publishedByCandidate,
    canonicalBundle: preflightEvent.canonicalBundle,
  });
  const canonicalByCandidateVersion = new Map(preflightEvent.canonicalBundle.candidates.map((candidate) => (
    [`${candidate.candidateId}:v${candidate.contractVersion}`, candidate]
  )));
  const candidateOutcomes = [];
  const publishCandidates = [];
  const outcomeByIdentity = new Map();
  let unresolvedAction = false;
  let pendingAdmission = false;

  for (const planItem of preflightEvent.plan ?? []) {
    const key = `${planItem.candidateId}:v${planItem.contractVersion}`;
    const candidate = canonicalByCandidateVersion.get(key) ?? null;
    if (!candidate) {
      const status = ["REJECTED", "CONFLICT", "STALE"].includes(planItem.preflightStatus)
        ? planItem.preflightStatus
        : "REJECTED";
      candidateOutcomes.push({
        candidateId: planItem.candidateId ?? null,
        contractVersion: planItem.contractVersion ?? null,
        status,
        reasons: planItem.reasons ?? [],
      });
      continue;
    }

    const identity = candidateIdentity(candidate);
    const identityKey = candidateIdentityKey(identity);
    const admitted = exactAdmittedCandidate(authoritativePretradeCandidates, candidate);
    const feederResolution = resolveCandidateFeederEvidence(candidateFeederEvidence.get(identityKey), admitted);
    const feederOutcome = feederResolution
      ? {
          candidateFeederEvidence: {
            ingressStatus: feederResolution.status,
            receipts: feederResolution.receipts,
          },
        }
      : {};
    let outcome;
    if (feederResolution && CANDIDATE_FEEDER_FAILURE_STATUSES.has(feederResolution.status)) {
      outcome = {
        ...identity,
        status: feederResolution.status,
        reasons: feederResolution.reasons,
        ...feederOutcome,
      };
    } else if (admitted) {
      outcome = {
        ...identity,
        status: feederResolution?.status
          ?? (planItem.classification === "UNCHANGED" ? "UNCHANGED" : "ACCEPTED"),
        observedLifecycleState: admitted.lifecycleState ?? null,
        observedStateRevision: Number.isInteger(admitted.stateRevision) ? admitted.stateRevision : null,
        ...feederOutcome,
      };
    } else if (feederResolution?.status === "ACTION_REQUIRED") {
      unresolvedAction = true;
      outcome = {
        ...identity,
        status: "ACTION_REQUIRED",
        reasons: feederResolution.reasons.length ? feederResolution.reasons : ["ACTION_REQUIRED"],
        ...feederOutcome,
      };
    } else if (planItem.classification === SOD_LINEAGE_REVISED) {
      const observation = (!supersessionDecisionObserver && Array.isArray(pretradeCandidates))
        ? { status: "REVIEW_REQUIRED", ...identity, proposedContractVersion: identity.contractVersion, proposedContentHash: identity.contentHash }
        : await observeSupersessionDecision({
            candidate,
            observer: supersessionDecisionObserver,
            pretradeUrl,
            requestOptions,
          });
      if (observation.status === "DECLINED") {
        outcome = {
          ...identity,
          status: "SUPERSESSION_DECLINED",
          reviewId: observation.reviewId,
          declineId: observation.declineId,
        };
      } else if (observation.status === "ADMITTED") {
        outcome = {
          ...identity,
          status: "ACCEPTED",
          observedLifecycleState: observation.lifecycleState ?? null,
          observedStateRevision: Number.isInteger(observation.stateRevision) ? observation.stateRevision : null,
        };
      } else if (observation.status === "AUTHORIZED") {
        outcome = {
          ...identity,
          status: publishedKeys.has(identityKey) ? "PENDING_ADMISSION" : "AUTHORIZED_FOR_PUBLICATION",
          reviewId: observation.reviewId,
          authorizationId: observation.authorizationId,
        };
        if (publishedKeys.has(identityKey)) pendingAdmission = true;
        else publishCandidates.push(candidate);
      } else {
        unresolvedAction = true;
        outcome = {
          ...identity,
          status: observation.status === "INVALIDATED" ? "SUPERSESSION_INVALIDATED" : "ACTION_REQUIRED",
          ...(observation.reviewId ? { reviewId: observation.reviewId } : {}),
          reasons: [observation.reasonCode ?? observation.status],
        };
      }
    } else if (planItem.classification === "UNCHANGED") {
      if (publishedKeys.has(identityKey)) {
        pendingAdmission = true;
        outcome = { ...identity, status: "PENDING_ADMISSION" };
      } else {
        outcome = { ...identity, status: "STALE", reasons: ["UNCHANGED_PRETRADE_CANDIDATE_NOT_FOUND"] };
      }
    } else if (publishedKeys.has(identityKey)) {
      pendingAdmission = true;
      outcome = { ...identity, status: "PENDING_ADMISSION" };
    } else {
      outcome = { ...identity, status: "ELIGIBLE_FOR_PUBLICATION" };
      publishCandidates.push(candidate);
    }
    candidateOutcomes.push(outcome);
    outcomeByIdentity.set(identityKey, outcome);
  }

  const eligibleAfterFreshAuthorityCheck = [];
  for (const candidate of publishCandidates) {
    const identity = candidateIdentity(candidate);
    const outcome = outcomeByIdentity.get(candidateIdentityKey(identity));
    const planItem = (preflightEvent.plan ?? []).find((item) => (
      item.candidateId === candidate.candidateId && Number(item.contractVersion) === Number(candidate.contractVersion)
    ));
    if (planItem?.classification !== SOD_LINEAGE_REVISED) {
      eligibleAfterFreshAuthorityCheck.push(candidate);
      continue;
    }
    const observation = await observeSupersessionDecision({
      candidate,
      observer: supersessionDecisionObserver,
      pretradeUrl,
      requestOptions,
    });
    if (observation.status === "AUTHORIZED") {
      eligibleAfterFreshAuthorityCheck.push(candidate);
      continue;
    }
    if (observation.status === "ADMITTED") {
      outcome.status = "ACCEPTED";
      outcome.observedLifecycleState = observation.lifecycleState ?? null;
      outcome.observedStateRevision = Number.isInteger(observation.stateRevision) ? observation.stateRevision : null;
      continue;
    }
    if (observation.status === "DECLINED") {
      outcome.status = "SUPERSESSION_DECLINED";
    } else {
      unresolvedAction = true;
      outcome.status = observation.status === "INVALIDATED" ? "SUPERSESSION_INVALIDATED" : "ACTION_REQUIRED";
    }
    if (observation.declineId) outcome.declineId = observation.declineId;
    if (observation.reviewId) outcome.reviewId = observation.reviewId;
    delete outcome.authorizationId;
  }

  if (eligibleAfterFreshAuthorityCheck.length) {
    const recoveredPublications = await findExactCandidatePublications(
      candidateInboxPath,
      preflightEvent.canonicalBundle,
      eligibleAfterFreshAuthorityCheck,
      publishedKeys,
    );
    const recoveredKeys = new Set();
    for (const recovered of recoveredPublications) {
      const recoveredBundle = bundleWithCandidates(preflightEvent.canonicalBundle, recovered.candidates);
      await appendPublishedEvent({
        directories,
        submissionId,
        publication: recovered.publication,
        bundle: recoveredBundle,
        clock,
      });
      for (const candidate of recovered.candidates) recoveredKeys.add(candidateIdentityKey(candidateIdentity(candidate)));
    }
    const remainingCandidates = eligibleAfterFreshAuthorityCheck.filter((candidate) => (
      !recoveredKeys.has(candidateIdentityKey(candidateIdentity(candidate)))
    ));
    let publication = recoveredPublications.at(-1)?.publication ?? null;
    if (remainingCandidates.length) {
      const bundle = bundleWithCandidates(preflightEvent.canonicalBundle, remainingCandidates);
      publication = await publishCandidateBundleAtomically({
        inboxPath: candidateInboxPath,
        bundle,
        idFactory,
      });
      await appendPublishedEvent({ directories, submissionId, publication, bundle, clock });
    }
    return {
      terminal: false,
      status: "RECOVERY_REQUIRED",
      reason: "PUBLICATION_AWAITING_CANDIDATE_FEEDER",
      claim: journal.claim,
      preflight: preflightEvent,
      publication,
    };
  }

  if (pendingAdmission || candidateOutcomes.some((outcome) => outcome.status === "PENDING_ADMISSION")) {
    return {
      terminal: false,
      status: "RECOVERY_REQUIRED",
      reason: "CANDIDATE_FEEDER_ADMISSION_PENDING",
      claim: journal.claim,
      preflight: preflightEvent,
    };
  }

  const hasSupersessionProgress = candidateOutcomes.some((outcome) => {
    const planItem = (preflightEvent.plan ?? []).find((item) => (
      item.candidateId === outcome.candidateId && Number(item.contractVersion) === Number(outcome.contractVersion)
    ));
    return planItem?.classification === SOD_LINEAGE_REVISED
      && ["ACCEPTED", "DUPLICATE", "SUPERSESSION_DECLINED", "SUPERSESSION_INVALIDATED"].includes(outcome.status);
  });
  if (
    currentReceipt?.receipt.overallOutcome === "ACTION_REQUIRED"
    && !hasSupersessionProgress
    && candidateOutcomes.every((outcome) => !["ELIGIBLE_FOR_PUBLICATION", "AUTHORIZED_FOR_PUBLICATION"].includes(outcome.status))
  ) {
    return {
      terminal: true,
      result: {
        status: "ACTION_REQUIRED",
        receiptPath: currentReceipt.receiptPath,
        receipt: currentReceipt.receipt,
        publication: currentReceipt.receipt.publication ?? null,
        replay: true,
      },
    };
  }

  const hasFinalFailure = candidateOutcomes.some((outcome) => ["REJECTED", "CONFLICT", "STALE"].includes(outcome.status));
  const hasResolvedCandidate = candidateOutcomes.some((outcome) => ["ACCEPTED", "DUPLICATE", "UNCHANGED", "SUPERSESSION_DECLINED"].includes(outcome.status));
  const overallOutcome = unresolvedAction
    ? "ACTION_REQUIRED"
    : hasFinalFailure
      ? (hasResolvedCandidate ? "PARTIAL_SUCCESS" : "FAILED")
      : "SUCCESS";
  const publicationEvents = journal.events
    .filter((event) => event.eventType === "PUBLISHED")
    .map((event) => structuredClone(event.publication));
  const receipt = {
    submissionId,
    submissionContentHash: journal.claim.contentHash,
    observedAt: journal.claim.claimedAt,
    completedAt: clock(),
    processingStatus: overallOutcome === "ACTION_REQUIRED" ? "ACTION_REQUIRED" : "COMPLETED",
    overallOutcome,
    preflightPlan: (preflightEvent.plan ?? []).map((item) => {
      const outcome = candidateOutcomes.find((candidateOutcome) => (
        candidateOutcome.candidateId === item.candidateId
        && Number(candidateOutcome.contractVersion) === Number(item.contractVersion)
      ));
      return { ...structuredClone(item), resolutionStatus: outcome?.status ?? item.preflightStatus };
    }),
    candidateOutcomes,
    publication: publicationEvents.at(-1) ?? currentReceipt?.receipt.publication ?? null,
    publications: publicationEvents,
    structuralLimits: CANDIDATE_STRUCTURAL_LIMITS,
    errors: preflightEvent.errors ?? [],
    recovery: {
      reconciledAt: clock(),
      publicationObserved: publicationEvents.length > 0,
      pretradeAdmissionObserved: candidateOutcomes.some((outcome) => ["ACCEPTED", "DUPLICATE"].includes(outcome.status)),
      candidateFeederResolutionObserved: candidateOutcomes.some((outcome) => outcome.candidateFeederEvidence),
      supersessionResolutionObserved: candidateOutcomes.some((outcome) => ["ACCEPTED", "DUPLICATE", "SUPERSESSION_DECLINED", "SUPERSESSION_INVALIDATED"].includes(outcome.status)),
    },
  };
  if (currentReceipt && reconciliationFingerprint(currentReceipt.receipt) === reconciliationFingerprint(receipt)) {
    return {
      terminal: true,
      result: {
        status: currentReceipt.receipt.overallOutcome,
        receiptPath: currentReceipt.receiptPath,
        receipt: currentReceipt.receipt,
        publication: currentReceipt.receipt.publication ?? null,
        replay: true,
      },
    };
  }
  const written = await writeReconciliationReceipt({ directories, submissionId, receipt });
  return {
    terminal: true,
    result: {
      status: written.receipt.overallOutcome,
      receiptPath: written.receiptPath,
      receipt: written.receipt,
      publication: written.receipt.publication ?? null,
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
  supersessionDecisionObserver = null,
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
    const decisionObserver = supersessionDecisionObserver
      ?? (!Array.isArray(priorCandidates)
        ? (candidate) => fetchManualSupersessionDecision(candidate, pretradeUrl, requestOptions)
        : null);
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
      pretradeUrl,
      requestOptions,
      supersessionDecisionObserver: decisionObserver,
      clock,
      idFactory,
    }).catch((error) => {
      if (error.code === "MANUAL_RECOVERY_NOT_FOUND") return null;
      throw error;
    });
    if (existingTerminal?.terminal) {
      const movedTo = await moveImmutableFile(filePath, directories.archive, contentHash);
      return { ...existingTerminal.result, movedTo };
    }
    if (existingTerminal && existingTerminal.reason !== "CLAIMED_WITHOUT_PREFLIGHT") {
      const movedTo = await moveImmutableFile(filePath, directories.archive, contentHash);
      return {
        status: existingTerminal.status,
        recoveryReason: existingTerminal.reason,
        publication: existingTerminal.publication ?? null,
        replay: true,
        movedTo,
      };
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
      await appendPublishedEvent({
        directories,
        submissionId,
        publication: publicationResult,
        bundle: publishable,
        clock,
      });
    }
    if (publicationResult && preflight.status !== "ACTION_REQUIRED") {
      const movedTo = await moveImmutableFile(filePath, directories.archive, contentHash);
      return {
        status: "RECOVERY_REQUIRED",
        recoveryReason: "PUBLICATION_AWAITING_CANDIDATE_FEEDER",
        publication: publicationResult,
        replay: false,
        movedTo,
      };
    }
    const overallOutcome = receiptOutcomeForPreflight(preflight, publicationResult);
    const receipt = {
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
    const written = await writeReconciliationReceipt({ directories, submissionId, receipt });
    const movedTo = await moveImmutableFile(
      filePath,
      overallOutcome === "FAILED" ? directories.quarantine : directories.archive,
      contentHash,
    );
    return {
      status: overallOutcome,
      receiptPath: written.receiptPath,
      receipt: written.receipt,
      publication: publicationResult,
      movedTo,
    };
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
  supersessionDecisionObserver = null,
  clock = nowIso,
  idFactory = () => crypto.randomUUID(),
} = {}) {
  const directories = manualIngestionDirectories(manualInboxPath);
  const decisionObserver = supersessionDecisionObserver
    ?? (!Array.isArray(pretradeCandidates)
      ? (candidate) => fetchManualSupersessionDecision(candidate, pretradeUrl, requestOptions)
      : null);
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
        pretradeCandidates,
        pretradeUrl,
        requestOptions,
        supersessionDecisionObserver: decisionObserver,
        clock,
        idFactory,
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
  supersessionDecisionObserver = null,
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
  const decisionObserver = supersessionDecisionObserver
    ?? (!Array.isArray(priorCandidates)
      ? (candidate) => fetchManualSupersessionDecision(candidate, pretradeUrl, requestOptions)
      : null);
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
          supersessionDecisionObserver: decisionObserver,
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
        pretradeCandidates,
        pretradeUrl,
        requestOptions,
        supersessionDecisionObserver: decisionObserver,
        clock,
        idFactory,
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
