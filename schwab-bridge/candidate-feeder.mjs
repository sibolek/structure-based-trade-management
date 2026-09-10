import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsConstants from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AUTOMATED_UNTOUCHED_ONLY, MANUAL_AUTHORIZED } from "./pretrade-candidate-ingress.mjs";

export const CANDIDATE_FEEDER_TRANSPORT_SCHEMA_VERSION = 1;
export const CANDIDATE_FEEDER_SOURCE = "SOD_A_PLUS_TRADES";
export const DEFAULT_PRETRADE_URL = "http://127.0.0.1:8788";
export const MAX_CANDIDATE_BUNDLE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const TERMINAL_CANONICAL_STATUSES = new Set(["REJECTED", "CONFLICT", "STALE"]);
const SUCCESS_CANONICAL_STATUSES = new Set(["ACCEPTED", "DUPLICATE"]);
const RECOGNIZED_FEEDER_POLICIES = new Set([AUTOMATED_UNTOUCHED_ONLY, MANUAL_AUTHORIZED]);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function feederError(message, code, { retryable = false, details = null } = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  error.details = details;
  return error;
}

function retryableFinalizationError(error) {
  return feederError(
    `Candidate feeder could not finalize receipt/archive state: ${error.message}`,
    "CANDIDATE_FEEDER_FINALIZATION_ERROR",
    { retryable: true, details: { causeCode: error.code || null } },
  );
}

function statFingerprint(stat) {
  return `${stat.size}:${stat.mtimeMs}`;
}

function safeTimestamp(value) {
  return text(value).replace(/[:.]/g, "-");
}

function assertLoopbackPretradeUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw feederError("PRETRADE URL must be a valid absolute URL", "INVALID_PRETRADE_URL");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw feederError(
      "Candidate feeder PRETRADE URL must use loopback HTTP only",
      "NON_LOOPBACK_PRETRADE_URL",
    );
  }
  return parsed;
}

async function requestBytes(url, {
  method = "GET",
  body = null,
  headers = {},
  timeoutMs = 3000,
} = {}) {
  const parsed = assertLoopbackPretradeUrl(url);
  const requestHeaders = { ...headers };
  if (body !== null) requestHeaders["content-length"] = Buffer.byteLength(body);

  return new Promise((resolve, reject) => {
    let settled = false;
    const req = http.request(parsed, { method, headers: requestHeaders }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          settled = true;
          reject(feederError(
            "PRETRADE response exceeded feeder response limit",
            "PRETRADE_RESPONSE_TOO_LARGE",
            { retryable: true },
          ));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: Number(res.statusCode || 0),
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      reject(feederError(
        `PRETRADE request timed out after ${timeoutMs}ms`,
        "PRETRADE_TIMEOUT",
        { retryable: true },
      ));
      req.destroy();
    });

    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (error?.retryable) {
        reject(error);
        return;
      }
      reject(feederError(
        `PRETRADE transport failure: ${error.message}`,
        "PRETRADE_TRANSPORT_ERROR",
        { retryable: true, details: { causeCode: error.code || null } },
      ));
    });

    if (body !== null) req.write(body);
    req.end();
  });
}

function parseResponseJson(response, code) {
  try {
    return response.body.length ? JSON.parse(response.body.toString("utf8")) : {};
  } catch {
    throw feederError("PRETRADE returned invalid JSON", code, { retryable: true });
  }
}

async function getJson(url, options = {}) {
  const response = await requestBytes(url, options);
  return { ...response, json: parseResponseJson(response, "PRETRADE_INVALID_JSON_RESPONSE") };
}

