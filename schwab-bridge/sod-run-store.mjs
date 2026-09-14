import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { sodError } from "./sod-provider-validation.mjs";
import { sanitizeSodTransportDiagnostics } from "./sod-transport-diagnostics.mjs";

export const SOD_TERMINAL_STAGES = new Set(["SUCCESS", "NO_CANDIDATES", "PRETRADE_PREFLIGHT_REQUIRED", "FAILED", "ABANDONED"]);
const NEXT = {
  CLAIMED: ["PROVIDER_REQUEST_STARTED", "FAILED"],
  PROVIDER_REQUEST_STARTED: ["PROVIDER_RESULT_DURABLE", "RECOVERY_REQUIRED", "FAILED"],
  PROVIDER_RESULT_DURABLE: ["PRETRADE_SNAPSHOT_ACQUIRED", "FAILED"],
  PRETRADE_SNAPSHOT_ACQUIRED: ["PRETRADE_SNAPSHOT_ACQUIRED", "PREPARED", "FAILED"],
  PREPARED: ["PRETRADE_SNAPSHOT_ACQUIRED", "PUBLICATION_INTENT_RECORDED", "NO_CANDIDATES", "PRETRADE_PREFLIGHT_REQUIRED", "FAILED"],
  PUBLICATION_INTENT_RECORDED: ["PRETRADE_SNAPSHOT_ACQUIRED", "PUBLICATION_COMMITTED", "FAILED"],
  PUBLICATION_COMMITTED: ["SUCCESS"],
  RECOVERY_REQUIRED: ["ABANDONED"],
};
export function stableSodJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableSodJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableSodJson(value[k])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw sodError("SOD_RUN_REQUEST_INVALID");
  return encoded;
}
export const sodSha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
export const sodRequestHash = request => sodSha256(stableSodJson(request));
export function assertSodRunId(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw sodError("SOD_RUN_ID_INVALID");
  return id.toLowerCase();
}
export function safeSodFailureCode(error) {
  return /^SOD_[A-Z_]{3,80}$/.test(error?.code || "") ? error.code : "SOD_RUN_FAILED";
}
function syncDirectory(dir) { const fd = fs.openSync(dir, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function safeDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (let current = dir; ; current = path.dirname(current)) {
    const st = fs.lstatSync(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw sodError("SOD_RUN_STORE_UNSAFE");
    if (current === path.dirname(current)) break;
  }
  if ((fs.statSync(dir).mode & 0o022) !== 0) throw sodError("SOD_RUN_STORE_UNSAFE");
}
function immutableWrite(file, bytes) {
  const temp = path.join(path.dirname(file), `.write-${crypto.randomUUID()}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); syncDirectory(path.dirname(file)); }
  finally { fs.unlinkSync(temp); }
}
function readFile(file, maxBytes = 8 * 1024 * 1024) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw sodError("SOD_RUN_STORE_CORRUPT");
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function readJson(file) { try { return JSON.parse(readFile(file)); } catch { throw sodError("SOD_RUN_STORE_CORRUPT"); } }

// One local process owns this narrow journal. No network/distributed lock authority.
export function createSodRunStore({ rootPath, clock = () => new Date().toISOString() } = {}) {
  if (typeof rootPath !== "string" || !path.isAbsolute(rootPath)) throw sodError("SOD_RUN_STORE_ROOT_REQUIRED");
  let root = path.resolve(rootPath);
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(root).isSymbolicLink()) throw sodError("SOD_RUN_STORE_UNSAFE");
    root = fs.realpathSync(root); // Pin configured ancestors, including macOS /var and /tmp aliases.
    syncDirectory(path.dirname(root));
  } catch (error) { throw sodError(error.code === "SOD_RUN_STORE_UNSAFE" ? error.code : "SOD_RUN_STORE_UNAVAILABLE"); }
  const runsDir = path.join(root, "runs");
  const blobsDir = path.join(root, "artifacts");
  const writerFile = path.join(root, ".writer.json");
  const owner = { pid: process.pid, id: crypto.randomUUID() };
  let closed = false;
  const runs = new Map();
  const executing = new Map();
  function ownsWriter() {
    if (closed || readJson(writerFile).id !== owner.id) throw sodError("SOD_RUN_STORE_WRITER_REQUIRED");
  }
  function close() {
    if (!closed && readJson(writerFile).id === owner.id) { fs.unlinkSync(writerFile); syncDirectory(root); }
    closed = true;
  }
  function state(id) { const run = runs.get(assertSodRunId(id)); if (!run) throw sodError("SOD_RUN_NOT_FOUND"); return structuredClone(run); }
  function apply(previous, record) {
    const { hash, ...event } = record;
    if (sodSha256(stableSodJson(event)) !== hash || event.sequence !== (previous?.sequence || 0) + 1
      || event.previousHash !== (previous?.eventHash || null) || !Number.isFinite(Date.parse(event.at))) throw sodError("SOD_RUN_STORE_CORRUPT");
    if (!previous) {
      if (event.stage !== "CLAIMED" || !/^[a-f0-9]{64}$/.test(event.data.requestHash || "")
        || !/^\d{4}-\d{2}-\d{2}$/.test(event.data.sourceDate || "") || !["INITIAL", "REFRESH"].includes(event.data.generationMode)) throw sodError("SOD_RUN_STORE_CORRUPT");
    } else if (!NEXT[previous.stage]?.includes(event.stage)) throw sodError("SOD_RUN_TRANSITION_INVALID");
    if (event.stage === "RECOVERY_REQUIRED" && event.data.reason !== "PROVIDER_OUTCOME_AMBIGUOUS") throw sodError("SOD_RUN_TRANSITION_INVALID");
    if (["PROVIDER_RESULT_DURABLE", "PREPARED"].includes(event.stage) && !/^[a-f0-9]{64}$/.test(event.data.artifactHash || "")) throw sodError("SOD_RUN_STORE_CORRUPT");
    if (event.stage === "PUBLICATION_INTENT_RECORDED") {
      const intent = event.data.intent;
      if (!intent || intent.runId !== event.runId || !/^[a-f0-9]{64}$/.test(intent.sha256 || "") || !intent.finalName || path.basename(intent.finalName) !== intent.finalName) throw sodError("SOD_RUN_STORE_CORRUPT");
      if (previous.intent && stableSodJson(previous.intent) !== stableSodJson(intent)) throw sodError("SOD_PUBLICATION_RECOVERY_CONFLICT");
    }
    if (event.stage === "PUBLICATION_COMMITTED" && stableSodJson(event.data.publication) !== stableSodJson({
      publicationId: previous.intent.publicationId, finalName: previous.intent.finalName,
      sha256: previous.intent.sha256, byteLength: previous.intent.byteLength,
    })) throw sodError("SOD_PUBLICATION_RECOVERY_CONFLICT");
    const next = { ...previous, runId: event.runId, stage: event.stage, sequence: event.sequence, eventHash: hash, updatedAt: event.at };
    if (!previous) Object.assign(next, event.data, { createdAt: event.at });
    if (event.stage === "PROVIDER_REQUEST_STARTED") { next.charts = event.data.charts || next.charts; next.provider = event.data.provider || null; }
    if (event.stage === "PROVIDER_RESULT_DURABLE") next.providerResultHash = event.data.artifactHash;
    if (event.stage === "PRETRADE_SNAPSHOT_ACQUIRED") next.fingerprint = event.data.fingerprint;
    if (event.stage === "PREPARED") next.preparedHash = event.data.artifactHash;
    if (event.stage === "PUBLICATION_INTENT_RECORDED") next.intent = event.data.intent;
    if (event.stage === "PUBLICATION_COMMITTED") next.publication = event.data.publication;
    if (event.stage === "RECOVERY_REQUIRED") next.reason = event.data.reason;
    if (event.data.providerDiagnostics) next.providerDiagnostics = sanitizeSodTransportDiagnostics(event.data.providerDiagnostics);
    if (SOD_TERMINAL_STAGES.has(event.stage)) { next.result = event.data.result || null; next.failureCode = event.data.failureCode || null; }
    return next;
  }
  function append(id, stage, data = {}) {
    ownsWriter();
    id = assertSodRunId(id);
    const previous = runs.get(id);
    const event = { runId: id, sequence: (previous?.sequence || 0) + 1, previousHash: previous?.eventHash || null, stage, at: clock(), data };
    const record = { ...event, hash: sodSha256(stableSodJson(event)) };
    const next = apply(previous, record);
    const dir = path.join(runsDir, id);
    if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { mode: 0o700 }); syncDirectory(runsDir); }
    immutableWrite(path.join(dir, `${String(event.sequence).padStart(8, "0")}.json`), stableSodJson(record));
    runs.set(id, next);
    return state(id);
  }
  function putArtifact(value) {
    ownsWriter();
    const bytes = Buffer.from(stableSodJson(value));
    if (bytes.length > 8 * 1024 * 1024) throw sodError("SOD_RUN_ARTIFACT_TOO_LARGE");
    const hash = sodSha256(bytes), file = path.join(blobsDir, `${hash}.json`);
    if (fs.existsSync(file)) { if (sodSha256(readFile(file)) !== hash) throw sodError("SOD_RUN_ARTIFACT_HASH_MISMATCH"); }
    else immutableWrite(file, bytes);
    return hash;
  }
  function getArtifact(hash) {
    if (!/^[a-f0-9]{64}$/.test(hash || "")) throw sodError("SOD_RUN_ARTIFACT_HASH_MISMATCH");
    const bytes = readFile(path.join(blobsDir, `${hash}.json`));
    if (sodSha256(bytes) !== hash) throw sodError("SOD_RUN_ARTIFACT_HASH_MISMATCH");
    try { return JSON.parse(bytes); } catch { throw sodError("SOD_RUN_STORE_CORRUPT"); }
  }
  try {
    safeDirectory(root); safeDirectory(runsDir); safeDirectory(blobsDir); syncDirectory(root);
    if (fs.existsSync(writerFile)) {
      // Fail closed if ownership cannot be established. PID reuse also fails closed.
      const prior = readJson(writerFile);
      if (!Number.isInteger(prior.pid) || prior.pid < 1 || !prior.id) throw sodError("SOD_RUN_STORE_WRITER_REQUIRED");
      let dead = false;
      try { process.kill(prior.pid, 0); } catch (error) { dead = error.code === "ESRCH"; }
      if (!dead) throw sodError("SOD_RUN_STORE_WRITER_CONFLICT");
      // Exclusive reclamation prevents two startup processes from stealing each other's lock.
      const reclaim = path.join(root, ".reclaim");
      fs.mkdirSync(reclaim, { mode: 0o700 });
      try {
        if (readJson(writerFile).id !== prior.id) throw sodError("SOD_RUN_STORE_WRITER_CONFLICT");
        fs.unlinkSync(writerFile);
        immutableWrite(writerFile, stableSodJson(owner));
      } finally { fs.rmdirSync(reclaim); }
    } else immutableWrite(writerFile, stableSodJson(owner));
    const activeDates = new Set();
    for (const name of fs.readdirSync(runsDir)) {
      assertSodRunId(name);
      const dir = path.join(runsDir, name);
      if (!fs.lstatSync(dir).isDirectory() || fs.lstatSync(dir).isSymbolicLink()) throw sodError("SOD_RUN_STORE_UNSAFE");
      let run;
      for (const file of fs.readdirSync(dir).filter(f => !/^\.write-.*\.tmp$/.test(f)).sort()) {
        if (file !== `${String((run?.sequence || 0) + 1).padStart(8, "0")}.json`) throw sodError("SOD_RUN_STORE_CORRUPT");
        const event = readJson(path.join(dir, file));
        if (event.runId !== name) throw sodError("SOD_RUN_STORE_CORRUPT");
        run = apply(run, event);
      }
      if (!run) continue; // crash after directory creation, before claim visibility
      if (!SOD_TERMINAL_STAGES.has(run.stage)) {
        if (activeDates.has(run.sourceDate)) throw sodError("SOD_RUN_STORE_SPLIT_BRAIN");
        activeDates.add(run.sourceDate);
      }
      if (run.providerResultHash) getArtifact(run.providerResultHash);
      if (run.preparedHash) getArtifact(run.preparedHash);
      runs.set(name, run);
    }
    for (const run of runs.values()) if (run.stage === "PROVIDER_REQUEST_STARTED") append(run.runId, "RECOVERY_REQUIRED", { reason: "PROVIDER_OUTCOME_AMBIGUOUS" });
  } catch (error) {
    try { if (fs.existsSync(writerFile) && readJson(writerFile).id === owner.id) close(); } catch { /* preserve ambiguous ownership */ }
    throw sodError(error?.code?.startsWith("SOD_") ? error.code : "SOD_RUN_STORE_UNAVAILABLE");
  }
  function acceptanceFile(provider) {
    return path.join(root, `acceptance-${sodRequestHash({ provider: provider.providerIdentity || null, version: provider.providerVersion || null, model: provider.model || null, validationVersion: 1 })}.json`);
  }
  function liveAcceptanceValidated(provider) {
    if (provider.readiness?.().providerConfigured !== true || !provider.model) return false;
    try {
      const evidence = readJson(acceptanceFile(provider));
      const run = state(evidence.runId);
      return evidence.provider === provider.providerIdentity && evidence.modelRequested === provider.model
        && evidence.providerVersion === provider.providerVersion && evidence.validationVersion === 1
        && evidence.localValidation === true && evidence.webSearchCallCount > 0 && evidence.chartCount > 0
        && evidence.providerResultHash === run.providerResultHash && evidence.productionAcceptance === true;
    } catch { return false; }
  }
  return Object.freeze({
    rootPath: root, state, append, putArtifact, getArtifact, close, liveAcceptanceValidated,
    isExecuting: id => executing.has(assertSodRunId(id)),
    withRunWriter(id, work) {
      ownsWriter(); id = assertSodRunId(id);
      if (executing.has(id)) return executing.get(id);
      const pending = Promise.resolve().then(work).finally(() => executing.delete(id));
      executing.set(id, pending);
      return pending;
    },
    recordLiveAcceptance(id, provider) {
      ownsWriter();
      const run = state(id);
      const metadata = getArtifact(run.providerResultHash).generationMetadata;
      if (provider.providerIdentity !== "openai" || provider.readiness?.().providerConfigured !== true
        || !["SUCCESS", "NO_CANDIDATES", "PRETRADE_PREFLIGHT_REQUIRED"].includes(run.stage)
        || metadata?.provider !== "openai" || metadata.modelRequested !== provider.model
        || metadata.localValidation !== true || metadata.responseStatus !== "completed"
        || !(metadata.webSearchCallCount > 0 && metadata.sourceCount > 0 && metadata.chartCount > 0)) throw sodError("SOD_LIVE_ACCEPTANCE_INVALID");
      const evidence = { runId: run.runId, provider: "openai", providerVersion: provider.providerVersion,
        validationVersion: 1, modelRequested: provider.model, modelResolved: metadata.modelResolved || null,
        responseId: metadata.responseId || null, requestId: metadata.requestId || null,
        validatedAt: clock(), responseStatus: metadata.responseStatus, localValidation: true,
        webSearchCallCount: metadata.webSearchCallCount, sourceCount: metadata.sourceCount,
        chartCount: metadata.chartCount, providerResultHash: run.providerResultHash,
        productionAcceptance: true, terminalStage: run.stage };
      const file = acceptanceFile(provider);
      if (!fs.existsSync(file)) immutableWrite(file, stableSodJson(evidence));
      if (!liveAcceptanceValidated(provider)) throw sodError("SOD_LIVE_ACCEPTANCE_INVALID");
      return readJson(file);
    },
    claim(id, request) {
      ownsWriter(); id = assertSodRunId(id);
      const requestHash = sodRequestHash(request);
      if (runs.has(id)) {
        const prior = state(id);
        if (prior.requestHash !== requestHash) throw sodError("SOD_RUN_REQUEST_HASH_CONFLICT");
        return prior;
      }
      const active = [...runs.values()].find(r => r.sourceDate === request.sourceDate && !SOD_TERMINAL_STAGES.has(r.stage));
      if (active) throw Object.assign(sodError("SOD_RUN_ACTIVE_CONFLICT"), { activeRun: { runId: active.runId, stage: active.stage, sourceDate: active.sourceDate, reason: active.reason || null } });
      return append(id, "CLAIMED", { requestHash, sourceDate: request.sourceDate, generationMode: request.generationMode,
        charts: request.charts.map(({ chartId, contentRef }) => ({ chartId, contentRef })) });
    },
    abandon(id) {
      if (executing.has(assertSodRunId(id))) throw sodError("SOD_RUN_ABANDON_NOT_ELIGIBLE");
      const run = state(id);
      if (run.stage !== "RECOVERY_REQUIRED" || run.reason !== "PROVIDER_OUTCOME_AMBIGUOUS") throw sodError("SOD_RUN_ABANDON_NOT_ELIGIBLE");
      return append(id, "ABANDONED");
    },
  });
}
