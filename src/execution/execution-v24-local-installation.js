import {
  bindV24ExecutionListeningAt,
  buildV24ExecutionCompatibilityEnvelope,
  executionStop,
} from "./execution-v23-compat.js";

export const EXECUTION_V23_STORE_KEY = "execution-v23-store";
export const V24_LOCAL_INSTALLATION_SCHEMA_VERSION = 1;
export const V24_LOCAL_INSTALLATION_STATUSES = Object.freeze(["PREPARED", "LISTENING"]);

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function isoTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutable(value) {
  return deepFreeze(structuredClone(value));
}

function installError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw installError("durable local execution storage is unavailable", "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
  return storage;
}

function emptyStore() {
  return { draft: null, candidates: [], liveTrades: [], history: [], v24Installations: [] };
}

function parseStore(storage, storeKey) {
  const durableStorage = requireStorage(storage);
  try {
    const raw = durableStorage.getItem(storeKey);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("store root must be an object");
    return {
      ...parsed,
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      liveTrades: Array.isArray(parsed.liveTrades) ? parsed.liveTrades : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      v24Installations: Array.isArray(parsed.v24Installations) ? parsed.v24Installations : [],
    };
  } catch (error) {
    throw installError(`local execution store could not be read: ${error.message}`, "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
}

function writeAndReadBack(storage, storeKey, nextStore) {
  const durableStorage = requireStorage(storage);
  const serialized = JSON.stringify(nextStore);
  try {
    durableStorage.setItem(storeKey, serialized);
    const readBack = durableStorage.getItem(storeKey);
    if (readBack !== serialized) throw new Error("exact store readback mismatch");
    return parseStore(durableStorage, storeKey);
  } catch (error) {
    if (error?.code === "LOCAL_EXECUTION_PERSISTENCE_FAILED") throw error;
    throw installError(`local execution store could not be persisted exactly: ${error.message}`, "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
}

function immutableIdentity(record) {
  return JSON.stringify({
    schemaVersion: record?.schemaVersion,
    handoffId: record?.handoffId,
    receiverId: record?.receiverId,
    symbol: record?.symbol,
    compatibility: record?.compatibility,
  });
}

function installationById(store, handoffId) {
  return store.v24Installations.find((item) => text(item?.handoffId) === text(handoffId)) || null;
}

function verifyReadBack(store, expected) {
  const found = installationById(store, expected.handoffId);
  if (!found) {
    throw installError("persisted V2.4 installation is missing on readback", "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw installError("persisted V2.4 installation content differs on readback", "LOCAL_EXECUTION_PERSISTENCE_FAILED");
  }
  return immutable(found);
}

export function buildPreparedV24LocalInstallation({ handoff, receiverId, preparedAt = Date.now() } = {}) {
  const compatibility = buildV24ExecutionCompatibilityEnvelope({ handoff, receiverId });
  const prepared = isoTimestamp(preparedAt);
  if (!prepared) {
    throw installError("preparedAt is invalid", "LOCAL_EXECUTION_PREPARED_AT_INVALID");
  }

  return immutable({
    schemaVersion: V24_LOCAL_INSTALLATION_SCHEMA_VERSION,
    status: "PREPARED",
    handoffId: compatibility.v24.handoffId,
    receiverId: compatibility.v24.executionBoardReceiverId,
    symbol: compatibility.v24.symbol,
    preparedAt: prepared,
    executionListeningAt: null,
    compatibility,
  });
}

export function persistPreparedV24LocalInstallation({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  installation,
} = {}) {
  if (!installation || installation.status !== "PREPARED") {
    throw installError("PREPARED V2.4 installation is required", "INVALID_LOCAL_EXECUTION_INSTALLATION");
  }

  const store = parseStore(storage, storeKey);
  const existing = installationById(store, installation.handoffId);
  if (existing) {
    if (immutableIdentity(existing) !== immutableIdentity(installation)) {
      throw installError("handoffId already exists with different local content", "HANDOFF_ID_CONTENT_CONFLICT");
    }
    return immutable(existing);
  }

  const sameSymbol = store.v24Installations.find((item) => upper(item?.symbol) === upper(installation.symbol));
  if (sameSymbol) {
    throw installError("another V2.4 installation already owns this symbol locally", "EXECUTION_SYMBOL_OWNERSHIP_CONFLICT");
  }

  const expected = structuredClone(installation);
  const nextStore = {
    ...store,
    v24Installations: [...store.v24Installations, expected],
  };
  return verifyReadBack(writeAndReadBack(storage, storeKey, nextStore), expected);
}

export function bindAndPersistV24ExecutionListeningAt({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  handoffId,
  executionListeningAt,
} = {}) {
  const store = parseStore(storage, storeKey);
  const existing = installationById(store, handoffId);
  if (!existing) {
    throw installError("prepared V2.4 installation was not found", "LOCAL_EXECUTION_INSTALLATION_NOT_FOUND");
  }

  const listeningAt = isoTimestamp(executionListeningAt);
  if (!listeningAt) {
    throw installError("executionListeningAt is invalid", "V24_EXECUTION_LISTENING_AT_INVALID");
  }

  if (existing.status === "LISTENING") {
    if (existing.executionListeningAt !== listeningAt) {
      throw installError("existing local listening boundary conflicts with retry", "HANDOFF_ID_CONTENT_CONFLICT");
    }
    return immutable(existing);
  }
  if (existing.status !== "PREPARED") {
    throw installError("local V2.4 installation is not PREPARED", "INVALID_LOCAL_EXECUTION_INSTALLATION");
  }

  const compatibility = bindV24ExecutionListeningAt(existing.compatibility, listeningAt);
  const expected = {
    ...structuredClone(existing),
    status: "LISTENING",
    executionListeningAt: listeningAt,
    compatibility,
  };

  const nextStore = {
    ...store,
    v24Installations: store.v24Installations.map((item) => (
      text(item.handoffId) === text(handoffId) ? expected : item
    )),
  };

  return verifyReadBack(writeAndReadBack(storage, storeKey, nextStore), expected);
}

export function readV24LocalInstallation({
  storage = globalThis?.localStorage,
  storeKey = EXECUTION_V23_STORE_KEY,
  handoffId,
} = {}) {
  const found = installationById(parseStore(storage, storeKey), handoffId);
  return found ? immutable(found) : null;
}

export function executionOwnedSymbolsFromV23Store(store, { excludeHandoffId = null } = {}) {
  const clean = store && typeof store === "object" ? store : {};
  const symbols = new Set();

  for (const candidate of Array.isArray(clean.candidates) ? clean.candidates : []) {
    const symbol = upper(candidate?.originalPlan?.symbol ?? candidate?.v24?.symbol);
    if (symbol) symbols.add(symbol);
  }
  for (const trade of Array.isArray(clean.liveTrades) ? clean.liveTrades : []) {
    const symbol = upper(trade?.originalPlan?.symbol ?? trade?.v24?.symbol);
    if (symbol) symbols.add(symbol);
  }
  if (clean.draft?.mode === "EDIT") {
    const symbol = upper(clean.draft?.originalPlan?.symbol ?? clean.draft?.plan?.symbol);
    if (symbol) symbols.add(symbol);
  }
  for (const installation of Array.isArray(clean.v24Installations) ? clean.v24Installations : []) {
    if (excludeHandoffId && text(installation?.handoffId) === text(excludeHandoffId)) continue;
    if (!["PREPARED", "LISTENING"].includes(upper(installation?.status))) continue;
    const symbol = upper(installation?.symbol);
    if (symbol) symbols.add(symbol);
  }

  return Object.freeze([...symbols].sort());
}

function displayTrigger(trigger) {
  if (trigger === null || trigger === undefined) return "";
  if (typeof trigger === "string") return trigger;
  try {
    return JSON.stringify(trigger);
  } catch {
    return String(trigger);
  }
}

function displayTargets(targets) {
  if (!Array.isArray(targets)) return "";
  return targets.join(" / ");
}

export function buildV23CandidateFromListeningInstallation(installation) {
  if (!installation || installation.status !== "LISTENING" || !installation.compatibility?.v24?.executionListeningAt) {
    throw installError("LISTENING V2.4 installation is required", "V24_LISTENING_INSTALLATION_REQUIRED");
  }

  const v24 = installation.compatibility.v24;
  const candidate = {
    id: `v24:${v24.handoffId}`,
    phase: "ARMED",
    createdAt: v24.handoffCreatedAt,
    armedAt: v24.executionListeningAt,
    origin: installation.compatibility.origin,
    v24: structuredClone(v24),
    originalPlan: {
      symbol: v24.symbol,
      direction: v24.direction,
      setup: v24.setup,
      timeframe: v24.timeframe,
      thesis: v24.thesis,
      trigger: displayTrigger(v24.trigger),
      invalidation: `Structural invalidation @ ${v24.structuralInvalidation}`,
      structuralStop: v24.structuralInvalidation,
      target: displayTargets(v24.targets),
      management: v24.managementPlan ?? "",
    },
    risk: {
      expectedEntry: v24.currentExpectedEntry,
      intendedSize: v24.selectedQuantity,
    },
    currentState: "VALID",
    broker: {
      account: null,
      entryPrice: null,
      entryQuantity: null,
      peakQuantity: null,
      currentQuantity: null,
      currentAveragePrice: null,
      entryDetectedAt: null,
      exitPrice: null,
      exitQuantity: null,
      flatDetectedAt: null,
    },
    decisions: [],
  };

  if (executionStop(candidate) !== v24.effectiveStop) {
    throw installError("V2.4 candidate lost effective-stop execution authority", "INVALID_V24_EXECUTION_PROVENANCE");
  }

  return immutable(candidate);
}