export async function waitForStableFile(filePath, {
  initialDelayMs = 250,
  intervalMs = 200,
  stableChecks = 2,
  maxChecks = 8,
  sleepFn = sleep,
} = {}) {
  if (initialDelayMs > 0) await sleepFn(initialDelayMs);

  let previous = null;
  let stableCount = 0;
  for (let check = 0; check < maxChecks; check += 1) {
    let current;
    try {
      current = await fs.stat(filePath);
    } catch (error) {
      throw feederError(
        `Candidate publication is not locally readable: ${error.message}`,
        "CANDIDATE_FILE_UNAVAILABLE",
        { retryable: true },
      );
    }

    if (!current.isFile()) {
      throw feederError("Candidate publication must be a regular file", "INVALID_CANDIDATE_FILE");
    }

    const fingerprint = statFingerprint(current);
    if (fingerprint === previous) stableCount += 1;
    else stableCount = 0;
    previous = fingerprint;

    if (stableCount >= stableChecks) return current;
    if (check + 1 < maxChecks && intervalMs > 0) await sleepFn(intervalMs);
  }

  throw feederError(
    "Candidate publication did not become locally stable",
    "CANDIDATE_FILE_NOT_STABLE",
    { retryable: true },
  );
}

export async function readStableCandidatePublication(filePath, options = {}) {
  const parseAttempts = Number.isInteger(options.parseAttempts) ? options.parseAttempts : 3;
  const retryDelayMs = Number.isFinite(options.parseRetryDelayMs) ? options.parseRetryDelayMs : 150;
  const sleepFn = options.sleepFn || sleep;
  let lastParseError = null;

  for (let attempt = 0; attempt < parseAttempts; attempt += 1) {
    const stableStat = await waitForStableFile(filePath, { ...options, sleepFn });
    const bytes = await fs.readFile(filePath);
    const afterRead = await fs.stat(filePath);
    if (statFingerprint(stableStat) !== statFingerprint(afterRead)) {
      if (attempt + 1 < parseAttempts) {
        if (retryDelayMs > 0) await sleepFn(retryDelayMs);
        continue;
      }
      throw feederError(
        "Candidate publication changed while being read",
        "CANDIDATE_FILE_NOT_STABLE",
        { retryable: true },
      );
    }

    try {
      return { bytes, parsed: JSON.parse(bytes.toString("utf8")), stat: afterRead };
    } catch (error) {
      lastParseError = error;
      if (attempt + 1 < parseAttempts) {
        if (retryDelayMs > 0) await sleepFn(retryDelayMs);
        continue;
      }
    }
  }

  throw feederError(
    `Stable candidate publication is malformed JSON: ${lastParseError?.message || "parse failure"}`,
    "MALFORMED_CANDIDATE_JSON",
  );
}

export function validateCandidateBundle(bundle, bytes, {
  maxBodyBytes = MAX_CANDIDATE_BUNDLE_BYTES,
} = {}) {
  const errors = [];
  const byteLength = Buffer.byteLength(bytes);
  if (byteLength > maxBodyBytes) errors.push(`bundle exceeds ${maxBodyBytes} byte PRETRADE request limit`);

  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    errors.push("bundle must be a JSON object");
    return errors;
  }
  if (bundle.source !== CANDIDATE_FEEDER_SOURCE) {
    errors.push(`bundle source must equal ${CANDIDATE_FEEDER_SOURCE}`);
  }
  if (!text(bundle.bundleId)) errors.push("bundleId is required");
  if (!RECOGNIZED_FEEDER_POLICIES.has(bundle.ingressPolicy)) {
    errors.push(`ingressPolicy must be recognized: ${[...RECOGNIZED_FEEDER_POLICIES].join(", ")}`);
  }
  if (!Array.isArray(bundle.candidates)) {
    errors.push("candidates must be an array");
    return errors;
  }

  const candidateIds = new Set();
  for (const [index, candidate] of bundle.candidates.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      errors.push(`candidates[${index}] must be an object`);
      continue;
    }
    const candidateId = text(candidate.candidateId);
    if (!candidateId) errors.push(`candidates[${index}].candidateId is required`);
    else if (candidateIds.has(candidateId)) errors.push(`duplicate candidateId in bundle: ${candidateId}`);
    else candidateIds.add(candidateId);

    if (!Number.isInteger(candidate.contractVersion) || candidate.contractVersion < 1) {
      errors.push(`candidates[${index}].contractVersion must be an integer >= 1`);
    }
    if (candidate.source !== CANDIDATE_FEEDER_SOURCE) {
      errors.push(`candidates[${index}].source must equal bundle source ${CANDIDATE_FEEDER_SOURCE}`);
    }
  }

  return [...new Set(errors)];
}

export async function verifyPretradeHealth(pretradeUrl = DEFAULT_PRETRADE_URL, options = {}) {
  const base = assertLoopbackPretradeUrl(pretradeUrl);
  const healthUrl = new URL("/health", base);
  const response = await getJson(healthUrl, { timeoutMs: options.timeoutMs || 3000 });
  if (response.statusCode !== 200) {
    throw feederError(
      `PRETRADE health returned HTTP ${response.statusCode}`,
      "PRETRADE_HEALTH_HTTP_ERROR",
      { retryable: true, details: response.json },
    );
  }

  const health = response.json;
  const violations = [];
  if (health.ok !== true) violations.push("ok must be true");
  if (health.service !== "executionos-v24-pretrade") violations.push("service identity mismatch");
  if (health.candidateIngressAuthority !== true) violations.push("candidate ingress authority missing");
  if (health.candidateContractVersioning !== true) violations.push("candidate contract versioning authority missing");
  if (health.candidateAutomatedIngressPolicy !== AUTOMATED_UNTOUCHED_ONLY) {
    violations.push(`automated ingress policy capability must equal ${AUTOMATED_UNTOUCHED_ONLY}`);
  }
  if (health.candidateManualIngressPolicy !== undefined && health.candidateManualIngressPolicy !== MANUAL_AUTHORIZED) {
    violations.push(`manual ingress policy capability must equal ${MANUAL_AUTHORIZED}`);
  }
  if (health.readOnlyBrokerBoundary !== true) violations.push("read-only broker boundary not asserted");
  if (health.brokerWriteAuthority === true) violations.push("broker write authority must remain absent");

  if (violations.length) {
    throw feederError(
      `PRETRADE health capability mismatch: ${violations.join("; ")}`,
      "PRETRADE_HEALTH_CAPABILITY_MISMATCH",
      { retryable: true, details: { violations } },
    );
  }
  return health;
}

export async function postCandidateBundleExact(bytes, pretradeUrl = DEFAULT_PRETRADE_URL, options = {}) {
  const base = assertLoopbackPretradeUrl(pretradeUrl);
  const importUrl = new URL("/api/candidates/import", base);
  const response = await requestBytes(importUrl, {
    method: "POST",
    body: bytes,
    timeoutMs: options.timeoutMs || 5000,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
  const json = parseResponseJson(response, "PRETRADE_INVALID_IMPORT_RESPONSE");

  if (response.statusCode >= 500) {
    throw feederError(
      `PRETRADE import returned HTTP ${response.statusCode}`,
      "PRETRADE_IMPORT_SERVER_ERROR",
      { retryable: true, details: json },
    );
  }
  if (response.statusCode !== 200) {
    throw feederError(
      `PRETRADE import rejected request with HTTP ${response.statusCode}`,
      "PRETRADE_IMPORT_REQUEST_REJECTED",
      { details: json },
    );
  }
  if (!Array.isArray(json.outcomes)) {
    throw feederError("PRETRADE import response is missing outcomes", "INVALID_PRETRADE_IMPORT_RESPONSE");
  }
  const parsedBundle = JSON.parse(bytes.toString("utf8"));
  if (json.ingressPolicy !== parsedBundle.ingressPolicy) {
    throw feederError(
      "PRETRADE import response did not attest the transported ingress policy",
      "PRETRADE_IMPORT_POLICY_ATTESTATION_MISSING",
      { retryable: true, details: json },
    );
  }
  return json;
}

export async function fetchCandidateSnapshot(pretradeUrl = DEFAULT_PRETRADE_URL, options = {}) {
  const base = assertLoopbackPretradeUrl(pretradeUrl);
  const snapshotUrl = new URL("/api/candidates", base);
  const response = await getJson(snapshotUrl, { timeoutMs: options.timeoutMs || 3000 });
  if (response.statusCode !== 200) {
    throw feederError(
      `PRETRADE candidate snapshot returned HTTP ${response.statusCode}`,
      "PRETRADE_SNAPSHOT_HTTP_ERROR",
      { retryable: true, details: response.json },
    );
  }
  if (!Array.isArray(response.json.candidates)) {
    throw feederError(
      "PRETRADE candidate snapshot is missing candidates",
      "INVALID_PRETRADE_SNAPSHOT",
      { retryable: true },
    );
  }
  return response.json;
}

function findFinalCandidate(snapshot, outcome) {
  return snapshot.candidates.find((candidate) => (
    candidate.candidateId === outcome.candidateId
    && Number(candidate.contractVersion) === Number(outcome.contractVersion)
  ));
}

export function reconcileImportOutcomes(importResult, snapshot) {
  const perCandidate = importResult.outcomes.map((outcome) => {
    const current = findFinalCandidate(snapshot, outcome);
    const successfulIngress = SUCCESS_CANONICAL_STATUSES.has(outcome.status);
    return {
      candidateId: outcome.candidateId ?? null,
      contractVersion: outcome.contractVersion ?? null,
      ingressStatus: outcome.status ?? "UNKNOWN",
      currentLifecycleState: current?.lifecycleState ?? null,
      stateRevision: Number.isInteger(current?.stateRevision) ? current.stateRevision : null,
      verified: successfulIngress ? Boolean(current) : true,
      reasons: Array.isArray(outcome.reasons) ? outcome.reasons : [],
    };
  });

  const missingSuccessfulCandidate = perCandidate.some((item) => (
    SUCCESS_CANONICAL_STATUSES.has(item.ingressStatus) && !item.verified
  ));
  if (missingSuccessfulCandidate) {
    throw feederError(
      "PRETRADE authoritative snapshot did not contain a successfully imported candidate",
      "PRETRADE_IMPORT_VERIFICATION_FAILED",
      { retryable: true, details: { perCandidate } },
    );
  }

  const hasTerminalOutcome = perCandidate.some((item) => TERMINAL_CANONICAL_STATUSES.has(item.ingressStatus));
  const hasUnknownOutcome = perCandidate.some((item) => (
    !SUCCESS_CANONICAL_STATUSES.has(item.ingressStatus)
    && !TERMINAL_CANONICAL_STATUSES.has(item.ingressStatus)
  ));

  return {
    disposition: hasTerminalOutcome || hasUnknownOutcome ? "QUARANTINE" : "ARCHIVE",
    perCandidate,
  };
}

export function candidateDirectoriesFromInbox(inboxPath) {
  const resolvedInbox = path.resolve(inboxPath);
  const root = path.dirname(resolvedInbox);
  return {
    root,
    inbox: resolvedInbox,
    receipts: path.join(root, "receipts"),
    archive: path.join(root, "archive"),
    quarantine: path.join(root, "quarantine"),
    lockFile: path.join(root, ".candidate-feeder.lock"),
  };
}

async function ensureOutputDirectories(directories) {
  await fs.mkdir(directories.receipts, { recursive: true });
  await fs.mkdir(directories.archive, { recursive: true });
  await fs.mkdir(directories.quarantine, { recursive: true });
}

async function writeReceipt(directories, receipt) {
  await ensureOutputDirectories(directories);
  const basename = path.basename(receipt.bundleFile || "candidate-publication.json", ".json");
  const filename = `${safeTimestamp(receipt.importCompletedAt || receipt.verifiedAt || nowIso())}-${basename}.receipt.json`;
  const finalPath = path.join(directories.receipts, filename);
  const tempPath = `${finalPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tempPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  await fs.rename(tempPath, finalPath);
  return finalPath;
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

async function moveImmutableFile(source, destinationDirectory, expectedHash) {
  await fs.mkdir(destinationDirectory, { recursive: true });
  const destination = path.join(destinationDirectory, path.basename(source));
  try {
    await fs.copyFile(source, destination, fsConstants.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existingHash = await hashFile(destination);
    if (existingHash !== expectedHash) {
      throw feederError(
        `Immutable publication destination collision at ${destination}`,
        "IMMUTABLE_PUBLICATION_COLLISION",
      );
    }
  }
  await fs.unlink(source);
  return destination;
}

function baseReceipt({ filePath, hash, observedLocallyAt, bundle = null }) {
  return {
    transportSchemaVersion: CANDIDATE_FEEDER_TRANSPORT_SCHEMA_VERSION,
    bundleId: text(bundle?.bundleId) || null,
    bundleFile: path.basename(filePath),
    bundleSha256: hash || null,
    observedLocallyAt,
    importStartedAt: null,
    importCompletedAt: null,
    verifiedAt: null,
    pretradeServiceVerified: false,
    brokerWriteAuthority: false,
    disposition: null,
    error: null,
    candidates: [],
  };
}

async function terminalLocalFailure({
  directories,
  filePath,
  bytes,
  bundle,
  observedLocallyAt,
  error,
  clock,
}) {
  const hash = bytes ? sha256(bytes) : await hashFile(filePath);
  const completedAt = clock();
  const receipt = {
    ...baseReceipt({ filePath, hash, observedLocallyAt, bundle }),
    importCompletedAt: completedAt,
    verifiedAt: completedAt,
    disposition: "QUARANTINE",
    error: {
      code: error.code || "CANDIDATE_FEEDER_ERROR",
      message: error.message,
      details: error.details || null,
    },
  };

  try {
    const receiptPath = await writeReceipt(directories, receipt);
    const movedTo = await moveImmutableFile(filePath, directories.quarantine, hash);
    return { status: "QUARANTINED", receiptPath, movedTo, receipt };
  } catch (finalizationError) {
    return {
      status: "PENDING_RETRY",
      error: retryableFinalizationError(finalizationError),
      receipt,
    };
  }
}

export async function processCandidatePublication(filePath, {
  inboxPath = path.dirname(filePath),
  pretradeUrl = DEFAULT_PRETRADE_URL,
  clock = nowIso,
  stableFileOptions = {},
  requestOptions = {},
} = {}) {
  const directories = candidateDirectoriesFromInbox(inboxPath);
  const observedLocallyAt = clock();
  let publication;

  try {
    publication = await readStableCandidatePublication(filePath, stableFileOptions);
  } catch (error) {
    if (error.retryable) return { status: "PENDING_RETRY", error };
    return terminalLocalFailure({
      directories,
      filePath,
      bytes: null,
      bundle: null,
      observedLocallyAt,
      error,
      clock,
    });
  }

  const { bytes, parsed: bundle } = publication;
  const hash = sha256(bytes);
  const validationErrors = validateCandidateBundle(bundle, bytes);
  if (validationErrors.length) {
    return terminalLocalFailure({
      directories,
      filePath,
      bytes,
      bundle,
      observedLocallyAt,
      error: feederError(
        `Candidate bundle validation failed: ${validationErrors.join("; ")}`,
        "INVALID_CANDIDATE_BUNDLE",
        { details: { validationErrors } },
      ),
      clock,
    });
  }

  const receipt = baseReceipt({ filePath, hash, observedLocallyAt, bundle });
  try {
    const health = await verifyPretradeHealth(pretradeUrl, requestOptions);
    receipt.pretradeServiceVerified = true;
    receipt.brokerWriteAuthority = health.brokerWriteAuthority === true;
    receipt.importStartedAt = clock();

    const importResult = await postCandidateBundleExact(bytes, pretradeUrl, requestOptions);
    receipt.importCompletedAt = clock();
    const snapshot = await fetchCandidateSnapshot(pretradeUrl, requestOptions);
    const reconciled = reconcileImportOutcomes(importResult, snapshot);
    receipt.verifiedAt = clock();
    receipt.disposition = reconciled.disposition;
    receipt.candidates = reconciled.perCandidate;
    receipt.validityReconciliation = importResult.validityReconciliation ?? null;

    try {
      const receiptPath = await writeReceipt(directories, receipt);
      const targetDirectory = reconciled.disposition === "ARCHIVE"
        ? directories.archive
        : directories.quarantine;
      const movedTo = await moveImmutableFile(filePath, targetDirectory, hash);
      return {
        status: reconciled.disposition === "ARCHIVE" ? "ARCHIVED" : "QUARANTINED",
        receiptPath,
        movedTo,
        receipt,
      };
    } catch (finalizationError) {
      return {
        status: "PENDING_RETRY",
        error: retryableFinalizationError(finalizationError),
        receipt,
      };
    }
  } catch (error) {
    if (error.retryable) return { status: "PENDING_RETRY", error, receipt };
    return terminalLocalFailure({
      directories,
      filePath,
      bytes,
      bundle,
      observedLocallyAt,
      error,
      clock,
    });
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

export async function acquireSingleInstanceLock(lockFile) {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  const record = { pid: process.pid, lockId: crypto.randomUUID(), acquiredAt: nowIso() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockFile, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`);
      } catch (error) {
        await handle.close().catch(() => {});
        await fs.unlink(lockFile).catch(() => {});
        throw error;
      }
      await handle.close();

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          const current = JSON.parse(await fs.readFile(lockFile, "utf8"));
          if (current.lockId !== record.lockId) return;
          await fs.unlink(lockFile);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      let existing;
      try {
        existing = JSON.parse(await fs.readFile(lockFile, "utf8"));
      } catch {
        throw feederError(
          `Candidate feeder lock exists but its owner cannot be verified: ${lockFile}`,
          "CANDIDATE_FEEDER_LOCK_UNVERIFIABLE",
        );
      }

      const stale = !(await pidIsAlive(Number(existing.pid)));
      if (!stale) {
        throw feederError(
          `Candidate feeder is already running; lock held at ${lockFile}`,
          "CANDIDATE_FEEDER_ALREADY_RUNNING",
        );
      }
      try { await fs.unlink(lockFile); } catch (unlinkError) { if (unlinkError.code !== "ENOENT") throw unlinkError; }
    }
  }

  throw feederError("Unable to acquire candidate feeder lock", "CANDIDATE_FEEDER_LOCK_FAILED");
}

export async function listPendingCandidatePublications(inboxPath) {
  const entries = await fs.readdir(inboxPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(inboxPath, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
}

export async function drainCandidateInbox({
  inboxPath,
  pretradeUrl = DEFAULT_PRETRADE_URL,
  clock = nowIso,
  stableFileOptions = {},
  requestOptions = {},
} = {}) {
  if (!text(inboxPath)) throw feederError("Candidate inbox path is required", "CANDIDATE_INBOX_REQUIRED");
  const stat = await fs.stat(inboxPath).catch((error) => {
    throw feederError(
      `Candidate inbox is unavailable: ${error.message}`,
      "CANDIDATE_INBOX_UNAVAILABLE",
      { retryable: true },
    );
  });
  if (!stat.isDirectory()) throw feederError("Candidate inbox path must be a directory", "INVALID_CANDIDATE_INBOX");

  const files = await listPendingCandidatePublications(inboxPath);
  const results = [];
  for (const filePath of files) {
    results.push(await processCandidatePublication(filePath, {
      inboxPath,
      pretradeUrl,
      clock,
      stableFileOptions,
      requestOptions,
    }));
  }
  return { filesDiscovered: files.length, results };
}

async function main() {
  const inboxPath = process.env.EXECUTIONOS_CANDIDATE_INBOX;
  if (!text(inboxPath)) {
    throw feederError(
      "EXECUTIONOS_CANDIDATE_INBOX must be set to the local Dropbox inbox path",
      "CANDIDATE_INBOX_REQUIRED",
    );
  }
  const pretradeUrl = process.env.EXECUTIONOS_PRETRADE_URL || DEFAULT_PRETRADE_URL;
  const directories = candidateDirectoriesFromInbox(inboxPath);
  const releaseLock = await acquireSingleInstanceLock(directories.lockFile);
  try {
    const result = await drainCandidateInbox({ inboxPath, pretradeUrl });
    console.log(JSON.stringify(result, null, 2));
    if (result.results.some((item) => item.status === "PENDING_RETRY")) process.exitCode = 2;
  } finally {
    await releaseLock();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath && import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`[ExecutionOS Candidate Feeder] ${error.code || "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
}
